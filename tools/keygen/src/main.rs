//! Issues licence keys. This never ships — it holds the signing key.
//!
//!   keygen init                       once, ever: make the key pair
//!   keygen issue --machine <ID> --customer <N> [--name "Shop"] [--days 365]
//!   keygen check <key> --machine <ID> what the customer's app will decide
//!
//! See `docs/licensing.md` for the runbook around these three commands.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ed25519_dalek::SigningKey;
use license_core::{
    day_number, format_machine_id, parse_machine_id, signing::encode, License, EDITION_STANDARD,
    FORMAT_VERSION,
};

/// Kept out of the repository on purpose: this file *is* the product.
const KEY_FILE: &str = "philmer-signing-key.txt";
const LOG_FILE: &str = "licenses-issued.csv";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("init") => init(),
        Some("issue") => issue(&args[1..]),
        Some("check") => check(&args[1..]),
        _ => {
            eprintln!("{}", usage());
            std::process::exit(2);
        }
    };
    if let Err(message) = result {
        eprintln!("error: {message}");
        std::process::exit(1);
    }
}

fn usage() -> String {
    "usage:\n  \
     keygen init\n  \
     keygen issue --machine A1B2-C3D4-E5F6-7890 --customer 1042 [--name \"Shop\"] [--days 365]\n  \
     keygen check <key> --machine A1B2-C3D4-E5F6-7890"
        .to_string()
}

/// Where the signing key lives: beside the tool, one directory above the
/// repository, so a stray `git add -A` cannot pick it up.
fn key_path() -> PathBuf {
    std::env::var("PHILMER_SIGNING_KEY")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("..").join(KEY_FILE))
}

fn init() -> Result<(), String> {
    let path = key_path();
    if path.exists() {
        return Err(format!(
            "{} already exists. Issuing a new pair would invalidate every key already sold — \
             delete it by hand only if you mean that.",
            path.display()
        ));
    }

    let signing = SigningKey::generate(&mut rand::rngs::OsRng);
    let secret = hex(&signing.to_bytes());
    fs::write(&path, format!("{secret}\n")).map_err(|e| e.to_string())?;

    let public = signing.verifying_key().to_bytes();
    println!("Signing key written to {}", path.display());
    println!("Back it up offline. Losing it means reissuing every key ever sold.\n");
    println!("Put this in crates/license-core/src/lib.rs as PUBLIC_KEY:\n");
    println!("pub const PUBLIC_KEY: [u8; 32] = [");
    for row in public.chunks(16) {
        let line: Vec<String> = row.iter().map(|b| format!("0x{b:02x}")).collect();
        println!("    {},", line.join(", "));
    }
    println!("];");
    Ok(())
}

fn issue(args: &[String]) -> Result<(), String> {
    let machine_text = flag(args, "--machine").ok_or("--machine is required")?;
    let machine = parse_machine_id(&machine_text)
        .ok_or("that Machine ID is not 16 hex characters, e.g. A1B2-C3D4-E5F6-7890")?;
    let customer: u32 = flag(args, "--customer")
        .ok_or("--customer is required, so a key can be traced back")?
        .parse()
        .map_err(|_| "--customer must be a number")?;
    let name = flag(args, "--name").unwrap_or_default();
    let days: Option<u32> = match flag(args, "--days") {
        Some(text) => Some(text.parse().map_err(|_| "--days must be a number")?),
        None => None,
    };

    let today = day_number(now_seconds());
    let license = License {
        version: FORMAT_VERSION,
        edition: EDITION_STANDARD,
        machine,
        expiry_day: days.map(|d| today + d).unwrap_or(0),
        issued_day: today,
        customer,
    };

    let signing = load_signing_key()?;
    let key = encode(&license, &signing);

    append_log(&machine_text, customer, &name, days, &key)?;

    println!("Machine : {}", format_machine_id(&machine));
    println!("Customer: {customer}{}", if name.is_empty() { String::new() } else { format!(" ({name})") });
    println!(
        "Licence : {}",
        match days {
            Some(d) => format!("{d} days"),
            None => "permanent".to_string(),
        }
    );
    println!("\n{key}\n");
    println!("Send that to the customer. They paste it into Settings > Licence.");
    Ok(())
}

fn check(args: &[String]) -> Result<(), String> {
    let key = args.first().ok_or("pass the key to check")?;
    let machine_text = flag(args, "--machine").ok_or("--machine is required")?;
    let machine = parse_machine_id(&machine_text).ok_or("bad Machine ID")?;
    let today = day_number(now_seconds());

    match license_core::validate(key, &machine, today) {
        Ok(license) => {
            println!("valid — customer {}, issued day {}", license.customer, license.issued_day);
            println!(
                "expiry: {}",
                if license.expiry_day == 0 {
                    "never".to_string()
                } else {
                    format!("day {} ({} days left)", license.expiry_day, license.expiry_day as i64 - today as i64)
                }
            );
            Ok(())
        }
        // The app carries the shipped public key, so a key signed with a
        // freshly generated pair fails here until PUBLIC_KEY is updated —
        // which is exactly the check `init` asks you to do.
        Err(e) => Err(format!("{:?}: {}", e, e.message())),
    }
}

fn load_signing_key() -> Result<SigningKey, String> {
    let path = key_path();
    let text = fs::read_to_string(&path)
        .map_err(|_| format!("no signing key at {} — run `keygen init` first", path.display()))?;
    let bytes = unhex(text.trim()).ok_or("the signing key file is corrupt")?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| "the signing key is the wrong length")?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn append_log(
    machine: &str,
    customer: u32,
    name: &str,
    days: Option<u32>,
    key: &str,
) -> Result<(), String> {
    let path = Path::new("..").join(LOG_FILE);
    let new = !path.exists();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    if new {
        writeln!(file, "issued_utc,customer,name,machine,days,key").map_err(|e| e.to_string())?;
    }
    writeln!(
        file,
        "{},{},{},{},{},{}",
        now_seconds(),
        customer,
        name.replace(',', ";"),
        machine,
        days.map(|d| d.to_string()).unwrap_or_else(|| "permanent".into()),
        key
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 {
        return None;
    }
    (0..text.len() / 2)
        .map(|i| u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok())
        .collect()
}
