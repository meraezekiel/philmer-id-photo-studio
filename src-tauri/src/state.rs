//! Shared app state, resolved once at startup.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::book::ThumbStore;
use crate::engine::Engine;
use crate::models::ModelPaths;
use crate::store::ImageStore;

pub struct AppState {
    pub engine: Arc<Engine>,
    pub images: Arc<ImageStore>,
    /// The operator's uploaded attire templates (`attire.rs`).
    pub attire_dir: PathBuf,
    /// Photo Book thumbnails; the originals stay on disk (`book.rs`).
    pub book_thumbs: Arc<ThumbStore>,
}

impl AppState {
    pub fn from_app(app: &AppHandle) -> Result<Self, tauri::Error> {
        // In a bundled install this is `<install dir>/resources`; under
        // `tauri dev` it resolves to `src-tauri/resources`.
        let resources = app.path().resolve("resources", BaseDirectory::Resource)?;
        let user_models = app.path().app_data_dir()?.join("models");
        std::fs::create_dir_all(&user_models).ok();
        let attire_dir = app.path().app_data_dir()?.join("attire");
        std::fs::create_dir_all(&attire_dir).ok();

        log::info!("resources: {}", resources.display());
        log::info!("user models: {}", user_models.display());

        Ok(Self {
            engine: Arc::new(Engine::new(ModelPaths {
                resources,
                user_models,
            })),
            images: Arc::new(ImageStore::default()),
            attire_dir,
            book_thumbs: Arc::new(ThumbStore::default()),
        })
    }
}
