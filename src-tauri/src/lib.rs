pub mod controller;
use serde::Deserialize;
use std::{
    fs,
    thread,
    time::Duration,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, Window, WindowEvent,
};

const APP_STATE_FILE: &str = "app-state.json";
const AUTOSTART_FLAG: &str = "--autostart";
const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_QUIT_ID: &str = "tray_quit";

#[derive(Clone, Copy, Default)]
enum StartupOpenMode {
    #[default]
    Normal,
    Tray,
}

impl StartupOpenMode {
    fn from_value(value: &str) -> Self {
        match value {
            "tray" => Self::Tray,
            _ => Self::Normal,
        }
    }
}

#[derive(Default)]
struct RuntimeSettings {
    close_to_tray: Mutex<bool>,
    startup_open_mode: Mutex<StartupOpenMode>,
    is_quitting: AtomicBool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedRuntimeSettings {
    close_to_tray: Option<bool>,
    startup_open_mode: Option<String>,
}

fn load_persisted_runtime_settings<R: Runtime>(app: &AppHandle<R>) -> PersistedRuntimeSettings {
    let Ok(mut path) = app.path().app_data_dir() else {
        return PersistedRuntimeSettings::default();
    };
    path.push(APP_STATE_FILE);

    let Ok(contents) = fs::read_to_string(path) else {
        return PersistedRuntimeSettings::default();
    };

    serde_json::from_str(&contents).unwrap_or_default()
}

fn apply_runtime_settings<R: Runtime>(app: &AppHandle<R>, settings: &RuntimeSettings) {
    let persisted = load_persisted_runtime_settings(app);
    *settings.close_to_tray.lock().unwrap() = persisted.close_to_tray.unwrap_or(false);
    *settings.startup_open_mode.lock().unwrap() = StartupOpenMode::from_value(
        persisted
            .startup_open_mode
            .as_deref()
            .unwrap_or("normal"),
    );
}

fn restore_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window_to_tray<R: Runtime>(window: &Window<R>) {
    let _ = window.set_skip_taskbar(true);
    let _ = window.hide();
}

fn hide_main_webview_to_tray<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(true);
        let _ = window.hide();
    }
}

