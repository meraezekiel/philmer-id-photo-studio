//! The operator's own attire templates: PNGs with transparency, kept in
//! `<app data>/attire` with an `attire.json` manifest beside them.
//!
//! The shipped placeholders live in the frontend bundle; only uploads come
//! through here. Uploads never go near the repo or the installer, which is
//! the point: a shop's downloaded templates stay on that shop's machine.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

const MANIFEST: &str = "attire.json";
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttireEntry {
    pub id: String,
    pub name: String,
    /// `men`, `women` or `other`.
    pub group: String,
    pub file: String,
    pub added_at: String,
}

fn io_err(path: &Path, source: std::io::Error) -> AppError {
    AppError::Io {
        path: path.display().to_string(),
        source,
    }
}

/// Does this PNG carry transparency? Colour types 4 and 6 have an alpha
/// channel; any other type is transparent only with a `tRNS` chunk.
pub fn png_has_transparency(bytes: &[u8]) -> Result<bool> {
    if bytes.len() < 33 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return Err(AppError::UnsupportedFormat(
            "That file is not a PNG. Attire templates must be PNG images with a transparent background"
                .into(),
        ));
    }
    let colour_type = bytes[25];
    if colour_type == 4 || colour_type == 6 {
        return Ok(true);
    }
    let mut i = 8;
    while i + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
        let kind = &bytes[i + 4..i + 8];
        if kind == b"tRNS" {
            return Ok(true);
        }
        if kind == b"IDAT" || kind == b"IEND" {
            break;
        }
        i += 12 + len;
    }
    Ok(false)
}

/// The manifest as written; a missing or unreadable one is an empty library,
/// so a damaged file never takes the step down with it.
fn read_manifest(dir: &Path) -> Vec<AttireEntry> {
    fs::read(dir.join(MANIFEST))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_manifest(dir: &Path, entries: &[AttireEntry]) -> Result<()> {
    let path = dir.join(MANIFEST);
    let staging = dir.join("attire.json.part");
    let json = serde_json::to_vec_pretty(entries).map_err(|e| AppError::Other(e.to_string()))?;
    fs::write(&staging, json).map_err(|e| io_err(&staging, e))?;
    fs::rename(&staging, &path).map_err(|e| io_err(&path, e))
}

pub fn list(dir: &Path) -> Vec<AttireEntry> {
    read_manifest(dir)
        .into_iter()
        .filter(|e| dir.join(&e.file).is_file())
        .collect()
}

pub fn import(dir: &Path, src: &Path, name: &str, group: &str) -> Result<AttireEntry> {
    let bytes = fs::read(src).map_err(|e| io_err(src, e))?;
    if !png_has_transparency(&bytes)? {
        return Err(AppError::Other(
            "That PNG has no transparent pixels. Remove the background first so only the clothing is left."
                .into(),
        ));
    }
    let group = match group {
        "men" | "women" => group,
        _ => "other",
    };

    fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let id = format!("{:x}", now.as_nanos());
    let file = format!("{id}.png");
    let dest = dir.join(&file);
    let staging = dir.join(format!("{id}.png.part"));
    fs::write(&staging, &bytes).map_err(|e| io_err(&staging, e))?;
    fs::rename(&staging, &dest).map_err(|e| io_err(&dest, e))?;

    let name = name.trim();
    let entry = AttireEntry {
        id,
        name: if name.is_empty() { "Template".into() } else { name.into() },
        group: group.into(),
        file,
        added_at: format!("{}", now.as_secs()),
    };
    let mut entries = list(dir);
    entries.push(entry.clone());
    write_manifest(dir, &entries)?;
    Ok(entry)
}

pub fn remove(dir: &Path, id: &str) -> Result<()> {
    let mut entries = read_manifest(dir);
    if let Some(pos) = entries.iter().position(|e| e.id == id) {
        let entry = entries.remove(pos);
        let _ = fs::remove_file(dir.join(&entry.file));
        write_manifest(dir, &entries)?;
    }
    Ok(())
}

pub fn read(dir: &Path, id: &str) -> Result<Vec<u8>> {
    let entry = read_manifest(dir)
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::Other(format!("no attire template with id {id}")))?;
    let path: PathBuf = dir.join(entry.file);
    fs::read(&path).map_err(|e| io_err(&path, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(colour_type: u8, trns: bool) -> Vec<u8> {
        let mut b = PNG_SIGNATURE.to_vec();
        b.extend_from_slice(&13u32.to_be_bytes());
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 1, 8, colour_type, 0, 0, 0]);
        b.extend_from_slice(&[0, 0, 0, 0]); // crc, unchecked
        if trns {
            b.extend_from_slice(&1u32.to_be_bytes());
            b.extend_from_slice(b"tRNS");
            b.extend_from_slice(&[0, 0, 0, 0, 0]);
        }
        b.extend_from_slice(&0u32.to_be_bytes());
        b.extend_from_slice(b"IEND");
        b.extend_from_slice(&[0, 0, 0, 0]);
        b
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "attire-test-{tag}-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn transparency_detection() {
        assert!(png_has_transparency(&png(6, false)).unwrap());
        assert!(png_has_transparency(&png(4, false)).unwrap());
        assert!(png_has_transparency(&png(2, true)).unwrap());
        assert!(!png_has_transparency(&png(2, false)).unwrap());
        assert!(png_has_transparency(b"\xFF\xD8\xFFnot a png at all, a jpeg header....").is_err());
    }

    #[test]
    fn corrupt_manifest_is_an_empty_library() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(MANIFEST), b"{not json").unwrap();
        assert!(list(&dir).is_empty());
    }

    #[test]
    fn import_list_read_remove() {
        let dir = temp_dir("roundtrip");
        let src = dir.join("in.png");
        fs::write(&src, png(6, false)).unwrap();

        let entry = import(&dir.join("lib"), &src, "  Grey suit ", "men").unwrap();
        assert_eq!(entry.name, "Grey suit");
        assert_eq!(list(&dir.join("lib")), vec![entry.clone()]);
        assert_eq!(read(&dir.join("lib"), &entry.id).unwrap(), png(6, false));

        remove(&dir.join("lib"), &entry.id).unwrap();
        assert!(list(&dir.join("lib")).is_empty());
        assert!(!dir.join("lib").join(&entry.file).exists());
    }

    #[test]
    fn opaque_png_and_missing_files() {
        let dir = temp_dir("reject");
        let src = dir.join("flat.png");
        fs::write(&src, png(2, false)).unwrap();
        assert!(import(&dir, &src, "Flat", "men").is_err());
        assert!(list(&dir).is_empty());

        // An entry whose file was deleted outside the app is dropped.
        fs::write(&src, png(6, false)).unwrap();
        let entry = import(&dir, &src, "Gone", "bogus").unwrap();
        assert_eq!(entry.group, "other");
        fs::remove_file(dir.join(&entry.file)).unwrap();
        assert!(list(&dir).is_empty());
    }
}
