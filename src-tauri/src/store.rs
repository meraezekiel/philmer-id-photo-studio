//! Loaded photos live here for the life of the job.
//!
//! BUILD_PLAN §10: the canvas gets a downscaled preview, but the export is
//! always composited from the full-resolution original, so the original never
//! leaves memory until the user starts a new photo.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use image::{GrayImage, RgbImage};
use parking_lot::Mutex;

use crate::error::{AppError, Result};

pub struct LoadedImage {
    pub rgb: RgbImage,
    pub exif_orientation: u16,
    /// Cached full-resolution alpha, so changing the crop never re-runs the model.
    pub mask: Mutex<Option<Arc<GrayImage>>>,
}

impl LoadedImage {
    pub fn dimensions(&self) -> (u32, u32) {
        self.rgb.dimensions()
    }
}

#[derive(Default)]
pub struct ImageStore {
    next_id: AtomicU64,
    images: Mutex<HashMap<String, Arc<LoadedImage>>>,
}

impl ImageStore {
    pub fn insert(&self, rgb: RgbImage, exif_orientation: u16) -> (String, Arc<LoadedImage>) {
        let id = format!("img-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let image = Arc::new(LoadedImage {
            rgb,
            exif_orientation,
            mask: Mutex::new(None),
        });
        self.images.lock().insert(id.clone(), Arc::clone(&image));
        (id, image)
    }

    pub fn get(&self, id: &str) -> Result<Arc<LoadedImage>> {
        self.images
            .lock()
            .get(id)
            .map(Arc::clone)
            .ok_or_else(|| AppError::UnknownImage(id.to_owned()))
    }

    pub fn remove(&self, id: &str) {
        self.images.lock().remove(id);
    }

    /// Called when the user starts a new photo; 24 MP originals are too big to
    /// keep around speculatively.
    pub fn clear(&self) {
        self.images.lock().clear();
    }

    pub fn len(&self) -> usize {
        self.images.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_lookup_round_trips() {
        let store = ImageStore::default();
        let (a, _) = store.insert(RgbImage::new(2, 2), 1);
        let (b, _) = store.insert(RgbImage::new(2, 2), 1);
        assert_ne!(a, b);
        assert!(store.get(&a).is_ok());
        assert_eq!(store.len(), 2);
    }

    #[test]
    fn an_unknown_id_is_an_error_not_a_panic() {
        let store = ImageStore::default();
        assert!(matches!(
            store.get("nope"),
            Err(AppError::UnknownImage(ref id)) if id == "nope"
        ));
    }

    #[test]
    fn clear_frees_everything() {
        let store = ImageStore::default();
        store.insert(RgbImage::new(2, 2), 1);
        store.clear();
        assert!(store.is_empty());
    }
}
