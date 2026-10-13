//! The Photo Book's commands. Everything heavy runs on a blocking thread.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::book::{self, Expanded, NormRect};
use crate::error::{AppError, Result};
use crate::face;
use crate::state::AppState;

fn task_failed(name: &str, e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("{name} task failed: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct AddPhoto {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPhotoInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub taken_at: Option<String>,
    pub face: Option<NormRect>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookProgress {
    pub done: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn book_add_photos(
    app: AppHandle,
    state: State<'_, AppState>,
    photos: Vec<AddPhoto>,
) -> Result<Vec<BookPhotoInfo>> {
    let thumbs = Arc::clone(&state.book_thumbs);
    // A missing face model only costs the face-aware first crop.
    let session = state.engine.face_session().ok();
    tauri::async_runtime::spawn_blocking(move || {
        // Each worker holds one full decode; four keeps a 24 MP batch near 300 MB.
        let threads = num_cpus::get_physical().clamp(1, 4);
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let total = photos.len();
        let done = AtomicUsize::new(0);
        let infos = pool.install(|| {
            photos
                .par_iter()
                .map(|p| {
                    let path = Path::new(&p.path);
                    let result = book::make_thumbnail(path);
                    let n = done.fetch_add(1, Ordering::SeqCst) + 1;
                    let _ = app.emit("book://progress", BookProgress { done: n, total });
                    match result {
                        Ok(t) => {
                            let face = session.as_ref().and_then(|s| {
                                let mut s = s.lock();
                                face::detect(&mut s, &t.small).ok()
                            });
                            let face = face.and_then(|f| book::largest_face(&f, t.small.width(), t.small.height()));
                            thumbs.insert(p.id.clone(), t.jpeg);
                            BookPhotoInfo {
                                id: p.id.clone(),
                                path: p.path.clone(),
                                name: book::file_name(path),
                                width: t.width,
                                height: t.height,
                                taken_at: t.taken_at,
                                face,
                                error: None,
                            }
                        }
                        Err(e) => BookPhotoInfo {
                            id: p.id.clone(),
                            path: p.path.clone(),
                            name: book::file_name(path),
                            width: 0,
                            height: 0,
                            taken_at: None,
                            face: None,
                            error: Some(e.to_string()),
                        },
                    }
                })
                .collect::<Vec<_>>()
        });
        log::info!("book: loaded {} of {} photos", infos.iter().filter(|i| i.error.is_none()).count(), total);
        Ok(infos)
    })
    .await
    .map_err(|e| task_failed("book_add_photos", e))?
}

#[tauri::command]
pub fn book_thumb(state: State<'_, AppState>, id: String) -> Result<Response> {
    Ok(Response::new(state.book_thumbs.get(&id)?.as_ref().clone()))
}

#[derive(Debug, Deserialize)]
pub struct RenderPhotoArgs {
    pub path: String,
    pub crop: NormRect,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn book_render_photo(args: RenderPhotoArgs) -> Result<Response> {
    tauri::async_runtime::spawn_blocking(move || {
        let rgb = book::render_crop(Path::new(&args.path), args.crop, args.width, args.height)?;
        Ok(Response::new(book::to_rgba(&rgb)))
    })
    .await
    .map_err(|e| task_failed("book_render_photo", e))?
}

#[tauri::command]
pub fn book_clear(state: State<'_, AppState>) {
    state.book_thumbs.clear();
}

#[tauri::command]
pub async fn book_expand_paths(paths: Vec<String>) -> Result<Expanded> {
    tauri::async_runtime::spawn_blocking(move || Ok(book::expand_paths(&paths)))
        .await
        .map_err(|e| task_failed("book_expand_paths", e))?
}

#[tauri::command]
pub async fn book_find_in_folder(folder: String, names: Vec<String>) -> Result<HashMap<String, Vec<String>>> {
    tauri::async_runtime::spawn_blocking(move || Ok(book::find_in_folder(Path::new(&folder), &names)))
        .await
        .map_err(|e| task_failed("book_find_in_folder", e))?
}

#[tauri::command]
pub async fn book_read_project(path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || book::read_project(Path::new(&path)))
        .await
        .map_err(|e| task_failed("book_read_project", e))?
}

/// Not licence-gated: saving the operator's work is not producing output.
#[tauri::command]
pub async fn book_write_project(path: String, text: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || book::write_project(Path::new(&path), &text))
        .await
        .map_err(|e| task_failed("book_write_project", e))?
}

fn app_data(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir().map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn book_autosave_write(app: AppHandle, text: String) -> Result<()> {
    let path = book::autosave_path(&app_data(&app)?);
    tauri::async_runtime::spawn_blocking(move || book::write_project(&path, &text))
        .await
        .map_err(|e| task_failed("book_autosave_write", e))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Autosave {
    pub text: String,
    pub saved_at_ms: u64,
}

#[tauri::command]
pub async fn book_autosave_read(app: AppHandle) -> Result<Option<Autosave>> {
    let path = book::autosave_path(&app_data(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        if !path.is_file() {
            return Ok(None);
        }
        let text = book::read_project(&path)?;
        let saved_at_ms = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(Some(Autosave { text, saved_at_ms }))
    })
    .await
    .map_err(|e| task_failed("book_autosave_read", e))?
}

#[tauri::command]
pub fn book_autosave_clear(app: AppHandle) -> Result<()> {
    let path = book::autosave_path(&app_data(&app)?);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::Io { path: path.display().to_string(), source: e }),
    }
}

/// Raw-body commands: the bytes arrive as the request body, not as a JSON
/// number array, so a 200 MB print PDF never becomes a 1 GB string.
fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err(AppError::Other("expected the file's bytes as the request body".into())),
    }
}

fn header(request: &Request<'_>, name: &str) -> Result<String> {
    let value = request
        .headers()
        .get(name)
        .ok_or_else(|| AppError::Other(format!("the {name} header is missing")))?;
    let value = value.to_str().map_err(|_| AppError::Other(format!("the {name} header is not text")))?;
    book::decode_header(value)
}

/// The book's exports (PDFs and JPGs). Licence-gated like `save_file`.
///
/// The write runs right here rather than on a blocking thread: the body is
/// borrowed from the request, and copying a large PDF to move it would double
/// the memory it costs.
#[tauri::command]
pub async fn book_save_bytes(request: Request<'_>) -> Result<String> {
    crate::license::require_active()?;
    let path = PathBuf::from(header(&request, "path")?);
    let bytes = raw_body(&request)?;
    book::save_bytes(&path, bytes)?;
    log::info!("book: wrote {} ({} bytes)", path.display(), bytes.len());
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn book_stage_sheet(request: Request<'_>) -> Result<String> {
    let index: u32 = header(&request, "index")?
        .parse()
        .map_err(|_| AppError::Other("the sheet index is not a number".into()))?;
    let bytes = raw_body(&request)?;
    Ok(book::stage_sheet(&book::staging_dir(), index, bytes)?.display().to_string())
}

#[tauri::command]
pub fn book_clear_staged() {
    book::clear_staged(&book::staging_dir());
}
