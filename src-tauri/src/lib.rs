//! Philmer ID Photo Studio — native side.
//!
//! All machine learning stays in Rust (BUILD_PLAN §2): native ONNX Runtime on
//! the CPU is several times faster than WASM in the webview, and it does not
//! run out of memory on a 12 MP photo. The frontend owns UI and compositing.

pub mod commands;
pub mod engine;
pub mod error;
pub mod face;
pub mod image_io;
pub mod models;
pub mod printing;
pub mod resize;
pub mod segment;
pub mod state;
pub mod store;

use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let state = AppState::from_app(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_image,
            commands::get_image_bytes,
            commands::segment,
            commands::detect_faces,
            commands::model_status,
            commands::import_model,
            commands::save_file,
            commands::list_printers,
            commands::printer_properties,
            commands::printer_has_custom_settings,
            commands::reset_printer_settings,
            commands::print_sheet,
            commands::release_image,
            commands::runtime_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Philmer ID Photo Studio");
}
