//! YuNet 2023mar face detection.
//!
//! The ONNX export stops at the raw head outputs, so the anchor decode, the
//! score fusion and NMS all live here. Landmark order is YuNet's own:
//! right eye, left eye, nose tip, right mouth corner, left mouth corner —
//! "right" meaning the subject's right, i.e. image-left.

use image::RgbImage;
use ndarray::Array4;
use ort::session::Session;
use ort::value::TensorRef;
use serde::Serialize;

use crate::error::{AppError, Result};
use crate::resize;

/// YuNet's three feature-map strides.
const STRIDES: [u32; 3] = [8, 16, 32];
pub const INPUT_SIZE: u32 = 640;
pub const SCORE_THRESHOLD: f32 = 0.6;
pub const NMS_IOU: f32 = 0.3;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Landmarks {
    pub right_eye: Point,
    pub left_eye: Point,
    pub nose: Point,
    pub mouth_right: Point,
    pub mouth_left: Point,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    /// `[x, y, w, h]` in original-image pixels.
    pub r#box: [f32; 4],
    pub score: f32,
    pub landmarks: Landmarks,
}

impl Face {
    pub fn area(&self) -> f32 {
        self.r#box[2] * self.r#box[3]
    }
}

pub fn detect(session: &mut Session, rgb: &RgbImage) -> Result<Vec<Face>> {
    let (padded, scale) = resize::letterbox(rgb, INPUT_SIZE)?;
    let input = to_nchw_bgr(&padded);

    let input_name = session
        .inputs()
        .first()
        .map(|i| i.name().to_owned())
        .ok_or_else(|| AppError::Inference("the face model has no inputs".into()))?;

    let output_names: Vec<String> = session
        .outputs()
        .iter()
        .map(|o| o.name().to_owned())
        .collect();

    let outputs = session.run(ort::inputs![
        input_name.as_str() => TensorRef::from_array_view(input.view())?
    ])?;

    // Collect every head into owned Vec<f32> so the borrow of `outputs` ends
    // before decoding.
    let mut heads: Vec<(String, Vec<f32>)> = Vec::with_capacity(output_names.len());
    for name in &output_names {
        let arr = outputs[name.as_str()].try_extract_array::<f32>()?;
        heads.push((name.clone(), arr.iter().copied().collect()));
    }

    let mut faces = Vec::new();
    for stride in STRIDES {
        let cls = head(&heads, "cls", stride)?;
        let obj = head(&heads, "obj", stride)?;
        let bbox = head(&heads, "bbox", stride)?;
        let kps = head(&heads, "kps", stride)?;
        decode_stride(stride, cls, obj, bbox, kps, scale, &mut faces);
    }

    faces.sort_by(|a, b| b.score.total_cmp(&a.score));
    Ok(nms(faces, NMS_IOU))
}

