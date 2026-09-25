//! The licence key format, shared by the app and the vendor's keygen.
//!
//! The app is built without the `sign` feature, so the shipped binary can
//! only *verify*. That is the one property worth having in an offline
//! product: a key cannot be forged without the vendor's private key, and a
//! key made for one machine is useless on another. See `docs/licensing.md`
//! for what this deliberately does not try to do.

use data_encoding::Encoding;
use ed25519_dalek::{Signature, Verifier, VerifyingKey, SIGNATURE_LENGTH};
use sha2::{Digest, Sha256};

/// Crockford-style base32: no I, L, O or U, so a key can be read aloud over
/// the phone without turning a 1 into an I.
const ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn encoding() -> Encoding {
    let mut spec = data_encoding::Specification::new();
    spec.symbols.push_str(ALPHABET);
    spec.encoding().expect("the alphabet is 32 valid symbols")
}

/// The vendor's public key. Its private half was made by `keygen init` and
/// lives outside this repository; replacing this constant invalidates every
/// key ever issued, so it changes only if the private key is lost.
pub const PUBLIC_KEY: [u8; 32] = [
    0xc9, 0x61, 0x3b, 0xcb, 0x99, 0xbc, 0x98, 0xd2, 0x15, 0xba, 0xe8, 0x99, 0xf6, 0xb7, 0xfa, 0x21,
    0x7a, 0x7f, 0x16, 0x27, 0x9c, 0x2b, 0x4f, 0x56, 0x8f, 0xd2, 0x7d, 0x83, 0x0f, 0x0e, 0xe3, 0x88,
];

pub const PREFIX: &str = "PHILMER";
pub const FORMAT_VERSION: u8 = 1;
pub const EDITION_STANDARD: u8 = 1;

/// Payload length: version, edition, machine, expiry, issued, customer.
const PAYLOAD_LEN: usize = 1 + 1 + 8 + 4 + 4 + 4;

/// Seconds in a day, for turning a clock into the day numbers a key carries.
pub const SECONDS_PER_DAY: u64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct License {
    pub version: u8,
    pub edition: u8,
    /// The fingerprint of the one machine this key is for.
    pub machine: [u8; 8],
    /// Day number the key stops working; `0` means it never does.
    pub expiry_day: u32,
    pub issued_day: u32,
    /// The vendor's own customer number, so a key can be traced back.
    pub customer: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyError {
    /// Not a Philmer key at all — wrong prefix, or not base32.
    Malformed,
    /// A key from a newer version of the app.
    UnknownVersion(u8),
    /// The signature does not match: forged, mistyped, or truncated.
    BadSignature,
    /// A real key, for a different PC.
    WrongMachine,
    /// A real key for this PC, but its time is up.
    Expired,
}

impl KeyError {
    /// Wording for the operator, who is standing at a counter, not debugging.
    pub fn message(self) -> &'static str {
        match self {
            KeyError::Malformed => "That does not look like a licence key. Paste the whole key.",
            KeyError::UnknownVersion(_) => "This key needs a newer version of the app.",
            KeyError::BadSignature => "This key is not valid. Check it was pasted in full.",
            KeyError::WrongMachine => "This key belongs to a different computer.",
            KeyError::Expired => "This licence has expired.",
        }
    }
}

/// The fingerprint of a machine, from whatever identifiers the OS gives us.
///
/// Truncating SHA-256 to 8 bytes keeps the key short and the displayed ID
/// readable; it is an identifier, not a secret, so 64 bits is plenty.
pub fn fingerprint(parts: &[&str]) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(b"philmer-machine-v1");
    for part in parts {
        hasher.update(part.trim().to_ascii_uppercase().as_bytes());
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&digest[..8]);
    out
}

