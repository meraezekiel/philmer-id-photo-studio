//! M0 smoke test (BUILD_PLAN §9).
//!
//! Runs the real models against a real portrait and asserts the three things
//! M0 promises: the mask comes back at full resolution and actually separates
//! the subject, exactly one face is found with sane landmarks, and a 12 MP
//! segmentation finishes inside the time budget.
//!
//!   cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
//!
//! Needs `scripts/fetch-models.ps1` to have run first.

use std::path::{Path, PathBuf};
use std::time::Instant;

use image::GrayImage;
use photo_studio_lib::engine::Engine;
use photo_studio_lib::models::{ModelPaths, SegModel};
use photo_studio_lib::{face, image_io, resize, segment};

/// BUILD_PLAN §9: "Lite segmentation of a 12 MP photo finishes in under ~10 s
/// on a typical 4-core laptop CPU."
const BUDGET_SECS: f64 = 10.0;
const TWELVE_MP: f64 = 12_000_000.0;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn engine() -> Engine {
    let resources = crate_dir().join("resources");
    for needed in [
        "onnxruntime.dll",
        "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
        "face_detection_yunet_2023mar.onnx",
    ] {
        let path = resources.join(needed);
        assert!(
            path.is_file(),
            "{} is missing.\nRun scripts/fetch-models.ps1 before the tests.",
            path.display()
        );
    }
    Engine::new(ModelPaths {
        resources,
        user_models: crate_dir().join("tests/output/models"),
    })
}

fn fixture() -> image::RgbImage {
    let path = crate_dir().join("tests/fixtures/portrait.jpg");
    image_io::decode_path(&path)
        .unwrap_or_else(|e| panic!("could not decode {}: {e}", path.display()))
        .rgb
}

fn output_dir() -> PathBuf {
    let dir = crate_dir().join("tests/output");
    std::fs::create_dir_all(&dir).expect("could not create tests/output");
    dir
}

fn save(image: &GrayImage, name: &str) -> PathBuf {
    let path = output_dir().join(name);
    image.save(&path).expect("could not write the mask");
    path
}

/// Fraction of pixels at or above `threshold`.
fn fraction_above(mask: &GrayImage, threshold: u8) -> f64 {
    let hits = mask.pixels().filter(|p| p.0[0] >= threshold).count();
    hits as f64 / (mask.width() as f64 * mask.height() as f64)
}

#[test]
fn segments_the_portrait_at_full_resolution() {
    let engine = engine();
    let rgb = fixture();
    let (w, h) = image::GenericImageView::dimensions(&rgb);
    println!("fixture: {w}x{h} ({:.1} MP)", (w as f64 * h as f64) / 1e6);

    let session = engine
        .segmentation_session(SegModel::Lite)
        .expect("could not open the Lite model");

    let started = Instant::now();
    let mask = {
        let mut session = session.lock();
        segment::segment(&mut session, &rgb, &mut |stage| {
            println!("  [{:>5.0}%] {}", stage.fraction() * 100.0, stage.label());
        })
        .expect("segmentation failed")
    };
    let elapsed = started.elapsed();

    // The whole point of the app: the mask is the photo's own size, never the
    // model's 1024x1024.
    assert_eq!(
        mask.dimensions(),
        (w, h),
        "the mask must match the original resolution"
    );

    let foreground = fraction_above(&mask, 200);
    let background = 1.0 - fraction_above(&mask, 55);
    println!(
        "mask: {:.1}% foreground, {:.1}% background, {} ms",
        foreground * 100.0,
        background * 100.0,
        elapsed.as_millis()
    );

    // A studio portrait fills a good part of the frame but never all of it.
    assert!(
        (0.10..0.75).contains(&foreground),
        "foreground was {foreground:.3}, which does not look like a segmented subject"
    );
    assert!(
        background > 0.15,
        "background was only {background:.3}; the mask is not separating anything"
    );

    // The corners are flags and backdrop; the middle of the face is the subject.
    assert!(
        mask.get_pixel(2, 2).0[0] < 40,
        "the top-left corner should be background"
    );
    let centre = mask.get_pixel(w / 2, h / 3).0[0];
    assert!(centre > 200, "the face centre should be opaque, got {centre}");

    let path = save(&mask, "portrait-mask.png");
    println!("wrote {}", path.display());
}

