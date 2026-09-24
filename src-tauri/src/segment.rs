//! BiRefNet background removal.
//!
//! The quality fix this whole app exists for lives here: the *model* runs at
//! 1024x1024 because that is what it was trained on, but the *mask* is then
//! lifted back to the photo's full resolution. The photo itself is never
//! downscaled, so a 12 MP portrait exports as 12 MP.

use image::{GrayImage, RgbImage};
use ndarray::Array4;
use ort::session::Session;
use ort::value::TensorRef;

use crate::error::{AppError, Result};
use crate::resize;

/// BiRefNet's training resolution.
pub const INPUT_SIZE: u32 = 1024;

/// ImageNet statistics, matching rembg's preprocessing exactly.
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Coarse stages, reported to the UI as `segment://progress`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Preparing,
    Running,
    Upscaling,
}

impl Stage {
    pub fn label(self) -> &'static str {
        match self {
            Stage::Preparing => "Preparing the photo",
            Stage::Running => "Removing background",
            Stage::Upscaling => "Refining edges",
        }
    }

    /// Rough fractions so the progress bar moves monotonically. The model run
    /// dominates, hence the long middle segment.
    pub fn fraction(self) -> f32 {
        match self {
            Stage::Preparing => 0.10,
            Stage::Running => 0.80,
            Stage::Upscaling => 1.00,
        }
    }
}

/// Run BiRefNet and return an 8-bit alpha mask the same size as `rgb`.
pub fn segment(
    session: &mut Session,
    rgb: &RgbImage,
    on_stage: &mut dyn FnMut(Stage),
) -> Result<GrayImage> {
    segment_at(session, rgb, INPUT_SIZE, on_stage)
}

/// As [`segment`], but at an explicit model input size.
///
/// Note that the bundled BiRefNet exports have a **fixed** 1024x1024 input
/// shape: anything else is rejected by ORT with "Got invalid dimensions for
/// input". Lowering the resolution to buy speed is therefore not available
/// without re-exporting the model with dynamic axes. This entry point exists
/// so `tests/bench.rs` can measure that, and so a future model with dynamic
/// axes needs no change here.
pub fn segment_at(
    session: &mut Session,
    rgb: &RgbImage,
    input_size: u32,
    on_stage: &mut dyn FnMut(Stage),
) -> Result<GrayImage> {
    let (orig_w, orig_h) = rgb.dimensions();

    on_stage(Stage::Preparing);
    let small = resize::rgb_exact(rgb, input_size, input_size)?;
    let input = to_nchw(&small);

    on_stage(Stage::Running);
    let input_name = session
        .inputs()
        .first()
        .map(|i| i.name().to_owned())
        .ok_or_else(|| AppError::Inference("the segmentation model has no inputs".into()))?;
    let output_name = session
        .outputs()
        .first()
        .map(|o| o.name().to_owned())
        .ok_or_else(|| AppError::Inference("the segmentation model has no outputs".into()))?;

    let outputs = session.run(ort::inputs![
        input_name.as_str() => TensorRef::from_array_view(input.view())?
    ])?;

    // BiRefNet emits several supervision maps; output[0] is the final one.
    let logits = outputs[output_name.as_str()].try_extract_array::<f32>()?;
    let logits = logits
        .as_slice()
        .ok_or_else(|| AppError::Inference("mask tensor was not contiguous".into()))?;

    let expected = (input_size * input_size) as usize;
    if logits.len() < expected {
        return Err(AppError::Inference(format!(
            "expected at least {expected} mask values, got {}",
            logits.len()
        )));
    }

    // The ONNX export ends at the logits, so the sigmoid is ours to apply.
    let mask_small = GrayImage::from_raw(
        input_size,
        input_size,
        logits[..expected]
            .iter()
            .map(|&v| (sigmoid(v) * 255.0).round().clamp(0.0, 255.0) as u8)
            .collect(),
    )
    .ok_or_else(|| AppError::Inference("could not build the mask image".into()))?;

    on_stage(Stage::Upscaling);
    resize::gray_exact(&mask_small, orig_w, orig_h)
}

#[inline]
fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// `(px/255 - mean) / std` in NCHW order.
fn to_nchw(img: &RgbImage) -> Array4<f32> {
    let (w, h) = img.dimensions();
    let mut arr = Array4::<f32>::zeros((1, 3, h as usize, w as usize));
    for (x, y, px) in img.enumerate_pixels() {
        let (x, y) = (x as usize, y as usize);
        for c in 0..3 {
            arr[[0, c, y, x]] = (px.0[c] as f32 / 255.0 - MEAN[c]) / STD[c];
        }
    }
    arr
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sigmoid_is_centred_and_saturates() {
        assert!((sigmoid(0.0) - 0.5).abs() < 1e-6);
        assert!(sigmoid(20.0) > 0.999);
        assert!(sigmoid(-20.0) < 0.001);
    }

    #[test]
    fn normalisation_matches_rembg_for_the_extremes() {
        let mut img = RgbImage::new(2, 1);
        img.put_pixel(0, 0, image::Rgb([0, 0, 0]));
        img.put_pixel(1, 0, image::Rgb([255, 255, 255]));
        let arr = to_nchw(&img);

        assert_eq!(arr.shape(), &[1, 3, 1, 2]);
        for c in 0..3 {
            let black = (0.0 - MEAN[c]) / STD[c];
            let white = (1.0 - MEAN[c]) / STD[c];
            assert!((arr[[0, c, 0, 0]] - black).abs() < 1e-6);
            assert!((arr[[0, c, 0, 1]] - white).abs() < 1e-6);
        }
    }

    #[test]
    fn stage_fractions_increase() {
        let f: Vec<f32> = [Stage::Preparing, Stage::Running, Stage::Upscaling]
            .iter()
            .map(|s| s.fraction())
            .collect();
        assert!(f.windows(2).all(|w| w[0] < w[1]));
    }
}
