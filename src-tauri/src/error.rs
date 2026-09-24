//! One error type for every command, serialised to the frontend as a tagged
//! object so the UI can show the specific empty/error states in DESIGN_BRIEF §4.

use serde::Serialize;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("could not read {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("{0} isn't a format we can read yet. Please convert it to JPG.")]
    UnsupportedFormat(String),

    #[error("that image could not be decoded: {0}")]
    Decode(String),

    #[error("no image with id {0} is loaded")]
    UnknownImage(String),

    #[error("the {file} model isn't installed")]
    ModelMissing { file: String },

    #[error("{file} failed its integrity check (expected {expected}, got {actual})")]
    ChecksumMismatch {
        file: String,
        expected: String,
        actual: String,
    },

    #[error("no checksum is pinned for {file}; run scripts/fetch-models.ps1 -PrintHashes and pin it in models.rs")]
    ChecksumUnpinned { file: String },

    #[error("the AI runtime could not start: {0}")]
    Runtime(String),

    #[error("inference failed: {0}")]
    Inference(String),

    #[error("{0}")]
    Other(String),
}

/// `ort` parameterises its error by the operation that failed (a session
/// builder, a run, ...), so this has to be generic to cover them all.
impl<R> From<ort::Error<R>> for AppError {
    fn from(e: ort::Error<R>) -> Self {
        AppError::Inference(e.to_string())
    }
}

impl From<image::ImageError> for AppError {
    fn from(e: image::ImageError) -> Self {
        AppError::Decode(e.to_string())
    }
}

/// The frontend sees `{ kind, message, ...details }`.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let kind = match self {
            AppError::Io { .. } => "io",
            AppError::UnsupportedFormat(_) => "unsupportedFormat",
            AppError::Decode(_) => "decode",
            AppError::UnknownImage(_) => "unknownImage",
            AppError::ModelMissing { .. } => "modelMissing",
            AppError::ChecksumMismatch { .. } => "checksumMismatch",
            AppError::ChecksumUnpinned { .. } => "checksumUnpinned",
            AppError::Runtime(_) => "runtime",
            AppError::Inference(_) => "inference",
            AppError::Other(_) => "other",
        };
        let mut map = s.serialize_map(Some(2))?;
        map.serialize_entry("kind", kind)?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}
