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

/// A book: several staged sheets, printed as one job in the queue.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiPrintJob {
    pub printer: Option<String>,
    /// Sheet images on disk, in order (`book_stage_sheet`).
    pub paths: Vec<String>,
    pub width_mm: f64,
    pub height_mm: f64,
    /// Whole-book copies, collated.
    #[serde(default = "one")]
    pub copies: u32,
    pub job_name: Option<String>,
}

fn one() -> u32 {
    1
}

#[cfg(windows)]
mod imp {
    use super::*;

    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::sync::OnceLock;

    use parking_lot::Mutex;

    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::HWND;
    // These sit across three modules in windows-rs: the drawing calls in Gdi,
    // the page/job calls in Printing, and DOCINFOW/StartDocW in Storage::Xps.
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, DEVMODEW, GetDeviceCaps, SetStretchBltMode, StretchDIBits, BITMAPINFO,
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

    /// Per-printer DEVMODE chosen in the driver's dialog.
    ///
    /// The driver does *not* persist what the operator picks here — the dialog
    /// hands back a DEVMODE and it is the caller's job to keep it and pass it
    /// to the print DC. Without this the quality setting is silently discarded
    /// and every job comes out at the driver's default.
    fn saved_devmodes() -> &'static Mutex<HashMap<String, Vec<u8>>> {
        static SAVED: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
        SAVED.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub fn has_custom_settings(printer: &str) -> bool {
        saved_devmodes().lock().contains_key(printer)
    }

    pub fn clear_settings(printer: &str) {
        saved_devmodes().lock().remove(printer);
    }

    /// The printer's own properties sheet, so paper size and quality are set
    /// where the operator already knows how to set them.
    ///
    /// `owner` is the app window, so the dialog is modal to it rather than
    /// appearing behind the app.
    pub fn show_properties(printer: &str, owner: isize) -> Result<bool> {
        let name = wide(printer);
        unsafe {
            let mut handle = PRINTER_HANDLE::default();
            OpenPrinterW(PCWSTR(name.as_ptr()), &mut handle as *mut _, None)
                .map_err(|e| AppError::Other(format!("could not open {printer}: {e}")))?;

            // Sizing pass: fMode 0 returns the bytes a DEVMODE needs for this
            // driver, which is more than DEVMODEW because of dmDriverExtra.
            let needed = DocumentPropertiesW(None, handle, PCWSTR(name.as_ptr()), None, None, 0);
            if needed <= 0 {
                let _ = ClosePrinter(handle);
                return Err(AppError::Other(format!(
                    "{printer} did not report its settings size"
                )));
            }

            let mut buffer = vec![0u8; needed as usize];
            let previous = saved_devmodes().lock().get(printer).cloned();

            // Seed the dialog with what was chosen last time, so it opens on
            // the operator's settings rather than resetting each visit.
            let mut mode = DM_IN_PROMPT.0 | DM_OUT_BUFFER.0;
            let input = previous.as_ref().map(|prev| {
                mode |= DM_IN_BUFFER.0;
                prev.as_ptr() as *const DEVMODEW
            });

            let hwnd = HWND(owner as *mut std::ffi::c_void);
            let result = DocumentPropertiesW(
                Some(hwnd),
                handle,
                PCWSTR(name.as_ptr()),
                Some(buffer.as_mut_ptr() as *mut DEVMODEW),
                input,
                mode,
            );
            let _ = ClosePrinter(handle);

            if result < 0 {
                return Err(AppError::Other(
                    "the printer's settings dialog could not be opened".into(),
                ));
            }
            // IDOK; IDCANCEL (2) means leave the previous settings alone.
            if result == 1 {
                saved_devmodes().lock().insert(printer.to_string(), buffer);
                log::info!("stored custom printer settings for {printer}");
                return Ok(true);
            }
            Ok(false)
        }
    }

