//! Trial and licence checks — see `docs/licensing.md` for the whole design.
//!
//! Everything here is offline and local. The machine fingerprint identifies
//! the PC, a signed key names one fingerprint, and the trial record says when
//! this PC first ran the app. Nothing is phoned home, because the shops this
//! is sold to are exactly the ones without reliable internet.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use license_core::{day_number, format_machine_id, fingerprint, validate, KeyError};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};

pub const TRIAL_DAYS: u32 = 14;

/// Keys the trial record so a hand-edited file is rejected. The secret is in
/// the binary, so this stops an operator with Notepad, not a reverse
/// engineer — which is the honest limit of any offline trial.
const TRIAL_SECRET: &[u8] = b"philmer-trial-v1-V8cQ2mXr";

const VENDOR_DIR: &str = "Philmer ID Photo Studio";
const LICENSE_FILE: &str = "license.key";
const TRIAL_FILE: &str = "trial.dat";
const REGISTRY_PATH: &str = r"Software\Philmer Digi Art\Philmer ID Photo Studio";
const REGISTRY_VALUE: &str = "State";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    /// `licensed`, `trial`, or `expired`.
    pub state: &'static str,
    /// `A1B2-C3D4-E5F6-7890`, for the operator to read out to the vendor.
    pub machine_id: String,
    /// Whole days left in a trial; `0` once it is over, `-1` when licensed.
    pub days_left: i64,
    pub trial_days: u32,
    /// The vendor's customer number from the key, for support calls.
    pub customer: u32,
    /// Set when a licence is time-limited rather than permanent.
    pub expires_in_days: Option<i64>,
    /// Why a trial ended, when it was not simply time: a wound-back clock.
    pub note: Option<String>,
}

impl LicenseStatus {
    /// Whether this install may produce output — save, export or print.
    pub fn can_produce(&self) -> bool {
        self.state != "expired"
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn today() -> u32 {
    day_number(now_seconds())
}

// ---------------------------------------------------------------------------
// The machine fingerprint
// ---------------------------------------------------------------------------

/// Windows' own installation GUID plus the system drive's volume serial.
///
/// The GUID survives hardware changes; the volume serial survives Windows
/// updates. Neither survives a reinstall or a reformat, which is why the
/// runbook has a reissue step.
#[cfg(windows)]
pub fn machine_fingerprint() -> [u8; 8] {
    let guid = registry_machine_guid().unwrap_or_else(|| "no-machine-guid".to_string());
    let volume = volume_serial().unwrap_or(0).to_string();
    fingerprint(&[&guid, &volume])
}

#[cfg(not(windows))]
pub fn machine_fingerprint() -> [u8; 8] {
    // Only Windows is shipped; this keeps the crate building elsewhere.
    fingerprint(&["non-windows", "dev"])
}

#[cfg(windows)]
fn registry_machine_guid() -> Option<String> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY,
    };

