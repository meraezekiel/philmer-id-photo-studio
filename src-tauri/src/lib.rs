//! Philmer ID Photo Studio — native side.
//!
//! All machine learning stays in Rust (BUILD_PLAN §2): native ONNX Runtime on
//! the CPU is several times faster than WASM in the webview, and it does not
//! run out of memory on a 12 MP photo. The frontend owns UI and compositing.

pub mod attire;
pub mod book;
pub mod book_commands;
pub mod commands;
pub mod engine;
pub mod error;
pub mod face;
pub mod image_io;
pub mod license;
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
            commands::print_sheets,
            commands::release_image,
            commands::runtime_info,
            commands::license_status,
            commands::activate_license,
            commands::list_attire,
            commands::import_attire,
            commands::remove_attire,
            commands::read_attire,
            book_commands::book_add_photos,
            book_commands::book_thumb,
            book_commands::book_render_photo,
            book_commands::book_clear,
            book_commands::book_expand_paths,
            book_commands::book_find_in_folder,
            book_commands::book_read_project,
            book_commands::book_write_project,
            book_commands::book_autosave_write,
            book_commands::book_autosave_read,
            book_commands::book_autosave_clear,
            book_commands::book_save_bytes,
            book_commands::book_stage_sheet,
            book_commands::book_clear_staged,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Philmer ID Photo Studio");
}
