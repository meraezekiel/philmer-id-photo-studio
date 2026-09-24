//! Model files: where they live, what they should hash to, and how the
//! optional HD model gets installed.
//!
//! Everything the app needs to work offline is bundled as a Tauri resource.
//! The only optional piece is the HD portrait model, which the user either
//! downloads from Settings or imports from a USB stick.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};

/// Checksums were computed from the files fetched by `scripts/fetch-models.ps1`
/// on 2026-09-24. `scripts/models.json` carries the same values for the fetch
/// scripts; if you ever change a model, update both.
pub const ORT_DLL: &str = "onnxruntime.dll";
pub const ORT_DLL_SHA256: &str =
    "1becbd71adbf49609d33195e29c9214969db3c3de69c81425bebe5a4b69aef97";

pub const LITE_FILE: &str = "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx";
pub const LITE_SHA256: &str =
    "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333";
pub const LITE_BYTES: u64 = 224_005_088;

pub const YUNET_FILE: &str = "face_detection_yunet_2023mar.onnx";
pub const YUNET_SHA256: &str =
    "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
pub const YUNET_BYTES: u64 = 232_589;

pub const HD_FILE: &str = "BiRefNet-portrait-epoch_150.onnx";
pub const HD_BYTES: u64 = 972_666_916;
pub const HD_URL: &str =
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-portrait-epoch_150.onnx";
/// Pinned from the same 2026-09-24 fetch. `download_model` and `import_model`
/// both refuse a file that does not match this.
pub const HD_SHA256: &str =
    "1ba1c8ff5a7bbfadc8d8d13fb11d7be793f91f23d9d466549e37a854f6668f99";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SegModel {
    Lite,
    Hd,
}

impl SegModel {
    pub fn file_name(self) -> &'static str {
        match self {
            SegModel::Lite => LITE_FILE,
            SegModel::Hd => HD_FILE,
        }
    }
}

/// Resolved locations for everything the Rust side loads.
#[derive(Debug, Clone)]
pub struct ModelPaths {
    /// Bundled, read-only: `<install dir>/resources`.
    pub resources: PathBuf,
    /// User-writable: `%APPDATA%/<identifier>/models`.
    pub user_models: PathBuf,
}

impl ModelPaths {
    pub fn ort_dll(&self) -> PathBuf {
        self.resources.join(ORT_DLL)
    }

    pub fn yunet(&self) -> PathBuf {
        self.resources.join(YUNET_FILE)
    }

    /// Lite ships with the app; HD only ever lives in the user directory.
    pub fn segmentation(&self, model: SegModel) -> PathBuf {
        match model {
            SegModel::Lite => self.resources.join(LITE_FILE),
            SegModel::Hd => self.user_models.join(HD_FILE),
        }
    }
}

/// What Settings → Models shows for one model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub installed: bool,
    pub bundled: bool,
    pub size_bytes: u64,
    pub path: Option<String>,
}

pub fn model_status(paths: &ModelPaths) -> Vec<ModelStatus> {
    let lite = paths.segmentation(SegModel::Lite);
    let hd = paths.segmentation(SegModel::Hd);
    vec![
        ModelStatus {
            id: "lite",
            label: "Standard (Lite)",
            installed: lite.is_file(),
            bundled: true,
            size_bytes: LITE_BYTES,
            path: lite.to_str().map(str::to_owned),
        },
        ModelStatus {
            id: "hd",
            label: "HD Portrait",
            installed: hd.is_file(),
            bundled: false,
            size_bytes: HD_BYTES,
            path: hd.is_file().then(|| hd.to_string_lossy().into_owned()),
        },
    ]
}

/// Streaming SHA-256 so a 973 MB model never has to be held in memory.
pub fn sha256_file(path: &Path) -> Result<String> {
    let file = File::open(path).map_err(|e| AppError::Io {
        path: path.display().to_string(),
        source: e,
    })?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = reader.read(&mut buf).map_err(|e| AppError::Io {
            path: path.display().to_string(),
            source: e,
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Verify a file against a pinned checksum. An unpinned placeholder is treated
/// as a hard error rather than silently accepting whatever is on disk.
pub fn verify_checksum(path: &Path, expected: &str) -> Result<()> {
    if expected.starts_with("@@") {
        return Err(AppError::ChecksumUnpinned {
            file: path.display().to_string(),
        });
    }
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(AppError::ChecksumMismatch {
            file: path.display().to_string(),
            expected: expected.to_owned(),
            actual,
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(64), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}
