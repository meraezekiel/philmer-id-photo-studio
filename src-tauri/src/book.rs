//! Photo Book (docs/superpowers/specs/2026-10-13-photo-book-design.md).
//!
//! The ID flow keeps one decoded original in `ImageStore`. A wedding book has
//! a hundred, which would be gigabytes, so here only the path and a small
//! JPEG thumbnail are kept. Printing reads the original again and hands over
//! just the frame's crop, at the frame's size.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, RgbImage};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::face::Face;
use crate::{image_io, resize};

pub const THUMB_MAX: u32 = 1024;
/// A 12 x 12 in frame at 300 DPI is 13 MP; this leaves room and stops typos.
pub const MAX_RENDER_PIXELS: u64 = 100_000_000;
/// How deep a dropped folder is searched (event / camera / day).
pub const FOLDER_DEPTH: usize = 3;
pub const PROJECT_EXTENSION: &str = "photobook";
const MAX_PROJECT_BYTES: u64 = 50 * 1024 * 1024;
/// Formats people drop by mistake; worth saying why they were left out.
const REPORTED_IN_FOLDERS: &[&str] = &["heic", "heif", "tif", "tiff", "gif", "raw", "cr2", "cr3", "nef", "arw", "dng"];

#[derive(Default)]
pub struct ThumbStore {
    thumbs: Mutex<HashMap<String, Arc<Vec<u8>>>>,
}

impl ThumbStore {
    pub fn insert(&self, id: String, jpeg: Vec<u8>) {
        self.thumbs.lock().insert(id, Arc::new(jpeg));
    }

    pub fn get(&self, id: &str) -> Result<Arc<Vec<u8>>> {
        self.thumbs
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::UnknownImage(id.to_owned()))
    }

    pub fn clear(&self) {
        self.thumbs.lock().clear();
    }

    pub fn len(&self) -> usize {
        self.thumbs.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NormRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct Thumbnail {
    pub jpeg: Vec<u8>,
    /// The same thumbnail as pixels, for face detection.
    pub small: RgbImage,
    /// Upright size of the original.
    pub width: u32,
    pub height: u32,
    pub taken_at: Option<String>,
}

fn io_error(path: &Path, e: std::io::Error) -> AppError {
    AppError::Io { path: path.display().to_string(), source: e }
}

fn encode_jpeg(rgb: &RgbImage, quality: u8) -> Result<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut out, quality)
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(AppError::from)?;
    Ok(out.into_inner())
}

pub fn make_thumbnail(path: &Path) -> Result<Thumbnail> {
    image_io::check_extension(path)?;
    let bytes = std::fs::read(path).map_err(|e| io_error(path, e))?;
    let decoded = image_io::decode_bytes(&bytes)?;
    let (width, height) = decoded.rgb.dimensions();
    let scale = (THUMB_MAX as f64 / width.max(height) as f64).min(1.0);
    let tw = ((width as f64 * scale).round() as u32).max(1);
    let th = ((height as f64 * scale).round() as u32).max(1);
    let small = resize::rgb_exact(&decoded.rgb, tw, th)?;
    drop(decoded);
    let jpeg = encode_jpeg(&small, 88)?;
    Ok(Thumbnail { jpeg, small, width, height, taken_at: image_io::read_taken_at(&bytes) })
}

