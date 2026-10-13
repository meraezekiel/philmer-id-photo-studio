//! The Rust -> JS contract from BUILD_PLAN §4.
//!
//! Every command that touches a model or a multi-megapixel buffer hands the
//! work to `spawn_blocking`, so the webview never waits on the CPU.

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, ImageFormat};
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, Result};
use crate::models::{self, SegModel};
use crate::state::AppState;
use crate::{attire, face, image_io, resize, segment};

/// Anything larger than this and the canvas preview is downscaled; the original
/// stays intact for compositing.
const DEFAULT_PREVIEW_MAX_DIM: u32 = 2400;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedImageInfo {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub megapixels: f32,
    pub exif_orientation: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadImageArgs {
    pub path: Option<String>,
    /// Used by the Ctrl+V paste path, where there is no file on disk.
    pub bytes: Option<Vec<u8>>,
}

#[tauri::command]
pub async fn load_image(
    state: State<'_, AppState>,
    args: LoadImageArgs,
) -> Result<LoadedImageInfo> {
    let store = Arc::clone(&state.images);
    tauri::async_runtime::spawn_blocking(move || {
        let decoded = match (args.path, args.bytes) {
            (Some(path), _) => image_io::decode_path(&PathBuf::from(path))?,
            (None, Some(bytes)) => image_io::decode_bytes(&bytes)?,
            (None, None) => {
                return Err(AppError::Other("load_image needs a path or bytes".into()))
            }
        };
        let (w, h) = decoded.rgb.dimensions();
        let orientation = decoded.exif_orientation;
        let (id, _) = store.insert(decoded.rgb, orientation);
        log::info!("loaded {id}: {w}x{h} (EXIF orientation {orientation})");
        Ok(LoadedImageInfo {
            id,
            width: w,
            height: h,
            megapixels: (w as f32 * h as f32) / 1_000_000.0,
            exif_orientation: orientation,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("load_image task failed: {e}")))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetImageBytesArgs {
    pub id: String,
    /// Longest edge of the returned image. `None` uses the preview default;
    /// pass `0` to get the untouched original.
    pub max_dim: Option<u32>,
    /// "jpeg" (default, for previews) or "png".
    pub format: Option<String>,
}

#[tauri::command]
pub async fn get_image_bytes(
    state: State<'_, AppState>,
    args: GetImageBytesArgs,
) -> Result<Response> {
    let image = state.images.get(&args.id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (w, h) = image.dimensions();
        let max_dim = args.max_dim.unwrap_or(DEFAULT_PREVIEW_MAX_DIM);
        let longest = w.max(h);

        let rgb = if max_dim == 0 || longest <= max_dim {
            image.rgb.clone()
        } else {
            let scale = max_dim as f32 / longest as f32;
            resize::rgb_exact(
                &image.rgb,
                ((w as f32 * scale).round() as u32).max(1),
                ((h as f32 * scale).round() as u32).max(1),
            )?
        };

        let mut out = Cursor::new(Vec::new());
        match args.format.as_deref().unwrap_or("jpeg") {
            "png" => image::DynamicImage::ImageRgb8(rgb)
                .write_to(&mut out, ImageFormat::Png)
                .map_err(AppError::from)?,
            _ => {
                // 92 is visually lossless for an on-screen preview and roughly
                // a fifth the size of PNG for a photo.
                JpegEncoder::new_with_quality(&mut out, 92)
                    .write_image(
                        rgb.as_raw(),
                        rgb.width(),
                        rgb.height(),
                        image::ExtendedColorType::Rgb8,
                    )
                    .map_err(AppError::from)?;
            }
        }
        Ok(Response::new(out.into_inner()))
    })
    .await
    .map_err(|e| AppError::Other(format!("get_image_bytes task failed: {e}")))?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentProgress {
    pub id: String,
    pub stage: &'static str,
    pub label: &'static str,
    pub fraction: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentArgs {
    pub id: String,
    #[serde(default = "default_model")]
    pub model: SegModel,
    /// Re-run even if a mask is already cached (the HD/Standard toggle).
    #[serde(default)]
    pub force: bool,
}

fn default_model() -> SegModel {
    SegModel::Lite
}

/// Returns the full-resolution 8-bit alpha mask as PNG bytes, and emits
/// `segment://progress` while it works.
#[tauri::command]
pub async fn segment(
    app: AppHandle,
    state: State<'_, AppState>,
    args: SegmentArgs,
) -> Result<Response> {
    let image = state.images.get(&args.id)?;
    let engine = Arc::clone(&state.engine);
    let session = engine.segmentation_session(args.model)?;

    tauri::async_runtime::spawn_blocking(move || {
        if !args.force {
            if let Some(cached) = image.mask.lock().clone() {
                log::info!("{}: reusing cached mask", args.id);
                return Ok(Response::new(encode_mask(&cached)?));
            }
        }

        let id = args.id.clone();
        let mut emit = move |stage: segment::Stage| {
            let _ = app.emit(
                "segment://progress",
                SegmentProgress {
                    id: id.clone(),
                    stage: match stage {
                        segment::Stage::Preparing => "preparing",
                        segment::Stage::Running => "running",
                        segment::Stage::Upscaling => "upscaling",
                    },
                    label: stage.label(),
                    fraction: stage.fraction(),
                },
            );
        };

        let started = Instant::now();
        let mask = {
            let mut session = session.lock();
            segment::segment(&mut session, &image.rgb, &mut emit)?
        };
        let (w, h) = image.dimensions();
        log::info!(
            "segmented {}: {w}x{h} ({:.1} MP) with {:?} in {} ms on {} threads",
            args.id,
            (w as f32 * h as f32) / 1e6,
            args.model,
            started.elapsed().as_millis(),
            engine.intra_threads()
        );

        let mask = Arc::new(mask);
        *image.mask.lock() = Some(Arc::clone(&mask));
        Ok(Response::new(encode_mask(&mask)?))
    })
    .await
    .map_err(|e| AppError::Other(format!("segment task failed: {e}")))?
}

fn encode_mask(mask: &image::GrayImage) -> Result<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(mask.clone())
        .write_to(&mut out, ImageFormat::Png)
        .map_err(AppError::from)?;
    Ok(out.into_inner())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectFacesArgs {
    pub id: String,
}

#[tauri::command]
pub async fn detect_faces(
    state: State<'_, AppState>,
    args: DetectFacesArgs,
) -> Result<Vec<face::Face>> {
    let image = state.images.get(&args.id)?;
    let session = state.engine.face_session()?;

    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let faces = {
            let mut session = session.lock();
            face::detect(&mut session, &image.rgb)?
        };
        log::info!(
            "detected {} face(s) in {} in {} ms",
            faces.len(),
            args.id,
            started.elapsed().as_millis()
        );
        Ok(faces)
    })
    .await
    .map_err(|e| AppError::Other(format!("detect_faces task failed: {e}")))?
}

#[tauri::command]
pub fn model_status(state: State<'_, AppState>) -> Vec<models::ModelStatus> {
    models::model_status(state.engine.paths())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportModelArgs {
    /// The `.onnx` the user picked from a USB stick.
    pub path: String,
}

/// Offline install path for the HD model: copy it in, then verify. The copy goes
/// to a temp name first so a bad file never shadows a good one.
#[tauri::command]
pub async fn import_model(
    state: State<'_, AppState>,
    args: ImportModelArgs,
) -> Result<models::ModelStatus> {
    let paths = state.engine.paths().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&args.path);
        let dest = paths.segmentation(SegModel::Hd);
        let dir = dest.parent().ok_or_else(|| {
            AppError::Other("the model directory could not be determined".into())
        })?;
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io {
            path: dir.display().to_string(),
            source: e,
        })?;

        let staging = dest.with_extension("onnx.part");
        std::fs::copy(&src, &staging).map_err(|e| AppError::Io {
            path: src.display().to_string(),
            source: e,
        })?;

        if let Err(e) = models::verify_checksum(&staging, models::HD_SHA256) {
            let _ = std::fs::remove_file(&staging);
            return Err(e);
        }
        std::fs::rename(&staging, &dest).map_err(|e| AppError::Io {
            path: dest.display().to_string(),
            source: e,
        })?;

        models::model_status(&paths)
            .into_iter()
            .find(|m| m.id == "hd")
            .ok_or_else(|| AppError::Other("hd model status missing".into()))
    })
    .await
    .map_err(|e| AppError::Other(format!("import_model task failed: {e}")))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileArgs {
    pub path: String,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub async fn save_file(args: SaveFileArgs) -> Result<String> {
    // Gated in Rust, not only in the UI: the buttons are the courtesy, this
    // is the rule.
    crate::license::require_active()?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&args.path);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Io {
                path: dir.display().to_string(),
                source: e,
            })?;
        }
        std::fs::write(&path, &args.bytes).map_err(|e| AppError::Io {
            path: path.display().to_string(),
            source: e,
        })?;
        log::info!("wrote {} ({} bytes)", path.display(), args.bytes.len());
        Ok(path.display().to_string())
    })
    .await
    .map_err(|e| AppError::Other(format!("save_file task failed: {e}")))?
}

