//! Printing straight to the printer, bypassing any PDF viewer.
//!
//! Handing the sheet to the system PDF handler meant a browser decided how big
//! the photos came out, and "Fit to page" silently ruins a sheet. Here the app
//! owns the scaling: the sheet is drawn onto the printer's device context at a
//! size computed from the device's own DPI, anchored to the physical page
//! corner. A 2x2 is 50.8 mm because we placed it at 50.8 mm, not because a
//! viewer was asked nicely.
//!
//! Windows-only. The rest of the app builds on other platforms; this module is
//! compiled out there and the frontend falls back to opening the PDF.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    /// Empty means the system default printer.
    pub printer: Option<String>,
    /// The finished sheet, PNG, at print resolution.
    pub png: Vec<u8>,
    pub width_mm: f64,
    pub height_mm: f64,
    #[serde(default = "one")]
    pub copies: u32,
    /// A job name, shown in the Windows print queue.
    pub job_name: Option<String>,
}

fn one() -> u32 {
    1
}

#[cfg(windows)]
mod imp {
    use super::*;

    use std::ffi::c_void;
    use std::mem::size_of;

    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::HWND;
    // These sit across three modules in windows-rs: the drawing calls in Gdi,
    // the page/job calls in Printing, and DOCINFOW/StartDocW in Storage::Xps.
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, GetDeviceCaps, SetStretchBltMode, StretchDIBits, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, DM_IN_BUFFER, DM_IN_PROMPT, DM_OUT_BUFFER,
        HALFTONE, HORZRES, LOGPIXELSX, LOGPIXELSY, PHYSICALOFFSETX, PHYSICALOFFSETY, SRCCOPY,
        VERTRES,
    };
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, DocumentPropertiesW, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW,
        PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_4W,
    };
    use windows::Win32::Storage::Xps::{EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn from_wide(ptr: *const u16) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let mut len = 0usize;
        // SAFETY: Windows gives null-terminated strings here.
        unsafe {
            while *ptr.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
        }
    }

    pub fn default_printer() -> Option<String> {
        let mut len: u32 = 0;
        unsafe {
            // First call reports the buffer size it wants.
            let _ = GetDefaultPrinterW(None, &mut len);
            if len == 0 {
                return None;
            }
            let mut buf = vec![0u16; len as usize];
            if !GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut len).as_bool() {
                return None;
            }
            let name = from_wide(buf.as_ptr());
            if name.is_empty() { None } else { Some(name) }
        }
    }

    pub fn list() -> Result<Vec<PrinterInfo>> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed: u32 = 0;
        let mut returned: u32 = 0;

        unsafe {
            // Sizing pass; failure with a zero requirement means no printers.
            let _ = EnumPrintersW(flags, None, 4, None, &mut needed, &mut returned);
            if needed == 0 {
                return Ok(Vec::new());
            }
            let mut buffer = vec![0u8; needed as usize];
            EnumPrintersW(
                flags,
                None,
                4,
                Some(&mut buffer),
                &mut needed,
                &mut returned,
            )
            .map_err(|e| AppError::Other(format!("could not list printers: {e}")))?;

            let default = default_printer().unwrap_or_default();
            let entries =
                std::slice::from_raw_parts(buffer.as_ptr() as *const PRINTER_INFO_4W, returned as usize);
            Ok(entries
                .iter()
                .map(|p| {
                    let name = from_wide(p.pPrinterName.0);
                    PrinterInfo {
                        is_default: name == default,
                        name,
                    }
                })
                .filter(|p| !p.name.is_empty())
                .collect())
        }
    }

    /// The printer's own properties sheet, so paper size and quality are set
    /// where the operator already knows how to set them.
    pub fn show_properties(printer: &str) -> Result<()> {
        let name = wide(printer);
        unsafe {
            let mut handle = PRINTER_HANDLE::default();
            OpenPrinterW(PCWSTR(name.as_ptr()), &mut handle as *mut _, None)
                .map_err(|e| AppError::Other(format!("could not open {printer}: {e}")))?;

            // DM_IN_PROMPT shows the driver's dialog; the driver persists the
            // result against the printer, so the next print picks it up.
            let result = DocumentPropertiesW(
                Some(HWND::default()),
                handle,
                PCWSTR(name.as_ptr()),
                None,
                None,
                (DM_IN_PROMPT.0 | DM_IN_BUFFER.0 | DM_OUT_BUFFER.0) as u32,
            );
            let _ = ClosePrinter(handle);

            if result < 0 {
                return Err(AppError::Other(
                    "the printer's settings dialog could not be opened".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn print(job: PrintJob) -> Result<()> {
        let printer = match job.printer.clone().filter(|p| !p.is_empty()) {
            Some(p) => p,
            None => default_printer()
                .ok_or_else(|| AppError::Other("no printer is installed".into()))?,
        };

        // Decode here rather than in the webview: the sheet is a 300 DPI
        // bitmap and pushing raw pixels over IPC would be pointless traffic.
        let image = image::load_from_memory(&job.png)
            .map_err(|e| AppError::Other(format!("could not decode the sheet: {e}")))?
            .to_rgb8();
        let (src_w, src_h) = image.dimensions();

        let name = wide(&printer);
        let doc_name = wide(job.job_name.as_deref().unwrap_or("ID photo sheet"));

        unsafe {
            let hdc = CreateDCW(None, PCWSTR(name.as_ptr()), None, None);
            if hdc.is_invalid() {
                return Err(AppError::Other(format!("could not open {printer}")));
            }

            let dpi_x = GetDeviceCaps(Some(hdc), LOGPIXELSX);
            let dpi_y = GetDeviceCaps(Some(hdc), LOGPIXELSY);
            // The driver cannot print to the very edge; the origin of the
            // printable area sits this far inside the physical sheet.
            let off_x = GetDeviceCaps(Some(hdc), PHYSICALOFFSETX);
            let off_y = GetDeviceCaps(Some(hdc), PHYSICALOFFSETY);
            let printable_w = GetDeviceCaps(Some(hdc), HORZRES);
            let printable_h = GetDeviceCaps(Some(hdc), VERTRES);

            // True size: millimetres straight into device pixels.
            let target_w = ((job.width_mm / 25.4) * dpi_x as f64).round() as i32;
            let target_h = ((job.height_mm / 25.4) * dpi_y as f64).round() as i32;

            log::info!(
                "printing to {printer}: {}x{} dev px at {dpi_x}x{dpi_y} DPI, \
                 printable {printable_w}x{printable_h}, offset {off_x},{off_y}",
                target_w,
                target_h
            );

            if target_w > printable_w + off_x || target_h > printable_h + off_y {
                log::warn!(
                    "the sheet ({target_w}x{target_h}) is larger than the printable area; \
                     check the paper size in the printer's settings"
                );
            }

            let header = BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: src_w as i32,
                // Negative height: our rows run top-down, Windows assumes up.
                biHeight: -(src_h as i32),
                biPlanes: 1,
                biBitCount: 24,
                biCompression: BI_RGB.0,
                ..Default::default()
            };
            let info = BITMAPINFO {
                bmiHeader: header,
                ..Default::default()
            };

            // A 24bpp DIB is BGR with every row padded to four bytes.
            let stride = ((src_w * 3 + 3) / 4 * 4) as usize;
            let mut dib = vec![0u8; stride * src_h as usize];
            for y in 0..src_h as usize {
                let row = &mut dib[y * stride..y * stride + src_w as usize * 3];
                for x in 0..src_w as usize {
                    let px = image.get_pixel(x as u32, y as u32);
                    row[x * 3] = px.0[2];
                    row[x * 3 + 1] = px.0[1];
                    row[x * 3 + 2] = px.0[0];
                }
            }

            let doc = DOCINFOW {
                cbSize: size_of::<DOCINFOW>() as i32,
                lpszDocName: PCWSTR(doc_name.as_ptr()),
                ..Default::default()
            };

            let copies = job.copies.clamp(1, 99);
            if StartDocW(hdc, &doc) <= 0 {
                let _ = DeleteDC(hdc);
                return Err(AppError::Other("the print job was refused".into()));
            }

            for _ in 0..copies {
                if StartPage(hdc) <= 0 {
                    let _ = EndDoc(hdc);
                    let _ = DeleteDC(hdc);
                    return Err(AppError::Other("a page could not be started".into()));
                }
                // Halftone keeps the downscale of a 300 DPI sheet clean.
                SetStretchBltMode(hdc, HALFTONE);
                let written = StretchDIBits(
                    hdc,
                    // Shift by the unprintable margin so our sheet's origin is
                    // the physical corner of the paper, not the printable one.
                    -off_x,
                    -off_y,
                    target_w,
                    target_h,
                    0,
                    0,
                    src_w as i32,
                    src_h as i32,
                    Some(dib.as_ptr() as *const c_void),
                    &info,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
                if written == 0 {
                    let _ = EndPage(hdc);
                    let _ = EndDoc(hdc);
                    let _ = DeleteDC(hdc);
                    return Err(AppError::Other("the sheet could not be drawn".into()));
                }
                if EndPage(hdc) <= 0 {
                    let _ = EndDoc(hdc);
                    let _ = DeleteDC(hdc);
                    return Err(AppError::Other("a page could not be finished".into()));
                }
            }

            if EndDoc(hdc) <= 0 {
                let _ = DeleteDC(hdc);
                return Err(AppError::Other("the print job could not be closed".into()));
            }
            let _ = DeleteDC(hdc);
        }

        log::info!("sent {} cop{} to {printer}", job.copies, if job.copies == 1 { "y" } else { "ies" });
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn list() -> Result<Vec<PrinterInfo>> {
        Ok(Vec::new())
    }
    pub fn show_properties(_printer: &str) -> Result<()> {
        Err(AppError::Other("printing is only wired up on Windows".into()))
    }
    pub fn print(_job: PrintJob) -> Result<()> {
        Err(AppError::Other("printing is only wired up on Windows".into()))
    }
}

pub use imp::{list, print, show_properties};