    let mut buffer = [0u16; 128];
    let mut size = (buffer.len() * 2) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!(r"SOFTWARE\Microsoft\Cryptography"),
            w!("MachineGuid"),
            RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
            None,
            Some(buffer.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    let _ = PCWSTR::null();
    let len = (size as usize / 2).saturating_sub(1).min(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(windows)]
fn volume_serial() -> Option<u32> {
    use windows::core::w;
    use windows::Win32::Storage::FileSystem::GetVolumeInformationW;

    let mut serial = 0u32;
    let ok = unsafe {
        GetVolumeInformationW(
            w!("C:\\"),
            None,
            Some(&mut serial),
            None,
            None,
            None,
        )
    };
    ok.ok().map(|_| serial)
}

pub fn machine_id() -> String {
    format_machine_id(&machine_fingerprint())
}

// ---------------------------------------------------------------------------
// Where things are kept
// ---------------------------------------------------------------------------

/// `%PROGRAMDATA%\Philmer ID Photo Studio` — machine-wide, so a second
/// Windows user on the same counter PC shares one licence and one trial.
fn vendor_dir() -> PathBuf {
    let base = std::env::var("ProgramData")
        .or_else(|_| std::env::var("APPDATA"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join(VENDOR_DIR)
}

fn license_path() -> PathBuf {
    vendor_dir().join(LICENSE_FILE)
}

fn trial_path() -> PathBuf {
    vendor_dir().join(TRIAL_FILE)
}

fn read_license_key() -> Option<String> {
    std::fs::read_to_string(license_path()).ok()
}

// ---------------------------------------------------------------------------
// The trial record
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct TrialRecord {
    first_day: u32,
    last_seen: u32,
    /// Set once the clock has been caught going backwards.
    tampered: bool,
}

fn tag(payload: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(TRIAL_SECRET);
    hasher.update(payload.as_bytes());
    hasher
        .finalize()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn encode_trial(record: &TrialRecord, machine: &[u8; 8]) -> String {
    let payload = format!(
        "1|{}|{}|{}|{}",
        record.first_day,
        record.last_seen,
        u8::from(record.tampered),
        format_machine_id(machine)
    );
    format!("{payload}|{}", tag(&payload))
}

/// A record that fails its tag, or belongs to another machine, is ignored —
/// which starts the trial again on a *new* PC, and refuses a copied file.
fn decode_trial(text: &str, machine: &[u8; 8]) -> Option<TrialRecord> {
    let text = text.trim();
    let (payload, found) = text.rsplit_once('|')?;
    if tag(payload) != found {
        return None;
    }
    let mut parts = payload.split('|');
    if parts.next()? != "1" {
        return None;
    }
    let first_day = parts.next()?.parse().ok()?;
    let last_seen = parts.next()?.parse().ok()?;
    let tampered = parts.next()? == "1";
    if parts.next()? != format_machine_id(machine) {
        return None;
    }
    Some(TrialRecord {
        first_day,
        last_seen,
        tampered,
    })
}

#[cfg(windows)]
fn registry_read() -> Option<String> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

    let mut buffer = [0u16; 256];
    let mut size = (buffer.len() * 2) as u32;
    let path: Vec<u16> = REGISTRY_PATH.encode_utf16().chain(std::iter::once(0)).collect();
    let name: Vec<u16> = REGISTRY_VALUE.encode_utf16().chain(std::iter::once(0)).collect();
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            windows::core::PCWSTR(path.as_ptr()),
            windows::core::PCWSTR(name.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    };
    let _ = w!("");
    if status.is_err() {
        return None;
    }
    let len = (size as usize / 2).saturating_sub(1).min(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(windows)]
fn registry_write(value: &str) {
    use windows::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

    let path: Vec<u16> = REGISTRY_PATH.encode_utf16().chain(std::iter::once(0)).collect();
    let name: Vec<u16> = REGISTRY_VALUE.encode_utf16().chain(std::iter::once(0)).collect();
    let data: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = RegSetKeyValueW(
            HKEY_CURRENT_USER,
            windows::core::PCWSTR(path.as_ptr()),
            windows::core::PCWSTR(name.as_ptr()),
            REG_SZ.0,
            Some(data.as_ptr() as *const _),
            (data.len() * 2) as u32,
        );
    }
}

#[cfg(not(windows))]
fn registry_read() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn registry_write(_value: &str) {}

/// Read both copies of the trial record and believe the *worst* of them: the
/// earliest start and the latest sighting. Deleting one does not help, and
/// neither does restoring an old one.
fn load_trial(machine: &[u8; 8]) -> Option<TrialRecord> {
    let from_file = std::fs::read_to_string(trial_path())
        .ok()
        .and_then(|text| decode_trial(&text, machine));
    let from_registry = registry_read().and_then(|text| decode_trial(&text, machine));

    match (from_file, from_registry) {
        (Some(a), Some(b)) => Some(TrialRecord {
            first_day: a.first_day.min(b.first_day),
            last_seen: a.last_seen.max(b.last_seen),
            tampered: a.tampered || b.tampered,
        }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn save_trial(record: &TrialRecord, machine: &[u8; 8]) {
    let encoded = encode_trial(record, machine);
    let _ = std::fs::create_dir_all(vendor_dir());
    let _ = std::fs::write(trial_path(), &encoded);
    registry_write(&encoded);
}

// ---------------------------------------------------------------------------
// The status the rest of the app asks for
// ---------------------------------------------------------------------------

/// Work out where this install stands, and stamp today's date on the trial.
pub fn status() -> LicenseStatus {
    let machine = machine_fingerprint();
    let machine_id = format_machine_id(&machine);
    let today = today();

    if let Some(key) = read_license_key() {
        match validate(&key, &machine, today) {
            Ok(license) => {
                return LicenseStatus {
                    state: "licensed",
                    machine_id,
                    days_left: -1,
                    trial_days: TRIAL_DAYS,
                    customer: license.customer,
                    expires_in_days: (license.expiry_day != 0)
                        .then(|| license.expiry_day as i64 - today as i64),
                    note: None,
                };
            }
            // A key that no longer applies — moved disk, expired term — falls
            // through to the trial, which has almost certainly also run out.
            // Saying why beats a bare "expired".
            Err(error) => {
                let mut status = trial_status(&machine, &machine_id, today);
                status.note = Some(error.message().to_string());
                return status;
            }
        }
    }

    trial_status(&machine, &machine_id, today)
}

/// Roll a trial record forward to today, and say what it is now worth.
///
/// Pure, so the cases that matter — the last day, the day after, and a
/// wound-back clock — are tested without touching the registry.
fn advance(record: TrialRecord, today: u32) -> (TrialRecord, i64) {
    let mut record = record;
    // The one-click attack on a date-based trial is to wind the clock back.
    // A day of slack covers time zones and a battery-flat CMOS clock.
    if today + 1 < record.last_seen {
        record.tampered = true;
    }
    record.first_day = record.first_day.min(today);
    record.last_seen = record.last_seen.max(today);
    let used = today.saturating_sub(record.first_day);
    (record, TRIAL_DAYS as i64 - used as i64)
}

fn trial_status(machine: &[u8; 8], machine_id: &str, today: u32) -> LicenseStatus {
    let found = load_trial(machine).unwrap_or(TrialRecord {
        first_day: today,
        last_seen: today,
        tampered: false,
    });
    let (record, left) = advance(found, today);
    save_trial(&record, machine);

    if record.tampered {
        return LicenseStatus {
            state: "expired",
            machine_id: machine_id.to_string(),
            days_left: 0,
            trial_days: TRIAL_DAYS,
            customer: 0,
            expires_in_days: None,
            note: Some(
                "The clock on this computer was set back, so the trial has ended. \
                 Enter a licence key to continue."
                    .to_string(),
            ),
        };
    }

    LicenseStatus {
        state: if left > 0 { "trial" } else { "expired" },
        machine_id: machine_id.to_string(),
        days_left: left.max(0),
        trial_days: TRIAL_DAYS,
        customer: 0,
        expires_in_days: None,
        note: None,
    }
}

/// Check a key and, if it is good for this machine, keep it.
pub fn activate(key: &str) -> Result<LicenseStatus> {
    let machine = machine_fingerprint();
    match validate(key, &machine, today()) {
        Ok(_) => {
            std::fs::create_dir_all(vendor_dir()).map_err(|e| AppError::Io {
                path: vendor_dir().display().to_string(),
                source: e,
            })?;
            std::fs::write(license_path(), key.trim()).map_err(|e| AppError::Io {
                path: license_path().display().to_string(),
                source: e,
            })?;
            Ok(status())
        }
        Err(error) => Err(license_error(error)),
    }
}

fn license_error(error: KeyError) -> AppError {
    AppError::Other(error.message().to_string())
}

/// The gate on anything that produces output for a customer.
pub fn require_active() -> Result<()> {
    if status().can_produce() {
        return Ok(());
    }
    Err(AppError::Other(
        "The trial has ended. Enter a licence key in Settings to save or print."
            .to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine() -> [u8; 8] {
        [1, 2, 3, 4, 5, 6, 7, 8]
    }


    fn fresh(day: u32) -> TrialRecord {
        TrialRecord {
            first_day: day,
            last_seen: day,
            tampered: false,
        }
    }

    #[test]
    fn a_fresh_trial_has_every_day_left() {
        let (_, left) = advance(fresh(20_000), 20_000);
        assert_eq!(left, TRIAL_DAYS as i64);
    }

    #[test]
    fn the_last_day_still_works_and_the_next_one_does_not() {
        let (_, left) = advance(fresh(20_000), 20_000 + TRIAL_DAYS - 1);
        assert_eq!(left, 1, "the fourteenth day must still print");
        let (_, left) = advance(fresh(20_000), 20_000 + TRIAL_DAYS);
        assert!(left <= 0, "the day after the trial must not print");
    }

    #[test]
    fn a_wound_back_clock_ends_the_trial() {
        let seen = TrialRecord {
            first_day: 20_000,
            last_seen: 20_010,
            tampered: false,
        };
        // Back to day one, the classic trick.
        let (record, _) = advance(seen, 20_000);
        assert!(record.tampered);
    }

    #[test]
    fn a_days_slack_covers_a_time_zone_or_a_flat_cmos_battery() {
        let seen = TrialRecord {
            first_day: 20_000,
            last_seen: 20_010,
            tampered: false,
        };
        let (record, _) = advance(seen, 20_009);
        assert!(!record.tampered, "one day backwards is not an attack");
    }

    #[test]
    fn tamper_is_remembered_once_it_is_seen() {
        let caught = TrialRecord {
            first_day: 20_000,
            last_seen: 20_010,
            tampered: true,
        };
        let (record, _) = advance(caught, 20_011);
        assert!(record.tampered, "setting the clock back cannot be undone");
    }

    #[test]
    fn the_record_only_ever_moves_forward() {
        let (record, _) = advance(fresh(20_005), 20_000);
        assert_eq!(record.first_day, 20_000, "an earlier start is believed");
        assert_eq!(record.last_seen, 20_005, "a later sighting is kept");
    }

    #[test]
    fn a_trial_record_survives_the_round_trip() {
        let record = TrialRecord {
            first_day: 20_000,
            last_seen: 20_005,
            tampered: false,
        };
        let text = encode_trial(&record, &machine());
        let back = decode_trial(&text, &machine()).expect("valid record");
        assert_eq!(back.first_day, 20_000);
        assert_eq!(back.last_seen, 20_005);
        assert!(!back.tampered);
    }

    #[test]
    fn an_edited_record_is_refused() {
        let record = TrialRecord {
            first_day: 20_000,
            last_seen: 20_005,
            tampered: false,
        };
        let text = encode_trial(&record, &machine());
        // The obvious edit: make the trial look like it started today.
        let edited = text.replacen("20000", "20720", 1);
        assert!(decode_trial(&edited, &machine()).is_none());
    }

    #[test]
    fn a_record_copied_from_another_pc_is_refused() {
        let record = TrialRecord {
            first_day: 20_000,
            last_seen: 20_000,
            tampered: false,
        };
        let text = encode_trial(&record, &machine());
        assert!(decode_trial(&text, &[9, 9, 9, 9, 9, 9, 9, 9]).is_none());
    }

    #[test]
    fn nonsense_is_refused_without_panicking() {
        for text in ["", "|", "1|2|3", "1|a|b|c|d", "x"] {
            assert!(decode_trial(text, &machine()).is_none(), "accepted {text:?}");
        }
    }

    #[test]
    fn the_machine_identifiers_are_really_available() {
        // A silent fallback here would give every customer the same Machine
        // ID, and then one key would unlock every PC on earth.
        let guid = registry_machine_guid().expect("Windows MachineGuid should be readable");
        let volume = volume_serial().expect("the system drive should report a serial");
        assert!(guid.len() >= 32, "MachineGuid looks wrong: {guid:?}");
        assert_ne!(volume, 0);
        println!("guid={guid} volume={volume:08X} id={}", machine_id());
    }

    #[test]
    fn the_fingerprint_is_the_same_on_every_call() {
        assert_eq!(machine_fingerprint(), machine_fingerprint());
    }
}