/// Free the originals when the user starts a new photo.
#[tauri::command]
pub fn release_image(state: State<'_, AppState>, id: Option<String>) {
    match id {
        Some(id) => state.images.remove(&id),
        None => state.images.clear(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub ort_loaded: bool,
    pub intra_threads: usize,
    pub resources_dir: String,
    pub user_models_dir: String,
    pub models: Vec<models::ModelStatus>,
}

/// Used by the About panel and by the M0 smoke test.
#[tauri::command]
pub fn runtime_info(state: State<'_, AppState>) -> RuntimeInfo {
    let engine = &state.engine;
    let ort_loaded = engine.ensure_runtime().is_ok();
    RuntimeInfo {
        ort_loaded,
        intra_threads: engine.intra_threads(),
        resources_dir: engine.paths().resources.display().to_string(),
        user_models_dir: engine.paths().user_models.display().to_string(),
        models: models::model_status(engine.paths()),
    }
}

#[tauri::command]
pub async fn list_printers() -> Result<Vec<crate::printing::PrinterInfo>> {
    tauri::async_runtime::spawn_blocking(crate::printing::list)
        .await
        .map_err(|e| AppError::Other(format!("list_printers task failed: {e}")))?
}

/// Open the driver's own properties sheet, so paper and quality are chosen
/// where the operator already knows how to choose them.
///
/// Returns true when the operator accepted the dialog, in which case the
/// chosen settings are kept and applied to every subsequent print.
#[tauri::command]
pub async fn printer_properties(window: tauri::Window, printer: String) -> Result<bool> {
    // The driver's dialog is a native window; giving it our HWND as owner
    // makes it modal to the app rather than opening behind it.
    #[cfg(windows)]
    let owner = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let owner = {
        let _ = &window;
        0isize
    };

    tauri::async_runtime::spawn_blocking(move || crate::printing::show_properties(&printer, owner))
        .await
        .map_err(|e| AppError::Other(format!("printer_properties task failed: {e}")))?
}

/// Whether this printer is using settings chosen in the driver's dialog
/// rather than the driver's defaults.
#[tauri::command]
pub fn printer_has_custom_settings(printer: String) -> bool {
    crate::printing::has_custom_settings(&printer)
}

#[tauri::command]
pub fn reset_printer_settings(printer: String) {
    crate::printing::clear_settings(&printer);
}

#[tauri::command]
pub async fn print_sheet(job: crate::printing::PrintJob) -> Result<()> {
    crate::license::require_active()?;
    tauri::async_runtime::spawn_blocking(move || crate::printing::print(job))
        .await
        .map_err(|e| AppError::Other(format!("print_sheet task failed: {e}")))?
}

#[tauri::command]
pub async fn print_sheets(job: crate::printing::MultiPrintJob) -> Result<()> {
    crate::license::require_active()?;
    tauri::async_runtime::spawn_blocking(move || crate::printing::print_many(job))
        .await
        .map_err(|e| AppError::Other(format!("print_sheets task failed: {e}")))?
}

// ---------------------------------------------------------------------------
// Licensing (BUILD_PLAN has no section for this; see docs/licensing.md)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn license_status() -> crate::license::LicenseStatus {
    crate::license::status()
}

#[tauri::command]
pub fn activate_license(key: String) -> Result<crate::license::LicenseStatus> {
    crate::license::activate(&key)
}

// --- attire templates ----------------------------------------------------

#[tauri::command]
pub fn list_attire(state: State<'_, AppState>) -> Vec<attire::AttireEntry> {
    attire::list(&state.attire_dir)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAttireArgs {
    pub path: String,
    pub name: String,
    pub group: String,
}

#[tauri::command]
pub async fn import_attire(
    state: State<'_, AppState>,
    args: ImportAttireArgs,
) -> Result<attire::AttireEntry> {
    let dir = state.attire_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        attire::import(&dir, &PathBuf::from(&args.path), &args.name, &args.group)
    })
    .await
    .map_err(|e| AppError::Other(format!("import_attire task failed: {e}")))?
}

#[tauri::command]
pub fn remove_attire(state: State<'_, AppState>, id: String) -> Result<()> {
    attire::remove(&state.attire_dir, &id)
}

#[tauri::command]
pub fn read_attire(state: State<'_, AppState>, id: String) -> Result<Response> {
    Ok(Response::new(attire::read(&state.attire_dir, &id)?))
}