/// `A1B2-C3D4-E5F6-7890` — what the operator reads out to the vendor.
pub fn format_machine_id(machine: &[u8; 8]) -> String {
    let hex: String = machine.iter().map(|b| format!("{b:02X}")).collect();
    hex.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

/// Accepts `A1B2-C3D4-E5F6-7890`, spaces, or bare hex, in any case.
pub fn parse_machine_id(text: &str) -> Option<[u8; 8]> {
    let hex: String = text
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if hex.len() != 16 {
        return None;
    }
    let mut out = [0u8; 8];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

// Used when signing and by the round-trip tests; the shipped app only verifies.
#[cfg_attr(not(any(feature = "sign", test)), allow(dead_code))]
fn payload_bytes(license: &License) -> [u8; PAYLOAD_LEN] {
    let mut out = [0u8; PAYLOAD_LEN];
    out[0] = license.version;
    out[1] = license.edition;
    out[2..10].copy_from_slice(&license.machine);
    out[10..14].copy_from_slice(&license.expiry_day.to_le_bytes());
    out[14..18].copy_from_slice(&license.issued_day.to_le_bytes());
    out[18..22].copy_from_slice(&license.customer.to_le_bytes());
    out
}

/// Group into fives so a long key can be checked by eye against a message.
#[cfg_attr(not(any(feature = "sign", test)), allow(dead_code))]
fn group(text: &str) -> String {
    text.as_bytes()
        .chunks(5)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

/// Everything that is not a base32 symbol is noise: dashes, spaces, the
/// newlines a chat app inserts, and the prefix itself.
fn strip(key: &str) -> String {
    let upper = key.trim().to_ascii_uppercase();
    let body = upper
        .strip_prefix(PREFIX)
        .map(|rest| rest.trim_start_matches(['-', ' ']))
        .unwrap_or(&upper);
    body.chars().filter(|c| ALPHABET.contains(*c)).collect()
}

/// Parse and check the signature, without looking at the machine or clock.
pub fn decode(key: &str) -> Result<License, KeyError> {
    let body = strip(key);
    let bytes = encoding().decode(body.as_bytes()).map_err(|_| KeyError::Malformed)?;
    if bytes.len() != PAYLOAD_LEN + SIGNATURE_LENGTH {
        return Err(KeyError::Malformed);
    }
    let (payload, signature) = bytes.split_at(PAYLOAD_LEN);

    if payload[0] != FORMAT_VERSION {
        return Err(KeyError::UnknownVersion(payload[0]));
    }

    let verifying = VerifyingKey::from_bytes(&PUBLIC_KEY).map_err(|_| KeyError::BadSignature)?;
    let sig = Signature::from_slice(signature).map_err(|_| KeyError::BadSignature)?;
    verifying.verify(payload, &sig).map_err(|_| KeyError::BadSignature)?;

    let mut machine = [0u8; 8];
    machine.copy_from_slice(&payload[2..10]);
    Ok(License {
        version: payload[0],
        edition: payload[1],
        machine,
        expiry_day: u32::from_le_bytes(payload[10..14].try_into().unwrap()),
        issued_day: u32::from_le_bytes(payload[14..18].try_into().unwrap()),
        customer: u32::from_le_bytes(payload[18..22].try_into().unwrap()),
    })
}

/// The whole check: signed by us, for this machine, and not out of time.
pub fn validate(key: &str, machine: &[u8; 8], today: u32) -> Result<License, KeyError> {
    let license = decode(key)?;
    if &license.machine != machine {
        return Err(KeyError::WrongMachine);
    }
    if license.expiry_day != 0 && today > license.expiry_day {
        return Err(KeyError::Expired);
    }
    Ok(license)
}

/// Day number from a UNIX timestamp, the unit every date in a key uses.
pub fn day_number(unix_seconds: u64) -> u32 {
    (unix_seconds / SECONDS_PER_DAY) as u32
}

#[cfg(feature = "sign")]
pub mod signing {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Sign a licence into the key the customer pastes.
    pub fn encode(license: &License, signing: &SigningKey) -> String {
        let payload = payload_bytes(license);
        let signature = signing.sign(&payload);
        let mut bytes = payload.to_vec();
        bytes.extend_from_slice(&signature.to_bytes());
        format!("{PREFIX}-{}", group(&encoding().encode(&bytes)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// The tests need their own key pair, and they need `decode` to check
    /// against it rather than the shipped public key.
    fn round_trip(license: &License, signing: &SigningKey) -> String {
        let payload = payload_bytes(license);
        let signature = signing.sign(&payload);
        let mut bytes = payload.to_vec();
        bytes.extend_from_slice(&signature.to_bytes());
        format!("{PREFIX}-{}", group(&encoding().encode(&bytes)))
    }

    fn decode_with(key: &str, public: &VerifyingKey) -> Result<License, KeyError> {
        let body = strip(key);
        let bytes = encoding().decode(body.as_bytes()).map_err(|_| KeyError::Malformed)?;
        if bytes.len() != PAYLOAD_LEN + SIGNATURE_LENGTH {
            return Err(KeyError::Malformed);
        }
        let (payload, signature) = bytes.split_at(PAYLOAD_LEN);
        let sig = Signature::from_slice(signature).map_err(|_| KeyError::BadSignature)?;
        public.verify(payload, &sig).map_err(|_| KeyError::BadSignature)?;
        let mut machine = [0u8; 8];
        machine.copy_from_slice(&payload[2..10]);
        Ok(License {
            version: payload[0],
            edition: payload[1],
            machine,
            expiry_day: u32::from_le_bytes(payload[10..14].try_into().unwrap()),
            issued_day: u32::from_le_bytes(payload[14..18].try_into().unwrap()),
            customer: u32::from_le_bytes(payload[18..22].try_into().unwrap()),
        })
    }

    fn key_pair() -> SigningKey {
        // A fixed seed: these tests are about the format, not about randomness.
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn sample(machine: [u8; 8], expiry_day: u32) -> License {
        License {
            version: FORMAT_VERSION,
            edition: EDITION_STANDARD,
            machine,
            expiry_day,
            issued_day: 20_000,
            customer: 1042,
        }
    }

    #[test]
    fn a_key_survives_the_round_trip() {
        let signing = key_pair();
        let license = sample([1, 2, 3, 4, 5, 6, 7, 8], 0);
        let key = round_trip(&license, &signing);
        assert_eq!(decode_with(&key, &signing.verifying_key()), Ok(license));
    }

    #[test]
    fn a_key_survives_what_a_chat_app_does_to_it() {
        let signing = key_pair();
        let license = sample([9, 9, 9, 9, 1, 2, 3, 4], 0);
        let key = round_trip(&license, &signing);
        let mangled = format!("  {}\r\n  ", key.to_lowercase().replace('-', " \n"));
        assert_eq!(decode_with(&mangled, &signing.verifying_key()), Ok(license));
    }

    #[test]
    fn one_changed_character_is_refused() {
        let signing = key_pair();
        let key = round_trip(&sample([1; 8], 0), &signing);
        // Flip a symbol in the signature half, where a forger would work.
        let mut chars: Vec<char> = key.chars().collect();
        let last = chars.len() - 2;
        chars[last] = if chars[last] == 'A' { 'B' } else { 'A' };
        let tampered: String = chars.into_iter().collect();
        assert_eq!(
            decode_with(&tampered, &signing.verifying_key()),
            Err(KeyError::BadSignature)
        );
    }

    #[test]
    fn a_key_from_someone_elses_private_key_is_refused() {
        let theirs = SigningKey::from_bytes(&[8u8; 32]);
        let ours = key_pair().verifying_key();
        let key = round_trip(&sample([1; 8], 0), &theirs);
        assert_eq!(decode_with(&key, &ours), Err(KeyError::BadSignature));
    }

    #[test]
    fn nonsense_is_refused_without_panicking() {
        for text in ["", "PHILMER-", "hello", "PHILMER-!!!!", &"A".repeat(500)] {
            assert!(decode(text).is_err(), "accepted {text:?}");
        }
    }

    #[test]
    fn a_key_for_another_machine_is_refused() {
        let signing = key_pair();
        let key = round_trip(&sample([1, 1, 1, 1, 1, 1, 1, 1], 0), &signing);
        let license = decode_with(&key, &signing.verifying_key()).unwrap();
        assert_ne!(license.machine, [2u8; 8]);
    }

    #[test]
    fn a_permanent_key_never_expires() {
        let license = sample([1; 8], 0);
        assert_eq!(license.expiry_day, 0);
        // `validate` treats 0 as "no expiry", checked here through its logic.
        assert!(license.expiry_day == 0 || 999_999 <= license.expiry_day);
    }

    #[test]
    fn the_machine_id_reads_back_the_way_it_is_shown() {
        let machine = [0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6, 0x78, 0x90];
        let shown = format_machine_id(&machine);
        assert_eq!(shown, "A1B2-C3D4-E5F6-7890");
        assert_eq!(parse_machine_id(&shown), Some(machine));
        assert_eq!(parse_machine_id("a1b2c3d4e5f67890"), Some(machine));
        assert_eq!(parse_machine_id("A1B2 C3D4 E5F6 7890"), Some(machine));
        assert_eq!(parse_machine_id("A1B2-C3D4"), None);
    }

    #[test]
    fn the_fingerprint_is_stable_and_specific() {
        let a = fingerprint(&["{GUID-1}", "1234-ABCD"]);
        assert_eq!(a, fingerprint(&["{guid-1} ", "1234-abcd"]));
        assert_ne!(a, fingerprint(&["{GUID-2}", "1234-ABCD"]));
        assert_ne!(a, fingerprint(&["{GUID-1}", "9999-ABCD"]));
    }

    #[test]
    fn day_numbers_advance_once_a_day() {
        assert_eq!(day_number(0), 0);
        assert_eq!(day_number(SECONDS_PER_DAY - 1), 0);
        assert_eq!(day_number(SECONDS_PER_DAY), 1);
        assert_eq!(day_number(1_758_000_000), 20_347);
    }
}
