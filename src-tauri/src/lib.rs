pub mod controller;
mod persisted_state;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, Window, WindowEvent,
};

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

fn apply_runtime_settings<R: Runtime>(app: &AppHandle<R>, settings: &RuntimeSettings) {
    let persisted = persisted_state::load_runtime_settings(app);
    *settings.close_to_tray.lock().unwrap() = persisted.close_to_tray.unwrap_or(false);
    *settings.startup_open_mode.lock().unwrap() =
        StartupOpenMode::from_value(persisted.startup_open_mode.as_deref().unwrap_or("normal"));
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
fn set_lightbar(
    state: tauri::State<'_, controller::AppState>,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), String> {
    controller::set_lightbar(state.controller.clone(), r, g, b);
    Ok(())
}

#[tauri::command]
fn set_triggers(
    state: tauri::State<'_, controller::AppState>,
    left: controller::TriggerEffectConfig,
    right: controller::TriggerEffectConfig,
) -> Result<(), String> {
    controller::set_triggers(state.controller.clone(), left, right);
    Ok(())
}

#[tauri::command]
fn set_adaptive_triggers(
    state: tauri::State<'_, controller::AppState>,
    left: controller::TriggerEffectConfig,
    right: controller::TriggerEffectConfig,
) -> Result<(), String> {
    controller::set_adaptive_triggers(state.controller.clone(), left, right);
    Ok(())
}

#[tauri::command]
fn clear_adaptive_triggers(state: tauri::State<'_, controller::AppState>) -> Result<(), String> {
    controller::clear_adaptive_triggers(state.controller.clone());
    Ok(())
}

#[tauri::command]
fn sync_adaptive_trigger_settings(
    state: tauri::State<'_, controller::AppState>,
    settings: controller::AdaptiveTriggerRuntimeSettings,
) -> Result<(), String> {
    controller::sync_adaptive_trigger_settings(state.controller.clone(), settings);
    Ok(())
}

#[tauri::command]
fn get_game_telemetry_status(
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::GameTelemetryStatus, String> {
    Ok(controller::get_game_telemetry_status(
        state.controller.clone(),
    ))
}

#[tauri::command]
fn capture_live_ocr_calibration_preview(
    settings: controller::AdaptiveTriggerRuntimeSettings,
) -> Result<controller::OcrCalibrationPreview, String> {
    controller::capture_live_ocr_calibration_preview(settings)
}

#[tauri::command]
fn list_live_ocr_process_options() -> Result<Vec<controller::ActiveProcessOption>, String> {
    controller::list_live_ocr_process_options()
}

#[tauri::command]
fn set_rumble(
    state: tauri::State<'_, controller::AppState>,
    left: u8,
    right: u8,
) -> Result<(), String> {
    controller::set_rumble(state.controller.clone(), left, right);
    Ok(())
}

#[tauri::command]
fn get_audio(
    state: tauri::State<'_, controller::AppState>,
) -> Result<controller::AudioSettings, String> {
    Ok(controller::get_audio(state.controller.clone()))
}

#[tauri::command]
fn set_audio(
    state: tauri::State<'_, controller::AppState>,
    speaker_volume: u8,
    headphone_volume: u8,
    mic_volume: u8,
    mic_mute: bool,
    audio_mute: bool,
    mic_mute_led: u8,
    force_internal_mic: bool,
    force_internal_speaker: bool,
) -> Result<(), String> {
    controller::set_audio(
        state.controller.clone(),
        speaker_volume,
        headphone_volume,
        mic_volume,
        mic_mute,
        audio_mute,
        mic_mute_led,
        force_internal_mic,
        force_internal_speaker,
    );
    Ok(())
}

#[tauri::command]
fn test_speaker(state: tauri::State<'_, controller::AppState>) -> Result<(), String> {
    controller::test_speaker(state.controller.clone())
}

#[tauri::command]
fn start_mic_test(state: tauri::State<'_, controller::AppState>) -> Result<(), String> {
    controller::start_mic_test(state.controller.clone())
}

#[tauri::command]
fn stop_mic_test(state: tauri::State<'_, controller::AppState>) -> Result<(), String> {
    controller::stop_mic_test(state.controller.clone());
    Ok(())
}

#[tauri::command]
fn get_audio_test_status(
    state: tauri::State<'_, controller::AppState>,
) -> Result<(bool, bool), String> {
    Ok(controller::get_audio_test_status(state.controller.clone()))
}

#[tauri::command]
fn get_controller_status(state: tauri::State<'_, controller::AppState>) -> Result<bool, String> {
    let current_state = state.controller.lock().unwrap_or_else(|e| e.into_inner());
    Ok(current_state.connected)
}

#[tauri::command]
fn set_touchpad_enabled(
    state: tauri::State<'_, controller::AppState>,
    enabled: bool,
) -> Result<(), String> {
    controller::set_touchpad_enabled(state.controller.clone(), enabled);
    Ok(())
}

#[tauri::command]
fn set_touchpad_sensitivity(
    state: tauri::State<'_, controller::AppState>,
    sensitivity: f64,
) -> Result<(), String> {
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
    Ok(controller::get_calibration_profile(
        state.controller.clone(),
    ))
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
    Ok(controller::get_live_input_snapshot(
        state.controller.clone(),
    ))
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
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([AUTOSTART_FLAG])
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .manage(runtime_settings)
        .setup(|app| {
            controller::start_controller_listener(controller_state.clone(), app.handle().clone());
            controller::start_game_monitor(controller_state, app.handle().clone());
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

                let close_to_tray = *settings
                    .close_to_tray
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
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
            set_adaptive_triggers,
            clear_adaptive_triggers,
            sync_adaptive_trigger_settings,
            get_game_telemetry_status,
            capture_live_ocr_calibration_preview,
            list_live_ocr_process_options,
            set_rumble,
            get_audio,
            set_audio,
            test_speaker,
            start_mic_test,
            stop_mic_test,
            get_audio_test_status,
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
