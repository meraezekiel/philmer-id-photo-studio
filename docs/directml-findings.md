# DirectML evaluation (2026-09-24)

BUILD_PLAN §10 lists DirectML as a v1.1 option. M0 missed its timing criterion
(§9: 12 MP Lite segmentation under ~10 s), so we evaluated it early.

**Verdict: do not ship DirectML as the default. Keep the CPU runtime.**
There is one unresolved measurement that could change this — see *Open question*.

Reproduce with `src-tauri/tests/bench_dml.rs`.

## Test machine

| | |
|---|---|
| CPU | Intel i5-1135G7, 4 physical / 8 logical cores (Tiger Lake) |
| RAM | 19.8 GB |
| GPU 0 | Intel Iris Xe (shared memory), driver **27.20.100.8439, dated 2020-08-13** |
| GPU 1 | NVIDIA GeForce MX350, **2 GB** dedicated VRAM, driver 31.0.15.1640 (2022) |
| Power | Balanced |

This is the plan's target class of machine ("typical 4-core laptop CPU"), so
the CPU numbers are representative rather than pessimistic.

## Why DirectML means downgrading ONNX Runtime

Microsoft's **DirectML build of ONNX Runtime stops at 1.24.4**. The 1.28.2
release ships CPU and CUDA only, and `Microsoft.ML.OnnxRuntime.DirectML` on
NuGet has no 1.25+ version. `ort 2.0.0-rc.13` targets 1.28, so using DirectML
means pinning the runtime back to 1.24.4 and requesting `api-24` rather than
the default `api-27`.

`api-24` is harmless on its own — a newer runtime still serves an older API, so
one binary can load either build — and that is the state the crate is left in.
Bundling the 1.24.4 *runtime* is the part we are not doing.

DirectML 1.24.4 additionally requires `Microsoft.AI.DirectML` 1.15.4, i.e.
shipping `DirectML.dll` (18.5 MB) next to `onnxruntime.dll` (17.3 MB).

## Licensing

`DirectML.dll` is **not** MIT, unlike every other model and runtime we bundle.
`LICENSE-CODE.txt` in the package is MIT, but the binary is governed by
`LICENSE.txt`, "Microsoft Software License Terms — DirectX Machine Learning".
Section 1(a) permits redistribution:

> you may copy and distribute the software (i.e. make available for third
> parties) in applications and services you develop […] that run on Windows
> and Xbox.

So commercial shipping is allowed, but it is a Microsoft EULA rather than a
permissive OSS licence, and §2(a) allows telemetry. Worth a deliberate decision
rather than an assumption.

## Results, 12 MP, ONNX Runtime 1.24.4 DirectML build

CPU baseline, same binary and same runtime: **median 12.41 s** (best 12.12 s).

| Adapter | Graph fusion | Outcome |
|---|---|---|
| 0 — Iris Xe | on | `887A0005` the GPU device instance has been **suspended** |
| 0 — Iris Xe | off | `8007000E` out of memory at `/decoder/Concat_29` |
| 1 — MX350 | on | `8007000E` out of memory in `DmlGraphFusionHelper` |
| 1 — MX350 | off | one run completed in **3.62 s**, then `887A0006` GPU hang |

No configuration completed a repeated run. Two of the four failures are
*device-removed* errors, which is worse than being slow: the app would hang or
crash rather than degrade.

### Reading the 3.62 s

The MX350 with fusion disabled did produce a full 12 MP mask in 3.62 s —
**3.4x faster than the CPU** — before the adapter stopped responding. That
number is the reason this is "not now" rather than "never":

- BiRefNet swin-tiny at a fixed 1024x1024 does not fit reliably in 2 GB of
  VRAM. Both out-of-memory failures are consistent with that.
- The Iris Xe driver is from **August 2020**, six years old. DirectML leans
  heavily on driver quality, and a suspended device is a driver-level fault.

## Open question

All four configurations above ran **in one process**, in order. The first
failure left the adapter suspended, so the later results may be contaminated
rather than independent. A clean-process run of adapter 1 with fusion disabled
would settle whether 3.62 s is sustainable or a one-off before the crash.

That run was attempted and was killed by the host's low-memory reaper before it
reached the DirectML section. **It has not been repeated.** Use:

```powershell
$env:PHOTO_STUDIO_ORT_DIR = "<dir with the DirectML onnxruntime.dll>"
$env:PHOTO_STUDIO_DML_ONLY = "1:off"
cargo test --manifest-path src-tauri/Cargo.toml --profile perf --test bench_dml -- --ignored --nocapture
```

## What to do instead

1. **Update the Intel graphics driver** (2020 -> current). Free, and the single
   highest-value experiment: if the Iris Xe then completes runs, the 3.4x is
   back on the table on hardware with no 2 GB ceiling.
2. Until then, ship the **CPU path on ONNX Runtime 1.28.2** and design for a
   ~12-15 s wait rather than the 3-10 s DESIGN_BRIEF §3.1 assumes.
3. If DirectML is revisited, it must be **opt-in with automatic CPU fallback**,
   because the failure mode is a device hang, not a slowdown.

## Thermal note, which affects any CPU target

The CPU timings drift upward under sustained load on this laptop:

| Run | Cold warm-up | 1 | 2 | 3 |
|---|---|---|---|---|
| A | 11.88 s | 14.62 | 14.85 | 17.34 |
| B | 10.68 s | 12.12 | 12.41 | 13.37 |

A cold first run is ~11 s; back-to-back runs settle 15-40% slower. A shop
serving customers in a row sees the *sustained* number, so any acceptance
criterion should be measured warm, not cold.
