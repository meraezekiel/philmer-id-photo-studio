//! Decoding with EXIF orientation applied. Phone photos are the normal input
//! here, so getting this wrong means every other stage sees a sideways face.

use std::io::Cursor;
use std::path::Path;

use image::{DynamicImage, RgbImage};

use crate::error::{AppError, Result};

/// Formats we decode. HEIC is deliberately absent: BUILD_PLAN §5 asks for a
/// friendly "convert to JPG" message in v1 rather than a half-working decoder.
const SUPPORTED: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp"];

pub fn is_supported_extension(ext: &str) -> bool {
    SUPPORTED.contains(&ext.to_ascii_lowercase().as_str())
}

/// A decoded, upright image plus the EXIF tag we honoured.
pub struct Decoded {
    pub rgb: RgbImage,
    pub exif_orientation: u16,
}

pub fn decode_path(path: &Path) -> Result<Decoded> {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if !is_supported_extension(ext) {
            return Err(AppError::UnsupportedFormat(ext.to_ascii_uppercase()));
        }
    }
    let bytes = std::fs::read(path).map_err(|e| AppError::Io {
        path: path.display().to_string(),
        source: e,
    })?;
    decode_bytes(&bytes)
}

pub fn decode_bytes(bytes: &[u8]) -> Result<Decoded> {
    // Reject HEIC by magic bytes too, so a mislabelled .jpg still gets the
    // friendly message instead of a decoder error.
    if looks_like_heic(bytes) {
        return Err(AppError::UnsupportedFormat("HEIC".into()));
    }

    let orientation = read_exif_orientation(bytes).unwrap_or(1);
    let img = image::load_from_memory(bytes)?;
    let rgb = apply_orientation(img, orientation).to_rgb8();

    Ok(Decoded {
        rgb,
        exif_orientation: orientation,
    })
}

fn looks_like_heic(bytes: &[u8]) -> bool {
    // ISO-BMFF: [4-byte size]"ftyp"[brand]
    bytes.len() > 12
        && &bytes[4..8] == b"ftyp"
        && matches!(
            &bytes[8..12],
            b"heic" | b"heix" | b"hevc" | b"heim" | b"heis" | b"hevm" | b"mif1" | b"msf1"
        )
}

fn read_exif_orientation(bytes: &[u8]) -> Option<u16> {
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()?;
    exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?
        .value
        .get_uint(0)
        .map(|v| v as u16)
}

/// The eight EXIF orientations, in the order the spec defines them.
fn apply_orientation(img: DynamicImage, orientation: u16) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heic_is_rejected_with_a_friendly_message() {
        let mut bytes = vec![0u8; 16];
        bytes[4..8].copy_from_slice(b"ftyp");
        bytes[8..12].copy_from_slice(b"heic");
        // `Decoded` holds a whole image buffer, so avoid `unwrap_err`'s Debug.
        let Err(err) = decode_bytes(&bytes) else {
            panic!("a HEIC header should not decode");
        };
        assert!(matches!(err, AppError::UnsupportedFormat(ref f) if f == "HEIC"));
        assert!(err.to_string().contains("convert it to JPG"));
    }

    #[test]
    fn orientation_6_rotates_a_landscape_image_to_portrait() {
        let img = DynamicImage::new_rgb8(40, 10);
        let out = apply_orientation(img, 6);
        assert_eq!((out.width(), out.height()), (10, 40));
    }

    #[test]
    fn extension_gate_matches_the_plan() {
        for ok in ["jpg", "JPEG", "png", "webp", "bmp"] {
            assert!(is_supported_extension(ok), "{ok} should be supported");
        }
        for bad in ["heic", "tif", "gif"] {
            assert!(!is_supported_extension(bad), "{bad} should not be");
        }
    }
}
