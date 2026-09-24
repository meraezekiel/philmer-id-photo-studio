//! Does DirectML actually beat the CPU here?
//!
//! BUILD_PLAN §10 lists DirectML as a v1.1 option. The M0 timing miss (13.99 s
//! against a 10 s budget, memory-bandwidth bound) makes it worth answering now.
//! This measures *and* checks correctness: an execution provider that silently
//! produces a different mask is worse than a slow one.
//!
//!   $env:PHOTO_STUDIO_ORT_DIR = "<dir with the DirectML onnxruntime.dll>"
//!   cargo test --manifest-path src-tauri/Cargo.toml --profile perf --test bench_dml -- --ignored --nocapture
//!
//! Both sessions run on the same runtime build, so the comparison isolates the
//! execution provider rather than the ONNX Runtime version.

use std::path::PathBuf;
use std::time::Instant;

use image::{GrayImage, RgbImage};
use ort::ep::DirectML;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use photo_studio_lib::{image_io, resize, segment};

/// One session at a time, and only a couple of runs each: benchmarking six
/// sessions in one process previously reached 11 GB and got the run killed.
const RUNS: usize = 3;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Where onnxruntime.dll lives. Override to point at the DirectML build.
fn runtime_dir() -> PathBuf {
    std::env::var("PHOTO_STUDIO_ORT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| crate_dir().join("resources"))
}

fn model_path() -> PathBuf {
    crate_dir()
        .join("resources")
        .join("BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx")
}

fn init_runtime() -> PathBuf {
    let dir = runtime_dir();
    let dll = dir.join("onnxruntime.dll");
    assert!(dll.is_file(), "{} does not exist", dll.display());

    // onnxruntime.dll from the DirectML package has a hard dependency on
    // DirectML.dll. Windows resolves a dynamically loaded DLL's imports
    // against the *process* search path, not the DLL's own directory, so the
    // runtime directory has to be on PATH before the load.
    if let Ok(path) = std::env::var("PATH") {
        std::env::set_var("PATH", format!("{};{path}", dir.display()));
    }

    ort::init_from(&dll)
        .unwrap_or_else(|e| panic!("could not load {}: {e}", dll.display()))
        .with_name("bench-dml")
        .commit();
    dir
}

fn fixture(megapixels: f64) -> RgbImage {
    let rgb = image_io::decode_path(&crate_dir().join("tests/fixtures/portrait.jpg"))
        .expect("could not decode the fixture")
        .rgb;
    let (w, h) = (rgb.width(), rgb.height());
    let factor = ((megapixels * 1e6) / (w as f64 * h as f64)).sqrt();
    resize::rgb_exact(
        &rgb,
        (w as f64 * factor).round() as u32,
        (h as f64 * factor).round() as u32,
    )
    .expect("could not scale the fixture")
}

fn cpu_session() -> Session {
    Session::builder()
        .unwrap()
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .unwrap()
        .with_intra_threads(num_cpus::get_physical().max(1))
        .unwrap()
        .commit_from_file(model_path())
        .expect("could not load the model on CPU")
}

/// DirectML requires sequential execution and no memory-pattern planning;
/// ONNX Runtime documents both as hard requirements for this EP.
///
/// `disable_fusion` matters here: the first attempt died inside
/// `DmlGraphFusionHelper` with 8007000E (out of device memory). Fusion builds
/// one large persistent resource per subgraph, so turning it off trades some
/// speed for a much smaller peak allocation.
fn dml_session(device_id: i32, disable_fusion: bool) -> Result<Session, String> {
    let mut builder = Session::builder()
        .map_err(|e| e.to_string())?
        .with_execution_providers([DirectML::default()
            .with_device_id(device_id)
            .build()
            .error_on_failure()])
        .map_err(|e| format!("DirectML could not be registered: {e}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .with_parallel_execution(false)
        .map_err(|e| e.to_string())?
        .with_memory_pattern(false)
        .map_err(|e| e.to_string())?;

    if disable_fusion {
        builder = builder
            .with_config_entry("ep.dml.disable_graph_fusion", "1")
            .map_err(|e| e.to_string())?;
    }

    builder
        .commit_from_file(model_path())
        .map_err(|e| format!("session failed to build: {e}"))
}

struct Measured {
    best: f64,
    median: f64,
    mask: GrayImage,
}

fn measure(session: &mut Session, rgb: &RgbImage, label: &str) -> Measured {
    let warm = Instant::now();
    let mut mask = segment::segment(session, rgb, &mut |_| {}).expect("segmentation failed");
    println!("  {label}: warm-up {:.2} s", warm.elapsed().as_secs_f64());

    let mut timings = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let started = Instant::now();
        mask = segment::segment(session, rgb, &mut |_| {}).expect("segmentation failed");
        timings.push(started.elapsed().as_secs_f64());
    }
    timings.sort_by(f64::total_cmp);
    println!(
        "  {label}: runs {}",
        timings
            .iter()
            .map(|t| format!("{t:.2}s"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    Measured {
        best: timings[0],
        median: timings[timings.len() / 2],
        mask,
    }
}

/// Mean absolute difference between two masks, in 0-255 units.
fn mask_delta(a: &GrayImage, b: &GrayImage) -> f64 {
    assert_eq!(a.dimensions(), b.dimensions());
    let sum: u64 = a
        .pixels()
        .zip(b.pixels())
        .map(|(p, q)| p.0[0].abs_diff(q.0[0]) as u64)
        .sum();
    sum as f64 / (a.width() as f64 * a.height() as f64)
}

#[test]
#[ignore = "benchmark"]
fn directml_versus_cpu() {
    let dir = init_runtime();
    println!("runtime: {}", dir.display());
    println!(
        "CPU: {} physical / {} logical cores\n",
        num_cpus::get_physical(),
        num_cpus::get()
    );

    let rgb = fixture(12.0);
    println!("fixture: {}x{} (12.0 MP)\n", rgb.width(), rgb.height());

    println!("CPU execution provider");
    let cpu = {
        let mut session = cpu_session();
        let m = measure(&mut session, &rgb, "cpu");
        // Free the session (and its arena) before the next one is built.
        drop(session);
        m
    };
    println!("  cpu: best {:.2} s, median {:.2} s\n", cpu.best, cpu.median);

    let out = crate_dir().join("tests/output");
    std::fs::create_dir_all(&out).ok();
    cpu.mask.save(out.join("mask-cpu.png")).ok();

    // This machine has two adapters (Iris Xe and an MX350 with 2 GB), so try
    // each, with and without graph fusion. Nothing here panics: "DirectML does
    // not work on this hardware" is a legitimate, reportable answer.
    //
    // A failed DirectML run can leave the adapter suspended (887A0005), which
    // then poisons every later config in the same process. PHOTO_STUDIO_DML_ONLY
    // ("<device>:<on|off>") runs a single config in a clean process so one
    // result can be trusted on its own.
    let only = std::env::var("PHOTO_STUDIO_DML_ONLY").ok();
    let configs: Vec<(i32, bool)> = match only.as_deref() {
        Some(spec) => {
            let (dev, fusion) = spec.split_once(':').expect("use <device>:<on|off>");
            vec![(dev.parse().expect("device id"), fusion == "off")]
        }
        None => vec![(0, false), (0, true), (1, false), (1, true)],
    };

    let mut results: Vec<(String, f64, f64)> = Vec::new();
    {
        for (device_id, disable_fusion) in configs {
            let label = format!(
                "device {device_id}, fusion {}",
                if disable_fusion { "off" } else { "on" }
            );
            println!("DirectML ({label})");
            match dml_session(device_id, disable_fusion) {
                Err(e) => println!("  unavailable: {e}\n"),
                Ok(mut session) => {
                    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        measure(&mut session, &rgb, "dml")
                    }));
                    drop(session);
                    match outcome {
                        Err(_) => println!("  run failed (see the ORT error above)\n"),
                        Ok(m) => {
                            let delta = mask_delta(&cpu.mask, &m.mask);
                            println!(
                                "  best {:.2} s, median {:.2} s, mask delta {delta:.3}/255\n",
                                m.best, m.median
                            );
                            m.mask
                                .save(out.join(format!("mask-dml-{device_id}-{disable_fusion}.png")))
                                .ok();
                            results.push((label, m.median, delta));
                        }
                    }
                }
            }
        }
    }

    println!("=== verdict ===");
    println!("  cpu median   : {:.2} s", cpu.median);
    if results.is_empty() {
        println!("  DirectML     : no working configuration on this machine");
    } else {
        for (label, median, delta) in &results {
            println!(
                "  {label:22}: {median:.2} s  ({:.2}x)  mask delta {delta:.3}/255  budget {}",
                cpu.median / median,
                if *median < 10.0 { "MET" } else { "missed" }
            );
        }
    }
}