#[test]
fn finds_exactly_one_face_with_usable_landmarks() {
    let engine = engine();
    let rgb = fixture();
    let (w, h) = image::GenericImageView::dimensions(&rgb);

    let session = engine.face_session().expect("could not open YuNet");
    let started = Instant::now();
    let faces = {
        let mut session = session.lock();
        face::detect(&mut session, &rgb).expect("face detection failed")
    };
    println!(
        "found {} face(s) in {} ms",
        faces.len(),
        started.elapsed().as_millis()
    );

    assert_eq!(faces.len(), 1, "expected exactly one face in the fixture");
    let f = faces[0];
    let [x, y, fw, fh] = f.r#box;
    println!(
        "  box [{x:.0} {y:.0} {fw:.0} {fh:.0}] score {:.3}",
        f.score
    );
    println!(
        "  eyes ({:.0},{:.0}) ({:.0},{:.0})  nose ({:.0},{:.0})",
        f.landmarks.right_eye.x,
        f.landmarks.right_eye.y,
        f.landmarks.left_eye.x,
        f.landmarks.left_eye.y,
        f.landmarks.nose.x,
        f.landmarks.nose.y
    );

    assert!(f.score >= face::SCORE_THRESHOLD);
    assert!(x >= 0.0 && y >= 0.0, "the box starts off-image");
    assert!(
        x + fw <= w as f32 && y + fh <= h as f32,
        "the box runs off the image"
    );
    // A head in a portrait is a decent slice of the frame, not a speck.
    assert!(
        fw > w as f32 * 0.1 && fh > h as f32 * 0.05,
        "the box is implausibly small: {fw}x{fh}"
    );

    let l = f.landmarks;
    for (name, p) in [
        ("right eye", l.right_eye),
        ("left eye", l.left_eye),
        ("nose", l.nose),
        ("mouth right", l.mouth_right),
        ("mouth left", l.mouth_left),
    ] {
        assert!(
            p.x >= x - fw * 0.2 && p.x <= x + fw * 1.2 && p.y >= y - fh * 0.2 && p.y <= y + fh * 1.2,
            "the {name} landmark ({}, {}) is nowhere near the face box",
            p.x,
            p.y
        );
    }

    // Anatomy, which is what autoCrop will rely on in M2.
    let eye_mid_y = (l.right_eye.y + l.left_eye.y) / 2.0;
    let mouth_mid_y = (l.mouth_right.y + l.mouth_left.y) / 2.0;
    assert!(eye_mid_y < l.nose.y, "eyes should sit above the nose");
    assert!(l.nose.y < mouth_mid_y, "the nose should sit above the mouth");
    // YuNet's "right" eye is the subject's right, so it is on the image's left.
    assert!(
        l.right_eye.x < l.left_eye.x,
        "landmark eye order is not what autoCrop expects"
    );
}

#[test]
fn a_twelve_megapixel_segmentation_stays_inside_the_time_budget() {
    let engine = engine();
    let rgb = fixture();
    let (w, h) = image::GenericImageView::dimensions(&rgb);

    // Scale the fixture up to 12 MP, keeping its aspect. BiRefNet always runs
    // at 1024x1024, so this measures exactly what varies with input size: the
    // downscale in and the mask upscale out.
    let factor = (TWELVE_MP / (w as f64 * h as f64)).sqrt();
    let big_w = (w as f64 * factor).round() as u32;
    let big_h = (h as f64 * factor).round() as u32;
    let big = resize::rgb_exact(&rgb, big_w, big_h).expect("could not build the 12 MP fixture");
    let megapixels = (big_w as f64 * big_h as f64) / 1e6;

    let session = engine
        .segmentation_session(SegModel::Lite)
        .expect("could not open the Lite model");

    // First run pays for warm-up; the plan's budget is about steady state, so
    // report both.
    let mut timings = Vec::new();
    for run in 0..2 {
        let started = Instant::now();
        let mask = {
            let mut session = session.lock();
            segment::segment(&mut session, &big, &mut |_| {}).expect("segmentation failed")
        };
        assert_eq!(mask.dimensions(), (big_w, big_h));
        let secs = started.elapsed().as_secs_f64();
        println!("run {}: {secs:.2} s", run + 1);
        timings.push(secs);
        if run == 1 {
            save(&mask, "portrait-12mp-mask.png");
        }
    }

    let best = timings.iter().cloned().fold(f64::INFINITY, f64::min);
    println!(
        "12 MP timing: {big_w}x{big_h} ({megapixels:.1} MP), {} threads, best {best:.2} s (budget {BUDGET_SECS:.0} s)",
        engine.intra_threads()
    );
    assert!(
        best < BUDGET_SECS,
        "12 MP Lite segmentation took {best:.2} s, over the {BUDGET_SECS:.0} s budget"
    );
}

#[test]
fn the_bundled_models_match_their_pinned_checksums() {
    use photo_studio_lib::models;

    let resources = crate_dir().join("resources");
    for (file, expected) in [
        (models::ORT_DLL, models::ORT_DLL_SHA256),
        (models::LITE_FILE, models::LITE_SHA256),
        (models::YUNET_FILE, models::YUNET_SHA256),
    ] {
        let path: &Path = &resources.join(file);
        if !path.is_file() {
            panic!("{} is missing; run scripts/fetch-models.ps1", path.display());
        }
        models::verify_checksum(path, expected)
            .unwrap_or_else(|e| panic!("{file} failed verification: {e}"));
        println!("{file}: checksum OK");
    }
}
