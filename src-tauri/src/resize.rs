//! Thin wrappers over `fast_image_resize`. The SIMD paths matter here: a 12 MP
//! downscale plus a 12 MP mask upscale happen on every import, and `image`'s
//! own resampler is several times slower.
//!
//! `RgbImage` and `GrayImage` implement fir's view traits directly (its `image`
//! feature), so nothing is copied on the way in or out.

use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
use image::{GrayImage, RgbImage};

use crate::error::{AppError, Result};

fn bilinear() -> ResizeOptions {
    ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Bilinear))
}

fn fir_err(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("resize failed: {e}"))
}

/// Exact resize, no letterbox — this is what rembg feeds BiRefNet, and the
/// model was trained on the same squashed aspect.
pub fn rgb_exact(src: &RgbImage, w: u32, h: u32) -> Result<RgbImage> {
    if src.dimensions() == (w, h) {
        return Ok(src.clone());
    }
    let mut dst = RgbImage::new(w, h);
    Resizer::new()
        .resize(src, &mut dst, &bilinear())
        .map_err(fir_err)?;
    Ok(dst)
}

/// Single-channel resize, used to lift the 1024x1024 mask back to the photo's
/// real size. Bilinear rather than bicubic on purpose: a bicubic kernel
/// overshoots at hair edges and that overshoot reads as a halo.
pub fn gray_exact(src: &GrayImage, w: u32, h: u32) -> Result<GrayImage> {
    if src.dimensions() == (w, h) {
        return Ok(src.clone());
    }
    let mut dst = GrayImage::new(w, h);
    Resizer::new()
        .resize(src, &mut dst, &bilinear())
        .map_err(fir_err)?;
    Ok(dst)
}

/// Scale to fit inside `size`x`size` and pad bottom-right, the convention YuNet
/// was exported with. Returns the padded image and the scale used, so
/// detections can be mapped back to original pixels.
pub fn letterbox(src: &RgbImage, size: u32) -> Result<(RgbImage, f32)> {
    let (sw, sh) = src.dimensions();
    let scale = (size as f32 / sw as f32).min(size as f32 / sh as f32);
    let nw = ((sw as f32 * scale).round() as u32).clamp(1, size);
    let nh = ((sh as f32 * scale).round() as u32).clamp(1, size);

    let scaled = rgb_exact(src, nw, nh)?;
    let mut out = RgbImage::new(size, size);
    image::imageops::replace(&mut out, &scaled, 0, 0);
    Ok((out, scale))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb_resize_hits_the_requested_size() {
        let src = RgbImage::new(4000, 3000);
        let out = rgb_exact(&src, 1024, 1024).unwrap();
        assert_eq!(out.dimensions(), (1024, 1024));
    }

    #[test]
    fn mask_upscale_hits_the_original_size() {
        let src = GrayImage::new(1024, 1024);
        let out = gray_exact(&src, 4000, 3000).unwrap();
        assert_eq!(out.dimensions(), (4000, 3000));
    }

    #[test]
    fn a_same_size_resize_is_a_passthrough() {
        let mut src = RgbImage::new(4, 4);
        src.put_pixel(1, 1, image::Rgb([9, 8, 7]));
        let out = rgb_exact(&src, 4, 4).unwrap();
        assert_eq!(out.get_pixel(1, 1).0, [9, 8, 7]);
    }

    #[test]
    fn letterbox_preserves_aspect_and_reports_scale() {
        let src = RgbImage::new(1200, 600);
        let (out, scale) = letterbox(&src, 640).unwrap();
        assert_eq!(out.dimensions(), (640, 640));
        // 640/1200 is the binding constraint.
        assert!((scale - 640.0 / 1200.0).abs() < 1e-6, "scale was {scale}");
    }
}