/// The biggest face, in fractions of the image it was found in.
pub fn largest_face(faces: &[Face], width: u32, height: u32) -> Option<NormRect> {
    if width == 0 || height == 0 {
        return None;
    }
    let best = faces.iter().max_by(|a, b| a.area().total_cmp(&b.area()))?;
    let [x, y, w, h] = best.r#box;
    let (fw, fh) = (width as f64, height as f64);
    let x0 = (x as f64 / fw).clamp(0.0, 1.0);
    let y0 = (y as f64 / fh).clamp(0.0, 1.0);
    let x1 = ((x + w) as f64 / fw).clamp(0.0, 1.0);
    let y1 = ((y + h) as f64 / fh).clamp(0.0, 1.0);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    Some(NormRect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

/// A fractional crop as whole pixels, always at least 1 x 1 and inside.
pub fn pixel_rect(crop: NormRect, width: u32, height: u32) -> (u32, u32, u32, u32) {
    let clamp01 = |v: f64| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
    let x0 = clamp01(crop.x);
    let y0 = clamp01(crop.y);
    let x1 = clamp01(crop.x + crop.w).max(x0);
    let y1 = clamp01(crop.y + crop.h).max(y0);
    let px = ((x0 * width as f64).floor() as u32).min(width.saturating_sub(1));
    let py = ((y0 * height as f64).floor() as u32).min(height.saturating_sub(1));
    let pw = ((x1 * width as f64).ceil() as u32).min(width).saturating_sub(px).max(1);
    let ph = ((y1 * height as f64).ceil() as u32).min(height).saturating_sub(py).max(1);
    (px, py, pw, ph)
}

pub fn render_crop(path: &Path, crop: NormRect, width: u32, height: u32) -> Result<RgbImage> {
    if width == 0 || height == 0 || width as u64 * height as u64 > MAX_RENDER_PIXELS {
        return Err(AppError::Other(format!("a {width} x {height} px frame is out of range")));
    }
    let decoded = image_io::decode_path(path)?;
    let (w, h) = decoded.rgb.dimensions();
    let (x, y, cw, ch) = pixel_rect(crop, w, h);
    let view = image::imageops::crop_imm(&decoded.rgb, x, y, cw, ch).to_image();
    drop(decoded);
    resize::rgb_exact(&view, width, height)
}

/// RGB to RGBA, the layout `ImageData` wants.
pub fn to_rgba(rgb: &RgbImage) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgb.as_raw().len() / 3 * 4);
    for px in rgb.as_raw().chunks_exact(3) {
        out.extend_from_slice(&[px[0], px[1], px[2], 255]);
    }
    out
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Expanded {
    pub files: Vec<String>,
    /// File names that were dropped but cannot be used.
    pub skipped: Vec<String>,
}

pub fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn extension_of(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn has_supported_extension(path: &Path) -> bool {
    image_io::is_supported_extension(&extension_of(path))
}

fn sorted_entries(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<PathBuf> = read.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort_by_key(|p| file_name(p).to_lowercase());
    entries
}

fn push_file(path: &Path, out: &mut Expanded, seen: &mut HashSet<String>) {
    let shown = path.display().to_string();
    if seen.insert(shown.to_lowercase()) {
        out.files.push(shown);
    }
}

fn walk(dir: &Path, depth: usize, out: &mut Expanded, seen: &mut HashSet<String>) {
    if depth > FOLDER_DEPTH {
        return;
    }
    for path in sorted_entries(dir) {
        if file_name(&path).starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk(&path, depth + 1, out, seen);
        } else if has_supported_extension(&path) {
            push_file(&path, out, seen);
        } else if REPORTED_IN_FOLDERS.contains(&extension_of(&path).as_str()) {
            out.skipped.push(file_name(&path));
        }
    }
}

/// Dropped files and folders, as the photo files in them, in name order.
pub fn expand_paths(paths: &[String]) -> Expanded {
    let mut out = Expanded::default();
    let mut seen = HashSet::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            walk(&path, 0, &mut out, &mut seen);
        } else if path.is_file() && has_supported_extension(&path) {
            push_file(&path, &mut out, &mut seen);
        } else {
            out.skipped.push(file_name(&path));
        }
    }
    out
}

fn find_walk(dir: &Path, depth: usize, wanted: &HashSet<String>, found: &mut HashMap<String, String>) {
    if depth > FOLDER_DEPTH || found.len() == wanted.len() {
        return;
    }
    for path in sorted_entries(dir) {
        if path.is_dir() {
            find_walk(&path, depth + 1, wanted, found);
        } else {
            let key = file_name(&path).to_lowercase();
            if wanted.contains(&key) && !found.contains_key(&key) {
                found.insert(key, path.display().to_string());
            }
        }
    }
}

/// Files with these names under `folder`, keyed by lower-cased name.
pub fn find_in_folder(folder: &Path, names: &[String]) -> HashMap<String, String> {
    let wanted: HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut found = HashMap::new();
    find_walk(folder, 0, &wanted, &mut found);
    found
}

pub fn write_project(path: &Path, text: &str) -> Result<()> {
    if extension_of(path) != PROJECT_EXTENSION {
        return Err(AppError::Other(format!("a photo book is saved as .{PROJECT_EXTENSION}")));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| io_error(dir, e))?;
    }
    // Write beside it and swap in, so a crash never leaves half a book.
    let tmp = path.with_extension("photobook.tmp");
    std::fs::write(&tmp, text).map_err(|e| io_error(&tmp, e))?;
    std::fs::rename(&tmp, path).map_err(|e| io_error(path, e))
}

