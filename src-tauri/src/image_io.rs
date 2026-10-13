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

/// The extension gate on its own, for callers that read the bytes themselves.
pub fn check_extension(path: &Path) -> Result<()> {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if !is_supported_extension(ext) {
            return Err(AppError::UnsupportedFormat(ext.to_ascii_uppercase()));
        }
    }
    Ok(())
}

pub fn decode_path(path: &Path) -> Result<Decoded> {
    check_extension(path)?;
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

/// When the photo was taken, as ISO 8601 ("2026-10-12T14:03:22"), from
/// DateTimeOriginal or, failing that, DateTime.
pub fn read_taken_at(bytes: &[u8]) -> Option<String> {
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()?;
    let field = exif
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .or_else(|| exif.get_field(exif::Tag::DateTime, exif::In::PRIMARY))?;
    match &field.value {
        exif::Value::Ascii(parts) => parts
            .first()
            .and_then(|raw| std::str::from_utf8(raw).ok())
            .and_then(exif_datetime_to_iso),
        _ => None,
    }
}

/// "2026:10:12 14:03:22" -> "2026-10-12T14:03:22". Cameras with an unset
/// clock write zeros; those are treated as no date.
pub fn exif_datetime_to_iso(raw: &str) -> Option<String> {
    let raw = raw.trim_end_matches('\0').trim();
    let b = raw.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    if !digits.iter().all(|&i| b[i].is_ascii_digit()) {
        return None;
    }
    if b[4] != b':' || b[7] != b':' || b[13] != b':' || b[16] != b':' || &raw[0..4] == "0000" {
        return None;
    }
    Some(format!("{}-{}-{}T{}", &raw[0..4], &raw[5..7], &raw[8..10], &raw[11..19]))
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
    fn exif_dates_become_iso() {
        assert_eq!(exif_datetime_to_iso("2026:10:12 14:03:22").as_deref(), Some("2026-10-12T14:03:22"));
        assert_eq!(exif_datetime_to_iso("2026:10:12 14:03:22\0").as_deref(), Some("2026-10-12T14:03:22"));
        assert_eq!(exif_datetime_to_iso("0000:00:00 00:00:00"), None);
        assert_eq!(exif_datetime_to_iso("yesterday"), None);
        assert_eq!(exif_datetime_to_iso(""), None);
    }

    #[test]
    fn a_photo_without_exif_has_no_date() {
        assert_eq!(read_taken_at(&[0xFF, 0xD8, 0xFF, 0xD9]), None);
    }

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