fn should_start_hidden(settings: &RuntimeSettings) -> bool {
    let launched_from_autostart = std::env::args().any(|arg| arg == AUTOSTART_FLAG);
    if !launched_from_autostart {
        return false;
    }

    matches!(
        *settings.startup_open_mode.lock().unwrap(),
        StartupOpenMode::Tray
    )
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "Show Application", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::with_id("winsense-tray")
        .menu(&menu)
        .tooltip("WinSense")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_SHOW_ID => restore_main_window(app),
            TRAY_QUIT_ID => {
                prepare_controller_shutdown(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

fn prepare_controller_shutdown<R: Runtime>(app: &AppHandle<R>) {
    let settings = app.state::<RuntimeSettings>();
    if settings.is_quitting.swap(true, Ordering::Relaxed) {
        return;
    }

    let app_state = app.state::<controller::AppState>();
    controller::reset_on_exit(app_state.controller.clone());

    // Give the controller listener a short window to flush the reset report.
    thread::sleep(Duration::from_millis(40));
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn set_lightbar(state: tauri::State<'_, controller::AppState>, r: u8, g: u8, b: u8) -> Result<(), String> {
    controller::set_lightbar(state.controller.clone(), r, g, b);
    Ok(())
}

#[tauri::command]
fn set_triggers(
    state: tauri::State<'_, controller::AppState>,
    left_mode: u8, left_force: u8, left_start: u8, left_end: u8, left_frequency: u8,
    right_mode: u8, right_force: u8, right_start: u8, right_end: u8, right_frequency: u8,
) -> Result<(), String> {
    controller::set_triggers(
        state.controller.clone(),
        left_mode, left_force, left_start, left_end, left_frequency,
        right_mode, right_force, right_start, right_end, right_frequency,
    );
    Ok(())
}

#[tauri::command]
fn set_rumble(state: tauri::State<'_, controller::AppState>, left: u8, right: u8) -> Result<(), String> {
    controller::set_rumble(state.controller.clone(), left, right);
    Ok(())
}

#[tauri::command]
fn get_controller_status(state: tauri::State<'_, controller::AppState>) -> Result<bool, String> {
    let current_state = state.controller.lock().unwrap_or_else(|e| e.into_inner());
    Ok(current_state.connected)
}

#[tauri::command]
fn set_touchpad_enabled(state: tauri::State<'_, controller::AppState>, enabled: bool) -> Result<(), String> {
    controller::set_touchpad_enabled(state.controller.clone(), enabled);
    Ok(())
}

#[tauri::command]
fn set_touchpad_sensitivity(state: tauri::State<'_, controller::AppState>, sensitivity: f64) -> Result<(), String> {
    controller::set_touchpad_sensitivity(state.controller.clone(), sensitivity);
    Ok(())
}

#[tauri::command]
fn get_mapping_presets() -> Result<Vec<controller::MappingProfile>, String> {
    Ok(controller::mapping_presets())
}

#[tauri::command]
fn get_mapping_profile(
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::MappingProfile, String> {
    Ok(controller::get_mapping_profile(state.controller.clone()))
}

#[tauri::command]
fn set_mapping_profile(
    state: tauri::State<'_, controller::AppState>,
    profile: controller::MappingProfile,
) -> Result<(), String> {
    controller::set_mapping_profile(state.controller.clone(), profile);
    Ok(())
}

#[tauri::command]
fn get_calibration_profile(
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::CalibrationProfile, String> {
    Ok(controller::get_calibration_profile(state.controller.clone()))
}

#[tauri::command]
fn set_calibration_profile(
    state: tauri::State<'_, controller::AppState>,
    profile: controller::CalibrationProfile,
) -> Result<(), String> {
    controller::set_calibration_profile(state.controller.clone(), profile);
    Ok(())
}

#[tauri::command]
fn get_live_input_snapshot(
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::LiveInputSnapshot, String> {
    Ok(controller::get_live_input_snapshot(state.controller.clone()))
}

#[tauri::command]
fn get_calibration_capabilities() -> Result<controller::CalibrationCapabilities, String> {
    Ok(controller::calibration_capabilities())
}

#[tauri::command]
fn get_firmware_calibration_status(
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    Ok(controller::get_firmware_calibration_status(
        state.controller.clone(),
    ))
}

#[tauri::command]
fn start_firmware_center_calibration(
    app: tauri::AppHandle,
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    let status = controller::start_firmware_center_calibration(state.controller.clone())?;
    let _ = app.emit("firmware-calibration-status", &status);
    Ok(status)
}

#[tauri::command]
fn sample_firmware_center_calibration(
    app: tauri::AppHandle,
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    let status = controller::sample_firmware_center_calibration(state.controller.clone())?;
    let _ = app.emit("firmware-calibration-status", &status);
    Ok(status)
}

#[tauri::command]
fn store_firmware_center_calibration(
    app: tauri::AppHandle,
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    let status = controller::store_firmware_center_calibration(state.controller.clone())?;
    let _ = app.emit("firmware-calibration-status", &status);
    Ok(status)
}

#[tauri::command]
fn start_firmware_range_calibration(
    app: tauri::AppHandle,
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    let status = controller::start_firmware_range_calibration(state.controller.clone())?;
    let _ = app.emit("firmware-calibration-status", &status);
    Ok(status)
}

#[tauri::command]
fn store_firmware_range_calibration(
    app: tauri::AppHandle,
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    let status = controller::store_firmware_range_calibration(state.controller.clone())?;
    let _ = app.emit("firmware-calibration-status", &status);
    Ok(status)
}

#[tauri::command]
fn save_firmware_calibration_permanently(
    app: tauri::AppHandle,
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    let status = controller::save_firmware_calibration_permanently(state.controller.clone())?;
    let _ = app.emit("firmware-calibration-status", &status);
    Ok(status)
}

#[tauri::command]
fn cancel_firmware_calibration(
    app: tauri::AppHandle,
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::FirmwareCalibrationStatus, String> {
    let status = controller::cancel_firmware_calibration(state.controller.clone())?;
    let _ = app.emit("firmware-calibration-status", &status);
    Ok(status)
}

#[tauri::command]
fn sync_runtime_settings(
    state: tauri::State<'_, RuntimeSettings>,
    close_to_tray: bool,
    startup_open_mode: String,
) -> Result<(), String> {
    *state.close_to_tray.lock().map_err(|e| e.to_string())? = close_to_tray;
    *state.startup_open_mode.lock().map_err(|e| e.to_string())? =
        StartupOpenMode::from_value(&startup_open_mode);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = controller::AppState::new();
    let controller_state = app_state.controller.clone();
    let runtime_settings = RuntimeSettings::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().args([AUTOSTART_FLAG]).build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .manage(runtime_settings)
        .setup(|app| {
            controller::start_controller_listener(controller_state, app.handle().clone());
            let settings = app.state::<RuntimeSettings>();
            apply_runtime_settings(&app.handle(), &settings);
            build_tray(&app.handle())?;
            if should_start_hidden(&settings) {
                hide_main_webview_to_tray(&app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let settings = window.state::<RuntimeSettings>();
                if settings.is_quitting.load(Ordering::Relaxed) {
                    return;
                }

                let close_to_tray = *settings.close_to_tray.lock().unwrap_or_else(|e| e.into_inner());
                if close_to_tray {
                    api.prevent_close();
                    hide_main_window_to_tray(window);
                } else {
                    prepare_controller_shutdown(&window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_lightbar,
            set_triggers,
            set_rumble,
            get_controller_status,
            set_touchpad_enabled,
            set_touchpad_sensitivity,
            get_mapping_presets,
            get_mapping_profile,
            set_mapping_profile,
            get_calibration_profile,
            set_calibration_profile,
            get_live_input_snapshot,
            get_calibration_capabilities,
            get_firmware_calibration_status,
            start_firmware_center_calibration,
            sample_firmware_center_calibration,
            store_firmware_center_calibration,
            start_firmware_range_calibration,
            store_firmware_range_calibration,
            save_firmware_calibration_permanently,
            cancel_firmware_calibration,
            sync_runtime_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
