use serde::Deserialize;
use std::fs;
use tauri::{AppHandle, Manager, Runtime};

const APP_STATE_FILE: &str = "app-state.json";

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRuntimeSettings {
    #[allow(dead_code)]
    pub launch_on_startup: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub startup_open_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedAppStateEnvelope {
    schema_version: Option<u32>,
    runtime_settings: Option<PersistedRuntimeSettings>,
    launch_on_startup: Option<bool>,
    close_to_tray: Option<bool>,
    startup_open_mode: Option<String>,
}

pub fn load_runtime_settings<R: Runtime>(app: &AppHandle<R>) -> PersistedRuntimeSettings {
    let Ok(mut path) = app.path().app_data_dir() else {
        return PersistedRuntimeSettings::default();
    };
    path.push(APP_STATE_FILE);

    let Ok(contents) = fs::read_to_string(path) else {
        return PersistedRuntimeSettings::default();
    };

    let Ok(envelope) = serde_json::from_str::<PersistedAppStateEnvelope>(&contents) else {
        return PersistedRuntimeSettings::default();
    };

    if envelope.schema_version.unwrap_or(0) >= 2 {
        if let Some(runtime_settings) = envelope.runtime_settings {
            return runtime_settings;
        }
    }

    PersistedRuntimeSettings {
        launch_on_startup: envelope.launch_on_startup,
        close_to_tray: envelope.close_to_tray,
        startup_open_mode: envelope.startup_open_mode,
    }
}
