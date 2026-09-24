//! Segmentation benchmark. Ignored by default; this is a tuning tool, not a
//! gate — `smoke.rs` owns the M0 timing assertion.
//!
//!   cargo test --manifest-path src-tauri/Cargo.toml --profile perf --test bench -- --ignored --nocapture
//!
//! Answers two questions the M0 result raised: where the ~14 s actually goes,
//! and whether ORT's thread and scheduling knobs can close the gap to the
//! 10 s budget in BUILD_PLAN §9.

use std::path::PathBuf;
use std::time::Instant;

use image::RgbImage;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use photo_studio_lib::{image_io, resize, segment};

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn model_path() -> PathBuf {
    crate_dir()
        .join("resources")
        .join("BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx")
}

fn init_runtime() {
    let dll = crate_dir().join("resources").join("onnxruntime.dll");
    ort::init_from(&dll)
        .expect("could not load onnxruntime.dll")
        .with_name("bench")
        .commit();
}

fn fixture(megapixels: f64) -> RgbImage {
    let rgb = image_io::decode_path(&crate_dir().join("tests/fixtures/portrait.jpg"))
        .expect("could not decode the fixture")
        .rgb;
    let (w, h) = (rgb.width(), rgb.height());
    let factor = ((megapixels * 1e6) / (w as f64 * h as f64)).sqrt();
    resize::rgb_exact(
        &rgb,
        (w as f64 * factor).round() as u32,
        (h as f64 * factor).round() as u32,
    )
    .expect("could not scale the fixture")
}

fn build_session(threads: usize, parallel: bool) -> Session {
    Session::builder()
        .unwrap()
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .unwrap()
        .with_intra_threads(threads)
        .unwrap()
        .with_parallel_execution(parallel)
        .unwrap()
        .commit_from_file(model_path())
        .expect("could not load the Lite model")
}

/// Median of three, so one thermal blip does not decide the answer.
fn median_secs(session: &mut Session, rgb: &RgbImage, runs: usize) -> f64 {
    let mut timings: Vec<f64> = (0..runs)
        .map(|_| {
            let started = Instant::now();
            segment::segment(session, rgb, &mut |_| {}).expect("segmentation failed");
            started.elapsed().as_secs_f64()
        })
        .collect();
    timings.sort_by(f64::total_cmp);
    timings[timings.len() / 2]
}

#[test]
#[ignore = "benchmark"]
fn where_the_time_goes() {
    init_runtime();
    println!(
        "CPU: {} physical / {} logical cores",
        num_cpus::get_physical(),
        num_cpus::get()
    );

    let mut session = build_session(num_cpus::get_physical(), false);
    let rgb = fixture(12.0);

    // Warm up: the first run pays for weight paging and arena growth.
    segment::segment(&mut session, &rgb, &mut |_| {}).unwrap();

    // Stage breakdown. The model always runs at 1024x1024, so only the two
    // resizes scale with the photo.
    let t = Instant::now();
    let small = resize::rgb_exact(&rgb, segment::INPUT_SIZE, segment::INPUT_SIZE).unwrap();
    let downscale = t.elapsed().as_secs_f64();

    let t = Instant::now();
    let mask_small = image::GrayImage::new(segment::INPUT_SIZE, segment::INPUT_SIZE);
    let _ = resize::gray_exact(&mask_small, rgb.width(), rgb.height()).unwrap();
    let upscale = t.elapsed().as_secs_f64();

    let total = median_secs(&mut session, &rgb, 3);

    println!("  downscale to 1024^2 : {:6.3} s", downscale);
    println!("  mask upscale to full: {:6.3} s", upscale);
    println!("  whole segment()     : {:6.3} s", total);
    println!(
        "  => model + normalise: {:6.3} s ({:.0}% of the total)",
        total - downscale - upscale,
        (total - downscale - upscale) / total * 100.0
    );
    let _ = small;
}

#[test]
#[ignore = "benchmark"]
fn thread_and_scheduling_sweep() {
    init_runtime();
    let rgb = fixture(12.0);
    let physical = num_cpus::get_physical();
    let logical = num_cpus::get();

    println!("12 MP, median of 3 runs (budget: 10 s)");
    println!("{:>8}  {:>9}  {:>8}", "threads", "parallel", "median");

    let mut configs: Vec<(usize, bool)> = Vec::new();
    for threads in [1, physical / 2, physical, logical] {
        if threads == 0 || configs.iter().any(|(t, _)| *t == threads) {
            continue;
        }
        configs.push((threads, false));
    }
    configs.push((physical, true));
    configs.push((logical, true));

    for (threads, parallel) in configs {
        let mut session = build_session(threads, parallel);
        segment::segment(&mut session, &rgb, &mut |_| {}).unwrap(); // warm up
        let secs = median_secs(&mut session, &rgb, 3);
        println!("{threads:>8}  {parallel:>9}  {secs:>7.2} s");
    }
}

/// How much of the gap is the 1024x1024 input size itself. The model accepts a
/// dynamic input, so this is a real lever — at a quality cost that has to be
/// judged on hair edges, not on a stopwatch.
#[test]
#[ignore = "benchmark"]
fn input_resolution_sweep() {
    init_runtime();
    let rgb = fixture(12.0);
    let mut session = build_session(num_cpus::get_physical(), false);

    println!("{:>6}  {:>9}", "input", "median");
    for size in [512u32, 768, 1024] {
        let small = resize::rgb_exact(&rgb, size, size).unwrap();
        let mut run = || {
            let started = Instant::now();
            let _ = segment::segment_at(&mut session, &small, size, &mut |_| {})
                .expect("segmentation failed");
            started.elapsed().as_secs_f64()
        };
        run(); // warm up
        let mut timings: Vec<f64> = (0..3).map(|_| run()).collect();
        timings.sort_by(f64::total_cmp);
        println!("{size:>6}  {:>7.2} s", timings[1]);
    }
}