    /// One print job of `count` pages, the `i`-th drawn from `page(i)`.
    fn print_pages(
        printer: Option<String>,
        job_name: &str,
        width_mm: f64,
        height_mm: f64,
        count: usize,
        page: &dyn Fn(usize) -> Result<image::RgbImage>,
    ) -> Result<()> {
        let printer = match printer.filter(|p| !p.is_empty()) {
            Some(p) => p,
            None => default_printer()
                .ok_or_else(|| AppError::Other("no printer is installed".into()))?,
        };
        let name = wide(&printer);
        let doc_name = wide(job_name);

        unsafe {
            // Use whatever was chosen in the driver's dialog. Without this the
            // DC is created from the driver's defaults and the operator's
            // quality and paper choices are silently dropped.
            let devmode = saved_devmodes().lock().get(&printer).cloned();
            let hdc = match devmode.as_ref() {
                Some(bytes) => {
                    log::info!("printing with the custom settings saved for {printer}");
                    CreateDCW(None, PCWSTR(name.as_ptr()), None, Some(bytes.as_ptr() as *const DEVMODEW))
                }
                None => CreateDCW(None, PCWSTR(name.as_ptr()), None, None),
            };
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
            let target_w = ((width_mm / 25.4) * dpi_x as f64).round() as i32;
            let target_h = ((height_mm / 25.4) * dpi_y as f64).round() as i32;

            log::info!(
                "printing {count} page(s) to {printer}: {target_w}x{target_h} dev px at {dpi_x}x{dpi_y} DPI, \
                 printable {printable_w}x{printable_h}, offset {off_x},{off_y}"
            );
            if target_w > printable_w + off_x || target_h > printable_h + off_y {
                log::warn!(
                    "the sheet ({target_w}x{target_h}) is larger than the printable area; \
                     check the paper size in the printer's settings"
                );
            }

            let doc = DOCINFOW {
                cbSize: size_of::<DOCINFOW>() as i32,
                lpszDocName: PCWSTR(doc_name.as_ptr()),
                ..Default::default()
            };
            if StartDocW(hdc, &doc) <= 0 {
                let _ = DeleteDC(hdc);
                return Err(AppError::Other("the print job was refused".into()));
            }

            let fail = |message: String| -> Result<()> {
                let _ = EndDoc(hdc);
                let _ = DeleteDC(hdc);
                Err(AppError::Other(message))
            };

            for i in 0..count {
                let sheet = i + 1;
                let image = match page(i) {
                    Ok(image) => image,
                    Err(e) => return fail(format!("printing stopped at sheet {sheet}: {e}")),
                };
                let (src_w, src_h) = image.dimensions();
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
                let info = BITMAPINFO { bmiHeader: header, ..Default::default() };

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
                drop(image);

                if StartPage(hdc) <= 0 {
                    return fail(format!("printing stopped at sheet {sheet}: the page could not be started"));
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
                    return fail(format!("printing stopped at sheet {sheet}: it could not be drawn"));
                }
                if EndPage(hdc) <= 0 {
                    return fail(format!("printing stopped at sheet {sheet}: the page could not be finished"));
                }
            }

            if EndDoc(hdc) <= 0 {
                let _ = DeleteDC(hdc);
                return Err(AppError::Other("the print job could not be closed".into()));
            }
            let _ = DeleteDC(hdc);
        }
        Ok(())
    }

    pub fn print(job: PrintJob) -> Result<()> {
        // Decode here rather than in the webview: the sheet is a 300 DPI
        // bitmap and pushing raw pixels over IPC would be pointless traffic.
        let image = image::load_from_memory(&job.png)
            .map_err(|e| AppError::Other(format!("could not decode the sheet: {e}")))?
            .to_rgb8();
        let copies = job.copies.clamp(1, 99) as usize;
        print_pages(
            job.printer,
            job.job_name.as_deref().unwrap_or("ID photo sheet"),
            job.width_mm,
            job.height_mm,
            copies,
            &|_| Ok(image.clone()),
        )?;
        log::info!("sent {copies} cop{}", if copies == 1 { "y" } else { "ies" });
        Ok(())
    }

    pub fn print_many(job: MultiPrintJob) -> Result<()> {
        let n = job.paths.len();
        if n == 0 {
            return Err(AppError::Other("there is nothing to print".into()));
        }
        let copies = job.copies.clamp(1, 99) as usize;
        let paths = job.paths;
        print_pages(
            job.printer,
            job.job_name.as_deref().unwrap_or("Photo book"),
            job.width_mm,
            job.height_mm,
            n * copies,
            &|i| {
                let path = &paths[i % n];
                let bytes = std::fs::read(path).map_err(|e| AppError::Io { path: path.clone(), source: e })?;
                Ok(image::load_from_memory(&bytes)
                    .map_err(|e| AppError::Other(format!("could not decode {path}: {e}")))?
                    .to_rgb8())
            },
        )?;
        log::info!("sent {n} sheet(s) x {copies}");
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn list() -> Result<Vec<PrinterInfo>> {
        Ok(Vec::new())
    }
    pub fn show_properties(_printer: &str, _owner: isize) -> Result<bool> {
        Err(AppError::Other("printing is only wired up on Windows".into()))
    }
    pub fn has_custom_settings(_printer: &str) -> bool {
        false
    }
    pub fn clear_settings(_printer: &str) {}
    pub fn print(_job: PrintJob) -> Result<()> {
        Err(AppError::Other("printing is only wired up on Windows".into()))
    }
    pub fn print_many(_job: MultiPrintJob) -> Result<()> {
        Err(AppError::Other("printing is only wired up on Windows".into()))
    }
}

pub use imp::{clear_settings, has_custom_settings, list, print, print_many, show_properties};
