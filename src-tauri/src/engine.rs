//! ONNX Runtime lifecycle.
//!
//! The runtime is loaded dynamically from the bundled `onnxruntime.dll`, so the
//! build links nothing and the installer stays self-contained. Sessions are
//! expensive (the Lite model alone is 224 MB) so they are created on first use
//! and cached for the life of the process.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use parking_lot::Mutex;

use crate::error::{AppError, Result};
use crate::models::{ModelPaths, SegModel};

pub type SharedSession = Arc<Mutex<Session>>;

pub struct Engine {
    paths: ModelPaths,
    runtime_loaded: Mutex<bool>,
    sessions: Mutex<HashMap<PathBuf, SharedSession>>,
    intra_threads: usize,
}

impl Engine {
    pub fn new(paths: ModelPaths) -> Self {
        // ORT's CPU kernels scale with *physical* cores; counting hyperthreads
        // makes it slower, not faster.
        let intra_threads = num_cpus::get_physical().max(1);
        log::info!("inference will use {intra_threads} intra-op threads");
        Self {
            paths,
            runtime_loaded: Mutex::new(false),
            sessions: Mutex::new(HashMap::new()),
            intra_threads,
        }
    }

    pub fn paths(&self) -> &ModelPaths {
        &self.paths
    }

    pub fn intra_threads(&self) -> usize {
        self.intra_threads
    }

    /// Point ORT at the bundled dll. Idempotent; the first caller wins.
    pub fn ensure_runtime(&self) -> Result<()> {
        let mut loaded = self.runtime_loaded.lock();
        if *loaded {
            return Ok(());
        }
        let dll = self.paths.ort_dll();
        if !dll.is_file() {
            return Err(AppError::Runtime(format!(
                "{} is missing. Run scripts/fetch-models.ps1.",
                dll.display()
            )));
        }
        ort::init_from(&dll)
            .map_err(|e| AppError::Runtime(format!("could not load {}: {e}", dll.display())))?
            .with_name("PhilmerIDPhotoStudio")
            .commit();
        log::info!("ONNX Runtime loaded from {}", dll.display());
        *loaded = true;
        Ok(())
    }

    fn session_for(&self, path: &Path) -> Result<SharedSession> {
        self.ensure_runtime()?;
        if let Some(existing) = self.sessions.lock().get(path) {
            return Ok(Arc::clone(existing));
        }
        if !path.is_file() {
            return Err(AppError::ModelMissing {
                file: path.display().to_string(),
            });
        }

        let started = std::time::Instant::now();
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(self.intra_threads)?
            .commit_from_file(path)?;
        log::info!(
            "loaded {} in {} ms",
            path.file_name().unwrap_or_default().to_string_lossy(),
            started.elapsed().as_millis()
        );

        let shared: SharedSession = Arc::new(Mutex::new(session));
        self.sessions
            .lock()
            .insert(path.to_path_buf(), Arc::clone(&shared));
        Ok(shared)
    }

    pub fn segmentation_session(&self, model: SegModel) -> Result<SharedSession> {
        self.session_for(&self.paths.segmentation(model))
    }

    pub fn face_session(&self) -> Result<SharedSession> {
        self.session_for(&self.paths.yunet())
    }
}