/// Find one head by `<kind>_<stride>`. YuNet names them exactly that way; if a
/// re-export ever changes the names, this fails loudly rather than decoding
/// garbage.
fn head<'a>(heads: &'a [(String, Vec<f32>)], kind: &str, stride: u32) -> Result<&'a [f32]> {
    let want = format!("{kind}_{stride}");
    heads
        .iter()
        .find(|(name, _)| name == &want)
        .map(|(_, v)| v.as_slice())
        .ok_or_else(|| {
            AppError::Inference(format!(
                "the face model has no output named {want}; found: {}",
                heads
                    .iter()
                    .map(|(n, _)| n.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
}

#[allow(clippy::too_many_arguments)]
fn decode_stride(
    stride: u32,
    cls: &[f32],
    obj: &[f32],
    bbox: &[f32],
    kps: &[f32],
    scale: f32,
    out: &mut Vec<Face>,
) {
    let cols = (INPUT_SIZE / stride) as usize;
    let anchors = cols * cols;
    let s = stride as f32;
    let inv = 1.0 / scale;

    for idx in 0..anchors.min(cls.len()).min(obj.len()) {
        // A confident face needs both a high class score and a high objectness;
        // the geometric mean is what OpenCV's own YuNet wrapper uses.
        let score = (cls[idx].clamp(0.0, 1.0) * obj[idx].clamp(0.0, 1.0)).sqrt();
        if score < SCORE_THRESHOLD {
            continue;
        }
        if bbox.len() < idx * 4 + 4 || kps.len() < idx * 10 + 10 {
            continue;
        }

        let col = (idx % cols) as f32;
        let row = (idx / cols) as f32;
        let b = &bbox[idx * 4..idx * 4 + 4];

        let cx = (col + b[0]) * s;
        let cy = (row + b[1]) * s;
        let w = b[2].exp() * s;
        let h = b[3].exp() * s;

        // Undo the letterbox scale. Padding was bottom-right only, so there is
        // no offset to subtract.
        let k = &kps[idx * 10..idx * 10 + 10];
        let pt = |i: usize| Point {
            x: (k[i * 2] + col) * s * inv,
            y: (k[i * 2 + 1] + row) * s * inv,
        };

        out.push(Face {
            r#box: [
                (cx - w / 2.0) * inv,
                (cy - h / 2.0) * inv,
                w * inv,
                h * inv,
            ],
            score,
            landmarks: Landmarks {
                right_eye: pt(0),
                left_eye: pt(1),
                nose: pt(2),
                mouth_right: pt(3),
                mouth_left: pt(4),
            },
        });
    }
}

/// Greedy NMS. `faces` must already be sorted by descending score.
fn nms(faces: Vec<Face>, iou_threshold: f32) -> Vec<Face> {
    let mut kept: Vec<Face> = Vec::new();
    for face in faces {
        if kept.iter().all(|k| iou(&k.r#box, &face.r#box) <= iou_threshold) {
            kept.push(face);
        }
    }
    kept
}

fn iou(a: &[f32; 4], b: &[f32; 4]) -> f32 {
    let (ax2, ay2) = (a[0] + a[2], a[1] + a[3]);
    let (bx2, by2) = (b[0] + b[2], b[1] + b[3]);
    let iw = (ax2.min(bx2) - a[0].max(b[0])).max(0.0);
    let ih = (ay2.min(by2) - a[1].max(b[1])).max(0.0);
    let inter = iw * ih;
    let union = a[2] * a[3] + b[2] * b[3] - inter;
    if union <= 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// YuNet wants BGR in 0..255 with no normalisation.
fn to_nchw_bgr(img: &RgbImage) -> Array4<f32> {
    let (w, h) = img.dimensions();
    let mut arr = Array4::<f32>::zeros((1, 3, h as usize, w as usize));
    for (x, y, px) in img.enumerate_pixels() {
        let (x, y) = (x as usize, y as usize);
        arr[[0, 0, y, x]] = px.0[2] as f32; // B
        arr[[0, 1, y, x]] = px.0[1] as f32; // G
        arr[[0, 2, y, x]] = px.0[0] as f32; // R
    }
    arr
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face_at(x: f32, y: f32, w: f32, h: f32, score: f32) -> Face {
        let p = Point { x: 0.0, y: 0.0 };
        Face {
            r#box: [x, y, w, h],
            score,
            landmarks: Landmarks {
                right_eye: p,
                left_eye: p,
                nose: p,
                mouth_right: p,
                mouth_left: p,
            },
        }
    }

    #[test]
    fn iou_of_identical_boxes_is_one() {
        let b = [10.0, 10.0, 20.0, 20.0];
        assert!((iou(&b, &b) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn iou_of_disjoint_boxes_is_zero() {
        assert_eq!(iou(&[0.0, 0.0, 10.0, 10.0], &[50.0, 50.0, 10.0, 10.0]), 0.0);
    }

    #[test]
    fn iou_of_half_overlap() {
        // Two 10x10 boxes sharing a 5x10 strip: 50 / (100 + 100 - 50).
        let v = iou(&[0.0, 0.0, 10.0, 10.0], &[5.0, 0.0, 10.0, 10.0]);
        assert!((v - 50.0 / 150.0).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn nms_drops_the_duplicate_and_keeps_the_distinct_face() {
        let faces = vec![
            face_at(10.0, 10.0, 40.0, 40.0, 0.99),
            face_at(12.0, 11.0, 40.0, 40.0, 0.95), // same face, lower score
            face_at(300.0, 20.0, 40.0, 40.0, 0.90), // a genuinely different one
        ];
        let kept = nms(faces, NMS_IOU);
        assert_eq!(kept.len(), 2);
        assert!((kept[0].score - 0.99).abs() < 1e-6);
        assert!((kept[1].r#box[0] - 300.0).abs() < 1e-6);
    }

    #[test]
    fn bgr_channel_order_is_swapped() {
        let mut img = RgbImage::new(1, 1);
        img.put_pixel(0, 0, image::Rgb([10, 20, 30]));
        let arr = to_nchw_bgr(&img);
        assert_eq!(arr[[0, 0, 0, 0]], 30.0);
        assert_eq!(arr[[0, 1, 0, 0]], 20.0);
        assert_eq!(arr[[0, 2, 0, 0]], 10.0);
    }

    #[test]
    fn decode_maps_an_anchor_back_through_the_letterbox() {
        // One anchor at stride 32, column 1 row 0, on a half-scaled image.
        let cols = (INPUT_SIZE / 32) as usize;
        let anchors = cols * cols;
        let mut cls = vec![0.0; anchors];
        let mut obj = vec![0.0; anchors];
        let mut bbox = vec![0.0; anchors * 4];
        let kps = vec![0.0; anchors * 10];

        let idx = 1;
        cls[idx] = 1.0;
        obj[idx] = 1.0;
        // b = [0, 0, ln(2), ln(2)] -> centre on the anchor, 64 px box.
        bbox[idx * 4 + 2] = 2f32.ln();
        bbox[idx * 4 + 3] = 2f32.ln();

        let mut out = Vec::new();
        decode_stride(32, &cls, &obj, &bbox, &kps, 0.5, &mut out);

        assert_eq!(out.len(), 1);
        let f = out[0];
        // centre = (col + 0) * 32 = 32, box 64x64, then /0.5 back to original px.
        assert!((f.r#box[2] - 128.0).abs() < 1e-4, "w was {}", f.r#box[2]);
        assert!((f.r#box[0] - 0.0).abs() < 1e-4, "x was {}", f.r#box[0]);
        assert!((f.score - 1.0).abs() < 1e-6);
    }

    #[test]
    fn low_scores_are_filtered() {
        let cols = (INPUT_SIZE / 32) as usize;
        let anchors = cols * cols;
        let mut cls = vec![0.0; anchors];
        let mut obj = vec![0.0; anchors];
        cls[0] = 0.5;
        obj[0] = 0.5; // sqrt(0.25) = 0.5, below the 0.6 threshold
        let bbox = vec![0.0; anchors * 4];
        let kps = vec![0.0; anchors * 10];
        let mut out = Vec::new();
        decode_stride(32, &cls, &obj, &bbox, &kps, 1.0, &mut out);
        assert!(out.is_empty());
    }
}