pub fn read_project(path: &Path) -> Result<String> {
    let meta = std::fs::metadata(path).map_err(|e| io_error(path, e))?;
    if meta.len() > MAX_PROJECT_BYTES {
        return Err(AppError::Other("that file is too large to be a photo book".into()));
    }
    std::fs::read_to_string(path).map_err(|e| io_error(path, e))
}

pub fn autosave_path(dir: &Path) -> PathBuf {
    dir.join("book-autosave.photobook")
}

pub fn staging_dir() -> PathBuf {
    std::env::temp_dir().join("philmer-book-print")
}

pub fn stage_sheet(dir: &Path, index: u32, bytes: &[u8]) -> Result<PathBuf> {
    std::fs::create_dir_all(dir).map_err(|e| io_error(dir, e))?;
    let path = dir.join(format!("sheet-{index:04}.img"));
    std::fs::write(&path, bytes).map_err(|e| io_error(&path, e))?;
    Ok(path)
}

pub fn clear_staged(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::face::{Landmarks, Point};
    use image::Rgb;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/portrait.jpg")
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("philmer-book-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A JPEG with an EXIF Orientation tag spliced in after SOI.
    fn jpeg_with_orientation(img: &RgbImage, orientation: u8) -> Vec<u8> {
        let plain = encode_jpeg(img, 95).unwrap();
        let mut app1 = vec![0xFF, 0xE1, 0x00, 0x22];
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(&[b'I', b'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
        app1.extend_from_slice(&[0x01, 0x00]);
        app1.extend_from_slice(&[0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00]);
        app1.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        let mut out = plain[..2].to_vec();
        out.extend_from_slice(&app1);
        out.extend_from_slice(&plain[2..]);
        out
    }

    #[test]
    fn thumbnail_fits_1024_and_keeps_the_shape() {
        let t = make_thumbnail(&fixture()).unwrap();
        let (tw, th) = t.small.dimensions();
        assert_eq!(tw.max(th), THUMB_MAX.min(t.width.max(t.height)));
        let original = t.width as f64 / t.height as f64;
        let small = tw as f64 / th as f64;
        assert!((original - small).abs() < 0.01, "{original} vs {small}");
        assert_eq!(&t.jpeg[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn render_crop_returns_exactly_the_frame_size() {
        let out = render_crop(&fixture(), NormRect { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, 321, 123).unwrap();
        assert_eq!(out.dimensions(), (321, 123));
        assert_eq!(to_rgba(&out).len(), 321 * 123 * 4);
    }

    #[test]
    fn render_crop_refuses_absurd_sizes() {
        assert!(render_crop(&fixture(), NormRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 0, 10).is_err());
        assert!(render_crop(&fixture(), NormRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 20_000, 20_000).is_err());
    }

    #[test]
    fn pixel_rect_survives_garbage() {
        for crop in [
            NormRect { x: f64::NAN, y: -3.0, w: f64::INFINITY, h: 0.0 },
            NormRect { x: 1.5, y: 1.5, w: 1.0, h: 1.0 },
            NormRect { x: 0.99999, y: 0.0, w: 0.0, h: 1.0 },
        ] {
            let (x, y, w, h) = pixel_rect(crop, 40, 20);
            assert!(w >= 1 && h >= 1 && x + w <= 40 && y + h <= 20, "{crop:?} -> {x},{y},{w},{h}");
        }
        assert_eq!(pixel_rect(NormRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 40, 20), (0, 0, 40, 20));
    }

    #[test]
    fn orientation_6_photo_is_upright_everywhere() {
        // Stored 40 x 20: left half red, right half blue. Orientation 6 turns
        // it 90 degrees clockwise, so upright it is 20 x 40, red on top.
        let mut img = RgbImage::new(40, 20);
        for (x, _, px) in img.enumerate_pixels_mut() {
            *px = if x < 20 { Rgb([230, 20, 20]) } else { Rgb([20, 20, 230]) };
        }
        let dir = temp_dir("orientation");
        let path = dir.join("phone.jpg");
        std::fs::write(&path, jpeg_with_orientation(&img, 6)).unwrap();

        let t = make_thumbnail(&path).unwrap();
        assert_eq!((t.width, t.height), (20, 40));
        assert_eq!(t.small.dimensions(), (20, 40));

        let top = render_crop(&path, NormRect { x: 0.0, y: 0.0, w: 1.0, h: 0.4 }, 10, 10).unwrap();
        let px = top.get_pixel(5, 5);
        assert!(px[0] > 150 && px[2] < 100, "top should be red, got {px:?}");
        let bottom = render_crop(&path, NormRect { x: 0.0, y: 0.6, w: 1.0, h: 0.4 }, 10, 10).unwrap();
        let px = bottom.get_pixel(5, 5);
        assert!(px[2] > 150 && px[0] < 100, "bottom should be blue, got {px:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn largest_face_is_normalised_and_clamped() {
        let p = Point { x: 0.0, y: 0.0 };
        let lm = Landmarks { right_eye: p, left_eye: p, nose: p, mouth_right: p, mouth_left: p };
        let small = Face { r#box: [10.0, 10.0, 10.0, 10.0], score: 0.9, landmarks: lm };
        let big = Face { r#box: [50.0, -10.0, 60.0, 40.0], score: 0.9, landmarks: lm };
        let r = largest_face(&[small, big], 100, 100).unwrap();
        assert_eq!(r, NormRect { x: 0.5, y: 0.0, w: 0.5, h: 0.3 });
        assert_eq!(largest_face(&[], 100, 100), None);
        assert_eq!(largest_face(&[small], 0, 100), None);
    }

    #[test]
    fn expand_paths_takes_photos_from_folders_and_reports_the_rest() {
        let dir = temp_dir("expand");
        std::fs::create_dir_all(dir.join("Day 2")).unwrap();
        std::fs::create_dir_all(dir.join(".thumbnails")).unwrap();
        for name in ["b.jpg", "A.PNG", "notes.txt", "clip.HEIC", "Day 2/c.webp", ".thumbnails/d.jpg"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        let loose = dir.join("notes.txt").display().to_string();
        let out = expand_paths(&[dir.display().to_string(), loose]);
        let names: Vec<String> = out.files.iter().map(|f| file_name(Path::new(f))).collect();
        assert_eq!(names, ["A.PNG", "b.jpg", "c.webp"]);
        assert_eq!(out.skipped, ["clip.HEIC", "notes.txt"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expand_paths_dedupes_a_folder_and_its_file() {
        let dir = temp_dir("dedupe");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        let file = dir.join("a.jpg").display().to_string();
        let out = expand_paths(&[dir.display().to_string(), file.clone(), file.to_uppercase()]);
        assert_eq!(out.files.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expand_paths_reports_a_missing_path() {
        let out = expand_paths(&["Z:\\no\\such\\photo.jpg".to_string()]);
        assert!(out.files.is_empty());
        assert_eq!(out.skipped, ["photo.jpg"]);
    }

    #[test]
    fn find_in_folder_matches_unicode_names_ignoring_case() {
        let dir = temp_dir("find");
        std::fs::create_dir_all(dir.join("Kasal ni Juan & María")).unwrap();
        std::fs::write(dir.join("Kasal ni Juan & María").join("María 01.JPG"), b"x").unwrap();
        let found = find_in_folder(&dir, &["MARÍA 01.jpg".to_string(), "absent.jpg".to_string()]);
        assert_eq!(found.len(), 1);
        assert!(found["maría 01.jpg"].ends_with("María 01.JPG"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn projects_round_trip_and_need_the_extension() {
        let dir = temp_dir("project");
        let path = dir.join("nested").join("Juan & María.photobook");
        write_project(&path, "{\"a\":1}").unwrap();
        assert_eq!(read_project(&path).unwrap(), "{\"a\":1}");
        write_project(&path, "{\"a\":2}").unwrap();
        assert_eq!(read_project(&path).unwrap(), "{\"a\":2}");
        assert!(write_project(&dir.join("book.txt"), "x").is_err());
        assert!(read_project(&dir.join("absent.photobook")).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sheets_are_staged_and_cleared() {
        let dir = temp_dir("stage");
        let path = stage_sheet(&dir, 7, b"abc").unwrap();
        assert!(path.ends_with("sheet-0007.img"));
        assert_eq!(std::fs::read(&path).unwrap(), b"abc");
        clear_staged(&dir);
        assert!(!dir.exists());
        clear_staged(&dir);
    }

    #[test]
    fn thumb_store_reports_unknown_ids() {
        let store = ThumbStore::default();
        assert!(store.get("nope").is_err());
        store.insert("a".into(), vec![1, 2]);
        assert_eq!(store.get("a").unwrap().as_slice(), &[1, 2]);
        store.clear();
        assert!(store.is_empty());
    }
}
