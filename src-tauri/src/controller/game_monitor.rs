use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{TriggerEffectConfig, TriggerEffectKind};

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::io::Cursor;

#[cfg(windows)]
use image::{imageops, DynamicImage, ImageFormat, RgbaImage};
#[cfg(windows)]
use screenshots::Screen;

#[cfg(windows)]
use windows::Win32::{
    Foundation::{CloseHandle, BOOL, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, RECT},
    System::{
        Diagnostics::{
            Debug::ReadProcessMemory,
            ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
        },
        Memory::{
            VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, PAGE_EXECUTE_READ,
            PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY, PAGE_GUARD, PAGE_NOACCESS,
            PAGE_READONLY, PAGE_READWRITE, PAGE_WRITECOPY,
        },
        Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
        WinRT::IMemoryBufferByteAccess,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    },
};
#[cfg(windows)]
use windows::{
    core::Interface,
    Graphics::Imaging::{BitmapBufferAccessMode, BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
};

const NFS_HEAT_PROCESS_NAME: &str = "NeedForSpeedHeat.exe";
const HEAT_CURRENT_GEAR_ARTIFACT_NIBBLE: usize = 0x4;
const HEAT_CURRENT_GEAR_ARTIFACT_OFFSET: usize = 0x14;
const HEAT_LAST_GEAR_ARTIFACT_OFFSET: usize = 0x48;
const INITIAL_DISCOVERY_RADIUS: usize = 0x600;
const MAX_DISCOVERY_RADIUS: usize = 0x4000;
const MAX_DISCOVERY_CANDIDATES: usize = 96;
const MAX_LOCKED_INVALID_READS: u8 = 2;
const MAX_JUMP_KPH_PER_SAMPLE: u32 = 220;
const MIN_LIVE_DISCOVERY_SPEED_KPH: u32 = 2;
const MAX_DISCOVERY_SPEED_KPH: u32 = 999;
const OCR_MAX_CONSECUTIVE_FAILURES: u8 = 3;
const OCR_DEFAULT_THRESHOLD: u8 = 168;
const OCR_UPSCALE_FACTOR: u32 = 3;
const KNOWN_RACING_PROCESS_NAMES: &[&str] = &[
    "NeedForSpeedHeat.exe",
    "ForzaHorizon5.exe",
    "ForzaHorizon4.exe",
    "ForzaMotorsport.exe",
    "ForzaMotorsport7.exe",
    "RRRE.exe",
    "AMS2AVX.exe",
    "AssettoCorsa.exe",
    "AssettoCorsaCompetizione.exe",
    "iRacingSim64DX11.exe",
    "EA SPORTS WRC.exe",
    "WRC.exe",
    "F1_24.exe",
    "F1_23.exe",
    "F1_22.exe",
    "DIRT5.exe",
    "DIRT4.exe",
    "DIRTRally2.exe",
    "TheCrewMotorfest.exe",
    "TheCrew2.exe",
    "ProjectCars3.exe",
    "pcars2.exe",
    "Trackmania.exe",
];
const RACING_PROCESS_KEYWORDS: &[&str] = &[
    "racing",
    "motorsport",
    "forza",
    "trackmania",
    "assetto",
    "corsa",
    "wrc",
    "f1",
    "needforspeed",
    "nfs",
    "crew",
    "dirt",
    "rally",
    "sim",
    "race",
];

const CURRENT_GEAR_PATTERN: [u8; 20] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xAA, 0x61, 0x1C, 0x3F,
    0xAA, 0x61, 0x1C, 0x3F,
];

const LAST_GEAR_PATTERN: [u8; 40] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3F, 0x00, 0x00, 0x00, 0x3F,
    0x00, 0x00, 0x00, 0x3F, 0x00, 0x00, 0x00, 0x3F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdaptiveTriggerInputSource {
    Demo,
    Live,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdaptiveTriggerGame {
    NfsHeat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameTelemetryStage {
    Disabled,
    WaitingForGame,
    GameDetected,
    Attached,
    TelemetryUnavailable,
    TelemetryStale,
    Unsupported,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrCalibrationRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub reference_width: u32,
    pub reference_height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrCalibrationPreview {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProcessOption {
    pub process_id: u32,
    pub process_name: String,
    pub window_title: String,
    pub likely_racing: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedForSpeedHeatAdaptiveTriggerSettings {
    pub demo_speed_kph: u32,
    pub min_speed_kph: u32,
    pub max_speed_kph: u32,
    pub brake_start_position: u8,
    pub brake_end_position: u8,
    pub brake_min_force: u8,
    pub brake_max_force: u8,
    pub throttle_start_position: u8,
    pub throttle_min_force: u8,
    pub throttle_max_force: u8,
    pub ocr_calibration: Option<OcrCalibrationRegion>,
    pub ocr_process_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveTriggerRuntimeSettings {
    pub enabled: bool,
    pub input_source: AdaptiveTriggerInputSource,
    pub selected_game: AdaptiveTriggerGame,
    pub nfs_heat: NeedForSpeedHeatAdaptiveTriggerSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameTelemetryStatus {
    pub enabled: bool,
    pub input_source: AdaptiveTriggerInputSource,
    pub selected_game: AdaptiveTriggerGame,
    pub stage: GameTelemetryStage,
    pub process_id: Option<u32>,
    pub speed_kph: Option<u32>,
    pub last_speed_at_unix_ms: Option<u64>,
    pub message: String,
}

pub struct GameMonitorSnapshot {
    pub status: GameTelemetryStatus,
    pub effects: Option<(TriggerEffectConfig, TriggerEffectConfig)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum SpeedReadResult {
    Speed(u32),
    Unavailable(String),
    Stale(String),
    Error(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct GearAddresses {
    current: usize,
    last: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SpeedValueKind {
    U32,
    F32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SpeedCandidate {
    address: usize,
    kind: SpeedValueKind,
    last_speed_kph: Option<u32>,
    score: i16,
    sample_count: u8,
    change_count: u8,
    stagnant_reads: u8,
}

struct ProcessMemorySpeedProvider {
    attached_process_id: Option<u32>,
    gear_addresses: Option<GearAddresses>,
    speed_candidates: Vec<SpeedCandidate>,
    locked_candidate: Option<SpeedCandidate>,
    discovery_radius: usize,
    invalid_locked_reads: u8,
    candidate_scan_passes: u8,
    #[cfg(windows)]
    process_handle: Option<HANDLE>,
}

impl ProcessMemorySpeedProvider {
    fn new() -> Self {
        Self {
            attached_process_id: None,
            gear_addresses: None,
            speed_candidates: Vec::new(),
            locked_candidate: None,
            discovery_radius: INITIAL_DISCOVERY_RADIUS,
            invalid_locked_reads: 0,
            candidate_scan_passes: 0,
            #[cfg(windows)]
            process_handle: None,
        }
    }

    fn reset(&mut self) {
        self.attached_process_id = None;
        self.gear_addresses = None;
        self.speed_candidates.clear();
        self.locked_candidate = None;
        self.discovery_radius = INITIAL_DISCOVERY_RADIUS;
        self.invalid_locked_reads = 0;
        self.candidate_scan_passes = 0;
        #[cfg(windows)]
        close_process_handle(&mut self.process_handle);
    }

    fn read_nfs_heat_speed(&mut self, process_id: u32) -> SpeedReadResult {
        #[cfg(not(windows))]
        {
            let _ = process_id;
            SpeedReadResult::Unavailable(
                "Process-memory speed reading is only available on Windows.".to_string(),
            )
        }

        #[cfg(windows)]
        {
            if let Err(message) = self.ensure_process_handle(process_id) {
                return SpeedReadResult::Error(message);
            }

            if let Some(speed) = self.try_read_locked_candidate() {
                return SpeedReadResult::Speed(speed);
            }

            let Some(handle) = self.process_handle else {
                return SpeedReadResult::Error(
                    "Need for Speed: Heat was detected, but the process handle is unavailable."
                        .to_string(),
                );
            };

            if self.gear_addresses.is_none() {
                self.gear_addresses = find_gear_addresses(handle);
                if self.gear_addresses.is_none() {
                    return SpeedReadResult::Unavailable(
                        "Scanning for Need for Speed: Heat player-state anchors. Load into active driving gameplay and keep the game unminimized."
                            .to_string(),
                    );
                }
            }

            if self.speed_candidates.is_empty() {
                self.discover_speed_candidates(handle);
                if self.speed_candidates.is_empty() {
                    return SpeedReadResult::Unavailable(
                        "No plausible speed candidates were found yet. Start driving, accelerate above 30 km/h, and stay out of the garage while WinSense scans."
                            .to_string(),
                    );
                }
            }

            self.candidate_scan_passes = self.candidate_scan_passes.saturating_add(1);
            let best_candidate = self.update_speed_candidates(handle);
            if let Some(ref candidate) = best_candidate {
                if should_lock_candidate(&candidate) {
                    self.locked_candidate = Some(candidate.clone());
                    self.invalid_locked_reads = 0;
                    if let Some(speed) = candidate.last_speed_kph {
                        return SpeedReadResult::Speed(speed);
                    }
                }
            }

            if self.speed_candidates.is_empty() {
                if self.discovery_radius < MAX_DISCOVERY_RADIUS {
                    self.discovery_radius = (self.discovery_radius * 2).min(MAX_DISCOVERY_RADIUS);
                }
                return SpeedReadResult::Unavailable(
                    "WinSense lost all speed candidates and is widening the scan. Keep driving with clear acceleration and braking input."
                        .to_string(),
                );
            }

            if self.candidate_scan_passes >= 5 && best_candidate.is_none() {
                self.speed_candidates.clear();
                self.discovery_radius = (self.discovery_radius * 2).min(MAX_DISCOVERY_RADIUS);
                self.candidate_scan_passes = 0;
                return SpeedReadResult::Stale(
                    "Speed discovery stalled, so WinSense is rescanning a wider memory window. Keep the car moving to help lock onto the correct value."
                        .to_string(),
                );
            }

            let candidate_count = self.speed_candidates.len();
            let top_score = best_candidate.map(|candidate| candidate.score).unwrap_or(0);
            SpeedReadResult::Unavailable(format!(
                "Tracking {candidate_count} live speed candidates (best score {top_score}). Drive above 30 km/h, then brake, so WinSense can lock the correct speed address."
            ))
        }
    }

    #[cfg(windows)]
    fn ensure_process_handle(&mut self, process_id: u32) -> Result<(), String> {
        if self.attached_process_id == Some(process_id) && self.process_handle.is_some() {
            return Ok(());
        }

        self.reset();
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                false,
                process_id,
            )
        }
        .map_err(|error| {
            format!("Unable to open Need for Speed: Heat process for memory reads: {error}")
        })?;

        self.attached_process_id = Some(process_id);
        self.process_handle = Some(handle);
        Ok(())
    }

    #[cfg(windows)]
    fn try_read_locked_candidate(&mut self) -> Option<u32> {
        let handle = self.process_handle?;
        let locked_candidate = self.locked_candidate.clone()?;
        let speed = read_candidate_speed(handle, &locked_candidate)?;
        if let Some(previous_speed) = locked_candidate.last_speed_kph {
            if !is_plausible_runtime_jump(previous_speed, speed) {
                self.invalid_locked_reads = self.invalid_locked_reads.saturating_add(1);
                if self.invalid_locked_reads >= MAX_LOCKED_INVALID_READS {
                    self.locked_candidate = None;
                    self.speed_candidates.clear();
                    self.discovery_radius = INITIAL_DISCOVERY_RADIUS;
                    self.candidate_scan_passes = 0;
                }
                return None;
            }
        }

        self.invalid_locked_reads = 0;
        self.locked_candidate = Some(SpeedCandidate {
            last_speed_kph: Some(speed),
            sample_count: locked_candidate.sample_count.saturating_add(1),
            ..locked_candidate
        });
        Some(speed)
    }

    #[cfg(windows)]
    fn discover_speed_candidates(&mut self, handle: HANDLE) {
        let Some(gear_addresses) = self.gear_addresses else {
            return;
        };

        let mut discovered = Vec::new();
        let mut seen = HashSet::new();

        for (base, size) in candidate_search_windows(gear_addresses, self.discovery_radius) {
            let Some(buffer) = read_process_bytes(handle, base, size) else {
                continue;
            };

            for candidate in collect_candidates_from_buffer(base, &buffer) {
                if seen.insert((candidate.address, candidate.kind as u8)) {
                    discovered.push(candidate);
                    if discovered.len() >= MAX_DISCOVERY_CANDIDATES {
                        break;
                    }
                }
            }

            if discovered.len() >= MAX_DISCOVERY_CANDIDATES {
                break;
            }
        }

        self.speed_candidates = discovered;
        self.candidate_scan_passes = 0;
    }

    #[cfg(windows)]
    fn update_speed_candidates(&mut self, handle: HANDLE) -> Option<SpeedCandidate> {
        let mut updated_candidates = Vec::with_capacity(self.speed_candidates.len());
        let mut best_candidate: Option<SpeedCandidate> = None;

        for mut candidate in self.speed_candidates.clone() {
            let Some(speed_kph) = read_candidate_speed(handle, &candidate) else {
                continue;
            };

            observe_candidate(&mut candidate, speed_kph);
            if candidate.score < 0 {
                continue;
            }

            if best_candidate
                .as_ref()
                .map(|current| candidate.score > current.score)
                .unwrap_or(true)
            {
                best_candidate = Some(candidate.clone());
            }

            updated_candidates.push(candidate);
        }

        updated_candidates.sort_by(|left, right| right.score.cmp(&left.score));
        updated_candidates.truncate(MAX_DISCOVERY_CANDIDATES);
        self.speed_candidates = updated_candidates;
        best_candidate
    }
}

struct OcrSpeedProvider {
    last_speed_kph: Option<u32>,
    consecutive_failures: u8,
}

impl OcrSpeedProvider {
    fn new() -> Self {
        Self {
            last_speed_kph: None,
            consecutive_failures: 0,
        }
    }

    fn reset(&mut self) {
        self.last_speed_kph = None;
        self.consecutive_failures = 0;
    }

    fn read_nfs_heat_speed(
        &mut self,
        process_id: u32,
        settings: &NeedForSpeedHeatAdaptiveTriggerSettings,
    ) -> SpeedReadResult {
        #[cfg(not(windows))]
        {
            let _ = (process_id, settings);
            SpeedReadResult::Unavailable(
                "OCR live telemetry is only available on Windows.".to_string(),
            )
        }

        #[cfg(windows)]
        {
            let Some(calibration) = settings.ocr_calibration.as_ref() else {
                return SpeedReadResult::Unavailable(
                    "Live OCR calibration is required. Capture the speedometer region in Adaptive Triggers before enabling Live mode."
                        .to_string(),
                );
            };

            let screenshot = match capture_calibrated_nfs_heat_region(process_id, calibration) {
                Ok(screenshot) => screenshot,
                Err(message) => return SpeedReadResult::Error(message),
            };

            let candidates = extract_ocr_speed_candidates(&screenshot);
            let Some(speed_kph) = choose_ocr_speed_candidate(&candidates, self.last_speed_kph)
            else {
                self.consecutive_failures = self.consecutive_failures.saturating_add(1);
                return if self.last_speed_kph.is_some()
                    && self.consecutive_failures >= OCR_MAX_CONSECUTIVE_FAILURES
                {
                    SpeedReadResult::Stale(
                        "OCR saw the calibrated HUD region but could not keep reading digits. Recalibrate the crop if the speedometer moved or is being blurred."
                            .to_string(),
                    )
                } else {
                    SpeedReadResult::Unavailable(
                        "OCR could not read the calibrated speedometer digits yet. Make sure the crop only covers the speed readout and the game HUD is clearly visible."
                            .to_string(),
                    )
                };
            };

            if let Some(previous_speed) = self.last_speed_kph {
                if !is_plausible_runtime_jump(previous_speed, speed_kph) {
                    self.consecutive_failures = self.consecutive_failures.saturating_add(1);
                    return SpeedReadResult::Stale(
                        "OCR detected an implausible jump in speed, so WinSense is waiting for a cleaner read from the HUD."
                            .to_string(),
                    );
                }
            }

            self.last_speed_kph = Some(speed_kph);
            self.consecutive_failures = 0;
            SpeedReadResult::Speed(speed_kph)
        }
    }
}

struct ExternalBridgeSpeedProvider;

impl ExternalBridgeSpeedProvider {
    fn reset(&mut self) {}

    fn read_nfs_heat_speed(&mut self, _process_id: u32) -> SpeedReadResult {
        SpeedReadResult::Unavailable(
            "External bridge telemetry is not configured yet for racing-game OCR monitoring."
                .to_string(),
        )
    }
}

struct NfsHeatSpeedProviderChain {
    ocr: OcrSpeedProvider,
    process_memory: ProcessMemorySpeedProvider,
    external_bridge: ExternalBridgeSpeedProvider,
}

impl NfsHeatSpeedProviderChain {
    fn new() -> Self {
        Self {
            ocr: OcrSpeedProvider::new(),
            process_memory: ProcessMemorySpeedProvider::new(),
            external_bridge: ExternalBridgeSpeedProvider,
        }
    }

    fn reset(&mut self) {
        self.ocr.reset();
        self.process_memory.reset();
        self.external_bridge.reset();
    }

    fn read_nfs_heat_speed(
        &mut self,
        process_id: u32,
        process_name: &str,
        settings: &NeedForSpeedHeatAdaptiveTriggerSettings,
    ) -> SpeedReadResult {
        match self.ocr.read_nfs_heat_speed(process_id, settings) {
            SpeedReadResult::Speed(speed) => SpeedReadResult::Speed(speed),
            SpeedReadResult::Stale(message) => SpeedReadResult::Stale(message),
            SpeedReadResult::Error(message) => SpeedReadResult::Error(message),
            SpeedReadResult::Unavailable(ocr_message) => {
                if !process_name.eq_ignore_ascii_case(NFS_HEAT_PROCESS_NAME) {
                    return SpeedReadResult::Unavailable(ocr_message);
                }

                match self.process_memory.read_nfs_heat_speed(process_id) {
                    SpeedReadResult::Speed(speed) => SpeedReadResult::Speed(speed),
                    SpeedReadResult::Stale(message) => SpeedReadResult::Stale(message),
                    SpeedReadResult::Error(message) => SpeedReadResult::Error(message),
                    SpeedReadResult::Unavailable(process_memory_message) => {
                        match self.external_bridge.read_nfs_heat_speed(process_id) {
                            SpeedReadResult::Speed(speed) => SpeedReadResult::Speed(speed),
                            SpeedReadResult::Stale(message) => SpeedReadResult::Stale(message),
                            SpeedReadResult::Error(message) => SpeedReadResult::Error(message),
                            SpeedReadResult::Unavailable(external_bridge_message) => {
                                SpeedReadResult::Unavailable(format!(
                                "{ocr_message} {process_memory_message} {external_bridge_message}"
                            ))
                            }
                        }
                    }
                }
            }
        }
    }
}

pub struct GameMonitorRuntime {
    attached_process_id: Option<u32>,
    last_speed_kph: Option<u32>,
    last_speed_at_unix_ms: Option<u64>,
    nfs_heat_provider: NfsHeatSpeedProviderChain,
}

impl GameMonitorRuntime {
    pub fn new() -> Self {
        Self {
            attached_process_id: None,
            last_speed_kph: None,
            last_speed_at_unix_ms: None,
            nfs_heat_provider: NfsHeatSpeedProviderChain::new(),
        }
    }

    pub fn poll(&mut self, settings: &AdaptiveTriggerRuntimeSettings) -> GameMonitorSnapshot {
        if !settings.enabled {
            self.reset();
            return GameMonitorSnapshot {
                status: disabled_status(settings, "Adaptive trigger live telemetry is disabled."),
                effects: None,
            };
        }

        if settings.input_source == AdaptiveTriggerInputSource::Demo {
            self.reset();
            return GameMonitorSnapshot {
                status: disabled_status(
                    settings,
                    "Adaptive Triggers are using demo speed input. Switch to Live to monitor racing-game OCR telemetry.",
                ),
                effects: None,
            };
        }

        #[cfg(not(windows))]
        {
            self.reset();
            return GameMonitorSnapshot {
                status: GameTelemetryStatus {
                    enabled: settings.enabled,
                    input_source: settings.input_source,
                    selected_game: settings.selected_game,
                    stage: GameTelemetryStage::Unsupported,
                    process_id: None,
                    speed_kph: None,
                    last_speed_at_unix_ms: None,
                    message:
                        "Live racing-game OCR telemetry is currently only supported on Windows."
                            .to_string(),
                },
                effects: None,
            };
        }

        #[cfg(windows)]
        {
            let target = resolve_live_ocr_process_target(settings);
            let Some(target) = target else {
                self.reset();
                return GameMonitorSnapshot {
                    status: GameTelemetryStatus {
                        enabled: settings.enabled,
                        input_source: settings.input_source,
                        selected_game: settings.selected_game,
                        stage: GameTelemetryStage::WaitingForGame,
                        process_id: None,
                        speed_kph: None,
                        last_speed_at_unix_ms: None,
                        message: waiting_for_live_process_message(settings),
                    },
                    effects: None,
                };
            };
            let process_id = target.process_id;

            if self.attached_process_id != Some(process_id) {
                self.attached_process_id = Some(process_id);
                self.last_speed_kph = None;
                self.last_speed_at_unix_ms = None;
                self.nfs_heat_provider.reset();
                return GameMonitorSnapshot {
                    status: GameTelemetryStatus {
                        enabled: settings.enabled,
                        input_source: settings.input_source,
                        selected_game: settings.selected_game,
                        stage: GameTelemetryStage::GameDetected,
                        process_id: Some(process_id),
                        speed_kph: None,
                        last_speed_at_unix_ms: None,
                        message: format!(
                            "{} `{}` was detected. Starting OCR speed capture.",
                            if target.auto_detected {
                                "Racing game"
                            } else {
                                "Selected process"
                            },
                            target.process_name
                        ),
                    },
                    effects: None,
                };
            }

            match self.nfs_heat_provider.read_nfs_heat_speed(
                process_id,
                &target.process_name,
                &settings.nfs_heat,
            ) {
                SpeedReadResult::Speed(speed_kph) => {
                    self.last_speed_kph = Some(speed_kph);
                    self.last_speed_at_unix_ms = unix_time_ms();

                    let effects = compute_nfs_heat_trigger_effects(&settings.nfs_heat, speed_kph);
                    GameMonitorSnapshot {
                        status: GameTelemetryStatus {
                            enabled: settings.enabled,
                            input_source: settings.input_source,
                            selected_game: settings.selected_game,
                            stage: GameTelemetryStage::Attached,
                            process_id: Some(process_id),
                            speed_kph: Some(speed_kph),
                            last_speed_at_unix_ms: self.last_speed_at_unix_ms,
                            message: format!(
                                "Live OCR telemetry attached to `{}`. Current speed: {speed_kph} km/h.",
                                target.process_name
                            ),
                        },
                        effects: Some(effects),
                    }
                }
                SpeedReadResult::Unavailable(message) => GameMonitorSnapshot {
                    status: GameTelemetryStatus {
                        enabled: settings.enabled,
                        input_source: settings.input_source,
                        selected_game: settings.selected_game,
                        stage: GameTelemetryStage::TelemetryUnavailable,
                        process_id: Some(process_id),
                        speed_kph: self.last_speed_kph,
                        last_speed_at_unix_ms: self.last_speed_at_unix_ms,
                        message,
                    },
                    effects: None,
                },
                SpeedReadResult::Stale(message) => GameMonitorSnapshot {
                    status: GameTelemetryStatus {
                        enabled: settings.enabled,
                        input_source: settings.input_source,
                        selected_game: settings.selected_game,
                        stage: GameTelemetryStage::TelemetryStale,
                        process_id: Some(process_id),
                        speed_kph: self.last_speed_kph,
                        last_speed_at_unix_ms: self.last_speed_at_unix_ms,
                        message,
                    },
                    effects: None,
                },
                SpeedReadResult::Error(message) => {
                    self.last_speed_kph = None;
                    GameMonitorSnapshot {
                        status: GameTelemetryStatus {
                            enabled: settings.enabled,
                            input_source: settings.input_source,
                            selected_game: settings.selected_game,
                            stage: GameTelemetryStage::Error,
                            process_id: Some(process_id),
                            speed_kph: None,
                            last_speed_at_unix_ms: self.last_speed_at_unix_ms,
                            message,
                        },
                        effects: None,
                    }
                }
            }
        }
    }

    fn reset(&mut self) {
        self.attached_process_id = None;
        self.last_speed_kph = None;
        self.last_speed_at_unix_ms = None;
        self.nfs_heat_provider.reset();
    }
}

pub fn default_runtime_settings() -> AdaptiveTriggerRuntimeSettings {
    AdaptiveTriggerRuntimeSettings {
        enabled: false,
        input_source: AdaptiveTriggerInputSource::Demo,
        selected_game: AdaptiveTriggerGame::NfsHeat,
        nfs_heat: NeedForSpeedHeatAdaptiveTriggerSettings {
            demo_speed_kph: 90,
            min_speed_kph: 0,
            max_speed_kph: 280,
            brake_start_position: 72,
            brake_end_position: 188,
            brake_min_force: 38,
            brake_max_force: 168,
            throttle_start_position: 92,
            throttle_min_force: 18,
            throttle_max_force: 92,
            ocr_calibration: None,
            ocr_process_name: None,
        },
    }
}

pub fn default_game_telemetry_status() -> GameTelemetryStatus {
    disabled_status(
        &default_runtime_settings(),
        "Adaptive trigger live telemetry is disabled.",
    )
}

pub fn list_live_ocr_processes() -> Result<Vec<ActiveProcessOption>, String> {
    #[cfg(not(windows))]
    {
        Err("Live OCR process listing is only available on Windows.".to_string())
    }

    #[cfg(windows)]
    {
        let mut deduped: HashMap<String, VisibleWindowProcess> = HashMap::new();
        for process in collect_visible_window_processes()? {
            let key = process.process_name.to_ascii_lowercase();
            let replace = deduped
                .get(&key)
                .map(|existing| {
                    process.rect.width.saturating_mul(process.rect.height)
                        > existing.rect.width.saturating_mul(existing.rect.height)
                })
                .unwrap_or(true);
            if replace {
                deduped.insert(key, process);
            }
        }

        let mut options = deduped
            .into_values()
            .map(|process| ActiveProcessOption {
                process_id: process.process_id,
                process_name: process.process_name,
                window_title: process.window_title,
                likely_racing: process.likely_racing,
            })
            .collect::<Vec<_>>();
        options.sort_by(|left, right| {
            right.likely_racing.cmp(&left.likely_racing).then_with(|| {
                left.process_name
                    .to_lowercase()
                    .cmp(&right.process_name.to_lowercase())
            })
        });
        Ok(options)
    }
}

pub fn capture_live_ocr_preview(
    settings: &AdaptiveTriggerRuntimeSettings,
) -> Result<OcrCalibrationPreview, String> {
    #[cfg(not(windows))]
    {
        let _ = settings;
        Err("OCR preview capture is only available on Windows.".to_string())
    }

    #[cfg(windows)]
    {
        let target = resolve_live_ocr_process_target(settings).ok_or_else(|| {
            if let Some(process_name) = settings.nfs_heat.ocr_process_name.as_ref() {
                format!(
                    "No supported racing game was detected, and the selected process `{process_name}` is not currently active."
                )
            } else {
                "No supported racing game was detected. Select an active process to monitor, or start a racing game first."
                    .to_string()
            }
        })?;
        let window_rect = find_process_window_rect(target.process_id).ok_or_else(|| {
            format!(
                "The selected OCR target `{}` was detected, but WinSense could not locate its window.",
                target.process_name
            )
        })?;
        let screenshot = capture_window_rect(window_rect)?;
        let png_bytes = encode_image_to_png_bytes(&screenshot)?;

        Ok(OcrCalibrationPreview {
            image_data_url: format!(
                "data:image/png;base64,{}",
                BASE64_STANDARD.encode(png_bytes)
            ),
            width: screenshot.width(),
            height: screenshot.height(),
        })
    }
}

pub fn compute_nfs_heat_trigger_effects(
    settings: &NeedForSpeedHeatAdaptiveTriggerSettings,
    speed_kph: u32,
) -> (TriggerEffectConfig, TriggerEffectConfig) {
    let min_speed = clamp_speed_kph(settings.min_speed_kph);
    let max_speed = std::cmp::max(min_speed + 1, clamp_speed_kph(settings.max_speed_kph));
    let clamped_speed = speed_kph.clamp(min_speed, max_speed);
    let normalized_speed = (clamped_speed - min_speed) as f32 / (max_speed - min_speed) as f32;
    let brake_response = smoothstep(normalized_speed);
    let throttle_response = smoothstep(normalized_speed.powf(1.25));
    let left_force = lerp_u8(
        settings.brake_min_force,
        settings.brake_max_force,
        brake_response,
    );
    let right_force = lerp_u8(
        settings.throttle_min_force,
        settings.throttle_max_force,
        throttle_response,
    );

    (
        TriggerEffectConfig {
            kind: TriggerEffectKind::SectionResistance,
            start_position: Some(settings.brake_start_position),
            end_position: Some(settings.brake_end_position),
            force: Some(left_force),
            frequency: Some(30),
            raw_mode: Some(0),
            raw_params: Some(vec![0; 10]),
        },
        TriggerEffectConfig {
            kind: TriggerEffectKind::ContinuousResistance,
            start_position: Some(settings.throttle_start_position),
            end_position: Some(180),
            force: Some(right_force),
            frequency: Some(30),
            raw_mode: Some(0),
            raw_params: Some(vec![0; 10]),
        },
    )
}

fn disabled_status(
    settings: &AdaptiveTriggerRuntimeSettings,
    message: &str,
) -> GameTelemetryStatus {
    GameTelemetryStatus {
        enabled: settings.enabled,
        input_source: settings.input_source,
        selected_game: settings.selected_game,
        stage: GameTelemetryStage::Disabled,
        process_id: None,
        speed_kph: None,
        last_speed_at_unix_ms: None,
        message: message.to_string(),
    }
}

fn clamp_speed_kph(value: u32) -> u32 {
    value.min(MAX_DISCOVERY_SPEED_KPH)
}

fn lerp_u8(min: u8, max: u8, amount: f32) -> u8 {
    let value = min as f32 + (max as f32 - min as f32) * amount.clamp(0.0, 1.0);
    value.round().clamp(0.0, 255.0) as u8
}

fn smoothstep(value: f32) -> f32 {
    let t = value.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn unix_time_ms() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowRect {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

#[cfg(windows)]
impl WindowRect {
    fn center(self) -> (i32, i32) {
        (
            self.left + (self.width as i32 / 2),
            self.top + (self.height as i32 / 2),
        )
    }
}

#[cfg(windows)]
#[derive(Clone, Debug)]
struct VisibleWindowProcess {
    process_id: u32,
    process_name: String,
    window_title: String,
    rect: WindowRect,
    likely_racing: bool,
}

#[cfg(windows)]
#[derive(Clone, Debug)]
struct ResolvedOcrProcessTarget {
    process_id: u32,
    process_name: String,
    auto_detected: bool,
}

#[cfg(windows)]
fn waiting_for_live_process_message(settings: &AdaptiveTriggerRuntimeSettings) -> String {
    if let Some(process_name) = settings.nfs_heat.ocr_process_name.as_ref() {
        format!(
            "Waiting for a supported racing game to appear, or for the selected process `{process_name}` to become active."
        )
    } else {
        "Waiting for a supported racing game to start. If auto-detect misses your game, pick an active process for OCR monitoring."
            .to_string()
    }
}

#[cfg(windows)]
fn is_likely_racing_process(process_name: &str, window_title: &str) -> bool {
    let process_name = process_name.to_ascii_lowercase();
    let window_title = window_title.to_ascii_lowercase();

    KNOWN_RACING_PROCESS_NAMES
        .iter()
        .any(|name| process_name.eq_ignore_ascii_case(name))
        || RACING_PROCESS_KEYWORDS
            .iter()
            .any(|keyword| process_name.contains(keyword) || window_title.contains(keyword))
}

#[cfg(windows)]
fn process_match_score(process_name: &str, window_title: &str) -> usize {
    let exact_match_score = KNOWN_RACING_PROCESS_NAMES
        .iter()
        .filter(|name| process_name.eq_ignore_ascii_case(name))
        .count()
        * 10;
    let keyword_score = RACING_PROCESS_KEYWORDS
        .iter()
        .filter(|keyword| {
            process_name.to_ascii_lowercase().contains(**keyword)
                || window_title.to_ascii_lowercase().contains(**keyword)
        })
        .count();
    exact_match_score + keyword_score
}

#[cfg(windows)]
fn resolve_live_ocr_process_target(
    settings: &AdaptiveTriggerRuntimeSettings,
) -> Option<ResolvedOcrProcessTarget> {
    let processes = collect_visible_window_processes().ok()?;

    let auto_detected = processes
        .iter()
        .filter(|process| process.likely_racing)
        .max_by_key(|process| {
            (
                process_match_score(&process.process_name, &process.window_title),
                process.rect.width.saturating_mul(process.rect.height),
            )
        });
    if let Some(process) = auto_detected {
        return Some(ResolvedOcrProcessTarget {
            process_id: process.process_id,
            process_name: process.process_name.clone(),
            auto_detected: true,
        });
    }

    let selected_process_name = settings.nfs_heat.ocr_process_name.as_ref()?;
    processes
        .iter()
        .filter(|process| {
            process
                .process_name
                .eq_ignore_ascii_case(selected_process_name)
        })
        .max_by_key(|process| process.rect.width.saturating_mul(process.rect.height))
        .map(|process| ResolvedOcrProcessTarget {
            process_id: process.process_id,
            process_name: process.process_name.clone(),
            auto_detected: false,
        })
}

#[cfg(windows)]
fn capture_calibrated_nfs_heat_region(
    process_id: u32,
    calibration: &OcrCalibrationRegion,
) -> Result<DynamicImage, String> {
    let window_rect = find_process_window_rect(process_id).ok_or_else(|| {
        "The OCR target was detected, but WinSense could not locate the game window.".to_string()
    })?;
    let capture_rect = scale_ocr_capture_rect(window_rect, calibration)?;
    let screenshot = capture_window_rect(capture_rect)?;
    Ok(DynamicImage::ImageRgba8(screenshot))
}

#[cfg(windows)]
fn scale_ocr_capture_rect(
    window_rect: WindowRect,
    calibration: &OcrCalibrationRegion,
) -> Result<WindowRect, String> {
    let reference_width = calibration.reference_width.max(1);
    let reference_height = calibration.reference_height.max(1);

    let x = (u64::from(calibration.x) * u64::from(window_rect.width) / u64::from(reference_width))
        as u32;
    let y = (u64::from(calibration.y) * u64::from(window_rect.height) / u64::from(reference_height))
        as u32;
    let width = (u64::from(calibration.width) * u64::from(window_rect.width)
        / u64::from(reference_width))
    .max(1) as u32;
    let height = (u64::from(calibration.height) * u64::from(window_rect.height)
        / u64::from(reference_height))
    .max(1) as u32;

    if x >= window_rect.width || y >= window_rect.height {
        return Err(
            "The saved OCR calibration no longer fits inside the current game window. Recalibrate the speedometer region."
                .to_string(),
        );
    }

    Ok(WindowRect {
        left: window_rect.left + x as i32,
        top: window_rect.top + y as i32,
        width: width.min(window_rect.width - x),
        height: height.min(window_rect.height - y),
    })
}

#[cfg(windows)]
fn capture_window_rect(rect: WindowRect) -> Result<RgbaImage, String> {
    let (center_x, center_y) = rect.center();
    let screen = Screen::from_point(center_x, center_y).map_err(|error| {
        format!("Failed to locate the monitor containing the OCR target window: {error}")
    })?;
    let screenshot = screen
        .capture_area(rect.left, rect.top, rect.width.max(1), rect.height.max(1))
        .map_err(|error| format!("Failed to capture the OCR HUD region: {error}"))?;
    RgbaImage::from_raw(
        screenshot.width(),
        screenshot.height(),
        screenshot.into_raw(),
    )
    .ok_or_else(|| {
        "Failed to convert the captured HUD region into an OCR image buffer.".to_string()
    })
}

#[cfg(windows)]
fn encode_image_to_png_bytes(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let dynamic = DynamicImage::ImageRgba8(image.clone());
    let mut bytes = Vec::new();
    dynamic
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|error| format!("Failed to encode OCR calibration preview: {error}"))?;
    Ok(bytes)
}

#[cfg(windows)]
fn preprocess_ocr_image(image: &DynamicImage) -> DynamicImage {
    let gray = image.grayscale().to_luma8();
    let (width, height) = gray.dimensions();
    let upscaled = imageops::resize(
        &gray,
        width.saturating_mul(OCR_UPSCALE_FACTOR).max(1),
        height.saturating_mul(OCR_UPSCALE_FACTOR).max(1),
        imageops::FilterType::Nearest,
    );
    let thresholded = image::ImageBuffer::from_fn(upscaled.width(), upscaled.height(), |x, y| {
        let value = upscaled.get_pixel(x, y).0[0];
        let normalized = if value >= OCR_DEFAULT_THRESHOLD {
            255
        } else {
            0
        };
        image::Luma([normalized])
    });
    DynamicImage::ImageLuma8(thresholded)
        .brighten(8)
        .adjust_contrast(35.0)
}

#[cfg(windows)]
fn extract_ocr_speed_candidates(image: &DynamicImage) -> Vec<u32> {
    let mut candidates = Vec::new();
    let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
        Ok(engine) => engine,
        Err(_) => return candidates,
    };

    let variants = [image.clone(), preprocess_ocr_image(image)];
    for variant in variants {
        let bitmap = match image_to_software_bitmap(&variant) {
            Ok(bitmap) => bitmap,
            Err(_) => continue,
        };
        let result = match engine.RecognizeAsync(&bitmap) {
            Ok(operation) => match operation.get() {
                Ok(result) => result,
                Err(_) => continue,
            },
            Err(_) => continue,
        };

        let lines = match result.Lines() {
            Ok(lines) => lines,
            Err(_) => continue,
        };
        let line_count = match lines.Size() {
            Ok(size) => size,
            Err(_) => continue,
        };

        for index in 0..line_count {
            let Ok(line) = lines.GetAt(index) else {
                continue;
            };
            if let Ok(text) = line.Text() {
                extend_speed_candidates_from_text(&mut candidates, &text.to_string_lossy());
            }

            let Ok(words) = line.Words() else {
                continue;
            };
            let Ok(word_count) = words.Size() else {
                continue;
            };
            for word_index in 0..word_count {
                let Ok(word) = words.GetAt(word_index) else {
                    continue;
                };
                if let Ok(text) = word.Text() {
                    extend_speed_candidates_from_text(&mut candidates, &text.to_string_lossy());
                }
            }
        }
    }

    candidates.sort_unstable();
    candidates.dedup();
    candidates
}

#[cfg(windows)]
fn image_to_software_bitmap(image: &DynamicImage) -> Result<SoftwareBitmap, String> {
    let rgba = image.to_rgba8();
    let width = i32::try_from(rgba.width())
        .map_err(|_| "OCR image width overflowed the Windows bitmap API.".to_string())?;
    let height = i32::try_from(rgba.height())
        .map_err(|_| "OCR image height overflowed the Windows bitmap API.".to_string())?;
    let bitmap = SoftwareBitmap::Create(BitmapPixelFormat::Rgba8, width, height)
        .map_err(|error| format!("Failed to create a Windows OCR bitmap: {error}"))?;

    let buffer = bitmap
        .LockBuffer(BitmapBufferAccessMode::Write)
        .map_err(|error| format!("Failed to lock the Windows OCR bitmap: {error}"))?;
    let reference = buffer
        .CreateReference()
        .map_err(|error| format!("Failed to create a Windows OCR bitmap reference: {error}"))?;
    let byte_access: IMemoryBufferByteAccess = reference
        .cast()
        .map_err(|error| format!("Failed to access Windows OCR bitmap bytes: {error}"))?;

    let mut data = std::ptr::null_mut();
    let mut capacity = 0u32;
    unsafe {
        byte_access
            .GetBuffer(&mut data, &mut capacity)
            .map_err(|error| format!("Failed to map Windows OCR bitmap bytes: {error}"))?;
        let target = std::slice::from_raw_parts_mut(data, capacity as usize);
        let source = rgba.as_raw();
        if target.len() < source.len() {
            return Err("The Windows OCR bitmap buffer was smaller than expected.".to_string());
        }
        target[..source.len()].copy_from_slice(source);
    }

    Ok(bitmap)
}

fn extend_speed_candidates_from_text(candidates: &mut Vec<u32>, text: &str) {
    let digits_only: String = text.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits_only.is_empty() {
        return;
    }

    if let Ok(speed) = digits_only.parse::<u32>() {
        if speed <= MAX_DISCOVERY_SPEED_KPH {
            candidates.push(speed);
        }
    }
}

fn choose_ocr_speed_candidate(candidates: &[u32], previous_speed: Option<u32>) -> Option<u32> {
    if candidates.is_empty() {
        return None;
    }

    if let Some(previous_speed) = previous_speed {
        return candidates
            .iter()
            .copied()
            .filter(|candidate| candidate.abs_diff(previous_speed) <= MAX_JUMP_KPH_PER_SAMPLE)
            .min_by_key(|candidate| candidate.abs_diff(previous_speed))
            .or_else(|| candidates.first().copied());
    }

    candidates.first().copied()
}

fn candidate_search_windows(gear_addresses: GearAddresses, radius: usize) -> Vec<(usize, usize)> {
    let mut windows = Vec::new();
    for address in [gear_addresses.current, gear_addresses.last] {
        let start = address.saturating_sub(radius);
        let size = radius.saturating_mul(2);
        windows.push((start, size));
    }
    windows
}

fn collect_candidates_from_buffer(base_address: usize, buffer: &[u8]) -> Vec<SpeedCandidate> {
    let mut candidates = Vec::new();
    if buffer.len() < 4 {
        return candidates;
    }

    for offset in (0..=buffer.len() - 4).step_by(4) {
        let address = base_address + offset;
        let bytes = [
            buffer[offset],
            buffer[offset + 1],
            buffer[offset + 2],
            buffer[offset + 3],
        ];

        if let Some(speed_kph) = decode_candidate_speed(bytes, SpeedValueKind::F32, false) {
            candidates.push(SpeedCandidate {
                address,
                kind: SpeedValueKind::F32,
                last_speed_kph: Some(speed_kph),
                score: 1,
                sample_count: 1,
                change_count: 0,
                stagnant_reads: 0,
            });
        }

        if let Some(speed_kph) = decode_candidate_speed(bytes, SpeedValueKind::U32, false) {
            candidates.push(SpeedCandidate {
                address,
                kind: SpeedValueKind::U32,
                last_speed_kph: Some(speed_kph),
                score: 1,
                sample_count: 1,
                change_count: 0,
                stagnant_reads: 0,
            });
        }
    }

    candidates
}

fn read_candidate_speed(#[cfg(windows)] handle: HANDLE, candidate: &SpeedCandidate) -> Option<u32> {
    #[cfg(not(windows))]
    {
        let _ = candidate;
        None
    }

    #[cfg(windows)]
    {
        let buffer = read_process_bytes(handle, candidate.address, 4)?;
        let bytes = [buffer[0], buffer[1], buffer[2], buffer[3]];
        decode_candidate_speed(bytes, candidate.kind, true)
    }
}

fn decode_candidate_speed(bytes: [u8; 4], kind: SpeedValueKind, allow_zero: bool) -> Option<u32> {
    match kind {
        SpeedValueKind::U32 => {
            let value = u32::from_le_bytes(bytes);
            if is_plausible_speed_value(value, allow_zero) {
                Some(value)
            } else {
                None
            }
        }
        SpeedValueKind::F32 => {
            let value = f32::from_le_bytes(bytes);
            if !value.is_finite() {
                return None;
            }

            let rounded = value.round();
            if (value - rounded).abs() > 0.2 {
                return None;
            }

            let speed = rounded.clamp(0.0, MAX_DISCOVERY_SPEED_KPH as f32) as u32;
            if is_plausible_speed_value(speed, allow_zero) {
                Some(speed)
            } else {
                None
            }
        }
    }
}

fn is_plausible_speed_value(speed_kph: u32, allow_zero: bool) -> bool {
    if allow_zero && speed_kph == 0 {
        return true;
    }

    (MIN_LIVE_DISCOVERY_SPEED_KPH..=MAX_DISCOVERY_SPEED_KPH).contains(&speed_kph)
}

fn observe_candidate(candidate: &mut SpeedCandidate, current_speed_kph: u32) {
    candidate.sample_count = candidate.sample_count.saturating_add(1);

    if let Some(previous_speed) = candidate.last_speed_kph {
        let diff = current_speed_kph.abs_diff(previous_speed);
        if diff == 0 {
            candidate.stagnant_reads = candidate.stagnant_reads.saturating_add(1);
            if candidate.stagnant_reads >= 3 {
                candidate.score -= 1;
            }
        } else {
            candidate.change_count = candidate.change_count.saturating_add(1);
            candidate.stagnant_reads = 0;
            if diff <= 20 {
                candidate.score += 4;
            } else if diff <= 60 {
                candidate.score += 3;
            } else if diff <= MAX_JUMP_KPH_PER_SAMPLE {
                candidate.score += 1;
            } else {
                candidate.score -= 5;
            }

            if current_speed_kph > previous_speed && current_speed_kph >= 10 {
                candidate.score += 1;
            }
        }
    }

    candidate.last_speed_kph = Some(current_speed_kph);
}

fn should_lock_candidate(candidate: &SpeedCandidate) -> bool {
    candidate.sample_count >= 3 && candidate.change_count >= 2 && candidate.score >= 8
}

fn is_plausible_runtime_jump(previous_speed: u32, current_speed: u32) -> bool {
    previous_speed.abs_diff(current_speed) <= MAX_JUMP_KPH_PER_SAMPLE
}

#[cfg(windows)]
fn close_process_handle(handle: &mut Option<HANDLE>) {
    if let Some(current_handle) = handle.take() {
        let _ = unsafe { CloseHandle(current_handle) };
    }
}

#[cfg(windows)]
struct VisibleWindowCollectionContext {
    process_names: HashMap<u32, String>,
    entries: Vec<VisibleWindowProcess>,
}

#[cfg(windows)]
fn collect_visible_window_processes() -> Result<Vec<VisibleWindowProcess>, String> {
    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam.0 as *mut VisibleWindowCollectionContext);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        }
        let Some(process_name) = context.process_names.get(&process_id).cloned() else {
            return BOOL(1);
        };

        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
            return BOOL(1);
        }
        let width = rect.right.saturating_sub(rect.left) as u32;
        let height = rect.bottom.saturating_sub(rect.top) as u32;
        if width < 320 || height < 200 {
            return BOOL(1);
        }

        let window_title = get_window_title(hwnd).unwrap_or_default();
        context.entries.push(VisibleWindowProcess {
            process_id,
            likely_racing: is_likely_racing_process(&process_name, &window_title),
            process_name,
            window_title,
            rect: WindowRect {
                left: rect.left,
                top: rect.top,
                width,
                height,
            },
        });
        BOOL(1)
    }

    let mut context = VisibleWindowCollectionContext {
        process_names: snapshot_process_names()?,
        entries: Vec::new(),
    };
    unsafe {
        EnumWindows(
            Some(callback),
            LPARAM((&mut context as *mut VisibleWindowCollectionContext) as isize),
        )
        .map_err(|error| {
            format!("Failed to enumerate visible windows for OCR monitoring: {error}")
        })?;
    }

    context.entries.sort_by(|left, right| {
        right
            .likely_racing
            .cmp(&left.likely_racing)
            .then_with(|| {
                left.process_name
                    .to_lowercase()
                    .cmp(&right.process_name.to_lowercase())
            })
            .then_with(|| {
                left.window_title
                    .to_lowercase()
                    .cmp(&right.window_title.to_lowercase())
            })
    });
    Ok(context.entries)
}

#[cfg(windows)]
fn snapshot_process_names() -> Result<HashMap<u32, String>, String> {
    let snapshot: HANDLE =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(|error| {
            format!("Failed to create a process snapshot for OCR monitoring: {error}")
        })?;
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("Failed to create a valid process snapshot for OCR monitoring.".to_string());
    }

    let mut process_names = HashMap::new();
    let mut entry = PROCESSENTRY32W::default();
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry).is_ok() };
    while has_entry {
        process_names.insert(entry.th32ProcessID, wide_c_str_to_string(&entry.szExeFile));
        has_entry = unsafe { Process32NextW(snapshot, &mut entry).is_ok() };
    }

    let _ = unsafe { CloseHandle(snapshot) };
    Ok(process_names)
}

#[cfg(windows)]
fn get_window_title(hwnd: HWND) -> Option<String> {
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return None;
    }

    let mut buffer = vec![0u16; len as usize + 1];
    let read = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if read <= 0 {
        return None;
    }

    Some(String::from_utf16_lossy(&buffer[..read as usize]))
}

#[cfg(windows)]
struct WindowSearchContext {
    process_id: u32,
    best_rect: Option<WindowRect>,
}

#[cfg(windows)]
fn find_process_window_rect(process_id: u32) -> Option<WindowRect> {
    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam.0 as *mut WindowSearchContext);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut window_process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut window_process_id));
        }
        if window_process_id != context.process_id {
            return BOOL(1);
        }

        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
            return BOOL(1);
        }

        let width = rect.right.saturating_sub(rect.left) as u32;
        let height = rect.bottom.saturating_sub(rect.top) as u32;
        if width < 320 || height < 200 {
            return BOOL(1);
        }

        let candidate = WindowRect {
            left: rect.left,
            top: rect.top,
            width,
            height,
        };
        let replace = context
            .best_rect
            .map(|current| {
                width.saturating_mul(height) > current.width.saturating_mul(current.height)
            })
            .unwrap_or(true);
        if replace {
            context.best_rect = Some(candidate);
        }

        BOOL(1)
    }

    let mut context = WindowSearchContext {
        process_id,
        best_rect: None,
    };
    unsafe {
        let _ = EnumWindows(
            Some(callback),
            LPARAM((&mut context as *mut WindowSearchContext) as isize),
        );
    }
    context.best_rect
}

#[cfg(windows)]
fn read_process_bytes(handle: HANDLE, address: usize, size: usize) -> Option<Vec<u8>> {
    if size == 0 {
        return None;
    }

    let mut buffer = vec![0u8; size];
    let mut bytes_read = 0usize;
    let read_result = unsafe {
        ReadProcessMemory(
            handle,
            address as *const c_void,
            buffer.as_mut_ptr() as *mut c_void,
            size,
            Some(&mut bytes_read as *mut usize),
        )
    };
    if read_result.is_err() || bytes_read < size {
        return None;
    }

    Some(buffer)
}

#[cfg(windows)]
fn find_gear_addresses(handle: HANDLE) -> Option<GearAddresses> {
    let current_artifact = find_pattern_in_process(
        handle,
        &CURRENT_GEAR_PATTERN,
        Some(HEAT_CURRENT_GEAR_ARTIFACT_NIBBLE),
    )?;
    let last_artifact = find_pattern_in_process(handle, &LAST_GEAR_PATTERN, None)?;

    let current_address = current_artifact + HEAT_CURRENT_GEAR_ARTIFACT_OFFSET;
    let last_address = last_artifact + HEAT_LAST_GEAR_ARTIFACT_OFFSET;
    let current_gear = read_u32(handle, current_address)?;
    let last_gear = read_u32(handle, last_address)?;
    if current_gear > 8 || last_gear > 8 {
        return None;
    }

    Some(GearAddresses {
        current: current_address,
        last: last_address,
    })
}

#[cfg(windows)]
fn find_pattern_in_process(
    handle: HANDLE,
    pattern: &[u8],
    required_nibble: Option<usize>,
) -> Option<usize> {
    let mut address = 0x10000usize;
    let high_limit = 0x2FFFFFFFFusize;
    while address < high_limit {
        let mut memory_info = MEMORY_BASIC_INFORMATION::default();
        let query_size = unsafe {
            VirtualQueryEx(
                handle,
                Some(address as *const c_void),
                &mut memory_info,
                std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        if query_size == 0 {
            address = address.saturating_add(0x1000);
            continue;
        }

        let region_base = memory_info.BaseAddress as usize;
        let region_size = memory_info.RegionSize;
        if is_region_readable(&memory_info) {
            if let Some(found) =
                find_pattern_in_region(handle, region_base, region_size, pattern, required_nibble)
            {
                return Some(found);
            }
        }

        address = region_base.saturating_add(region_size);
    }

    None
}

#[cfg(windows)]
fn find_pattern_in_region(
    handle: HANDLE,
    region_base: usize,
    region_size: usize,
    pattern: &[u8],
    required_nibble: Option<usize>,
) -> Option<usize> {
    let chunk_size = 0x4000usize;
    let overlap = pattern.len().saturating_sub(1);
    let mut offset = 0usize;
    let mut carry = Vec::new();

    while offset < region_size {
        let read_size = std::cmp::min(chunk_size, region_size - offset);
        let chunk_base = region_base + offset;
        let chunk = read_process_bytes(handle, chunk_base, read_size)?;
        let mut search_buffer = carry.clone();
        search_buffer.extend_from_slice(&chunk);
        let search_base = chunk_base.saturating_sub(carry.len());

        if let Some(found_offset) = search_buffer
            .windows(pattern.len())
            .position(|window| window == pattern)
        {
            let found_address = search_base + found_offset;
            if required_nibble
                .map(|nibble| (found_address & 0xF) == nibble)
                .unwrap_or(true)
            {
                return Some(found_address);
            }
        }

        carry = search_buffer
            .get(search_buffer.len().saturating_sub(overlap)..)
            .unwrap_or(&[])
            .to_vec();
        offset += read_size;
    }

    None
}

#[cfg(windows)]
fn is_region_readable(memory_info: &MEMORY_BASIC_INFORMATION) -> bool {
    if memory_info.State.0 != MEM_COMMIT.0 {
        return false;
    }

    let protection = memory_info.Protect.0;
    if protection & PAGE_GUARD.0 != 0 || protection & PAGE_NOACCESS.0 != 0 {
        return false;
    }

    let base_protection = protection & 0xFF;
    matches!(
        base_protection,
        value if value == PAGE_READONLY.0
            || value == PAGE_READWRITE.0
            || value == PAGE_WRITECOPY.0
            || value == PAGE_EXECUTE_READ.0
            || value == PAGE_EXECUTE_READWRITE.0
            || value == PAGE_EXECUTE_WRITECOPY.0
    )
}

#[cfg(windows)]
fn read_u32(handle: HANDLE, address: usize) -> Option<u32> {
    let bytes = read_process_bytes(handle, address, 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[cfg(windows)]
fn wide_c_str_to_string(value: &[u16]) -> String {
    let len = value.iter().position(|ch| *ch == 0).unwrap_or(value.len());
    String::from_utf16_lossy(&value[..len])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_demo_mode() {
        let settings = default_runtime_settings();
        assert!(!settings.enabled);
        assert_eq!(settings.input_source, AdaptiveTriggerInputSource::Demo);
        assert_eq!(settings.selected_game, AdaptiveTriggerGame::NfsHeat);
    }

    #[test]
    fn scales_effect_force_with_speed() {
        let settings = default_runtime_settings().nfs_heat;
        let (slow_left, slow_right) =
            compute_nfs_heat_trigger_effects(&settings, settings.min_speed_kph);
        let (fast_left, fast_right) =
            compute_nfs_heat_trigger_effects(&settings, settings.max_speed_kph);

        assert_eq!(slow_left.force, Some(settings.brake_min_force));
        assert_eq!(fast_left.force, Some(settings.brake_max_force));
        assert_eq!(slow_right.force, Some(settings.throttle_min_force));
        assert_eq!(fast_right.force, Some(settings.throttle_max_force));
    }

    #[test]
    fn live_mode_uses_a_non_disabled_stage() {
        let mut runtime = GameMonitorRuntime::new();
        let settings = AdaptiveTriggerRuntimeSettings {
            enabled: true,
            input_source: AdaptiveTriggerInputSource::Live,
            ..default_runtime_settings()
        };

        let snapshot = runtime.poll(&settings);

        assert_ne!(snapshot.status.stage, GameTelemetryStage::Disabled);
    }

    #[test]
    fn candidate_is_promoted_after_consistent_live_changes() {
        let mut candidate = SpeedCandidate {
            address: 0x1234,
            kind: SpeedValueKind::U32,
            last_speed_kph: Some(25),
            score: 1,
            sample_count: 1,
            change_count: 0,
            stagnant_reads: 0,
        };

        observe_candidate(&mut candidate, 40);
        observe_candidate(&mut candidate, 58);

        assert!(should_lock_candidate(&candidate));
    }

    #[test]
    fn implausible_large_runtime_jump_is_rejected() {
        assert!(is_plausible_runtime_jump(80, 200));
        assert!(!is_plausible_runtime_jump(10, 360));
    }

    #[test]
    fn float_candidate_requires_near_integer_speed() {
        let valid = decode_candidate_speed(32.0f32.to_le_bytes(), SpeedValueKind::F32, false);
        let invalid = decode_candidate_speed(32.72f32.to_le_bytes(), SpeedValueKind::F32, false);

        assert_eq!(valid, Some(32));
        assert_eq!(invalid, None);
    }

    #[test]
    fn provider_reset_clears_cached_discovery_state() {
        let mut provider = ProcessMemorySpeedProvider::new();
        provider.attached_process_id = Some(42);
        provider.gear_addresses = Some(GearAddresses {
            current: 0x1000,
            last: 0x2000,
        });
        provider.speed_candidates = vec![SpeedCandidate {
            address: 0x3000,
            kind: SpeedValueKind::U32,
            last_speed_kph: Some(90),
            score: 10,
            sample_count: 4,
            change_count: 3,
            stagnant_reads: 0,
        }];
        provider.locked_candidate = provider.speed_candidates.first().cloned();
        provider.discovery_radius = MAX_DISCOVERY_RADIUS;
        provider.invalid_locked_reads = 2;
        provider.candidate_scan_passes = 4;

        provider.reset();

        assert_eq!(provider.attached_process_id, None);
        assert_eq!(provider.gear_addresses, None);
        assert!(provider.speed_candidates.is_empty());
        assert_eq!(provider.locked_candidate, None);
        assert_eq!(provider.discovery_radius, INITIAL_DISCOVERY_RADIUS);
        assert_eq!(provider.invalid_locked_reads, 0);
        assert_eq!(provider.candidate_scan_passes, 0);
    }

    #[test]
    fn extracts_digit_only_speed_candidates_from_ocr_text() {
        let mut candidates = Vec::new();
        extend_speed_candidates_from_text(&mut candidates, "Speed 187 km/h");
        extend_speed_candidates_from_text(&mut candidates, "612");
        extend_speed_candidates_from_text(&mut candidates, "4O");
        extend_speed_candidates_from_text(&mut candidates, "N/A");

        assert_eq!(candidates, vec![187, 612, 4]);
    }

    #[test]
    fn chooses_ocr_candidate_closest_to_previous_speed() {
        let chosen = choose_ocr_speed_candidate(&[22, 108, 114], Some(110));
        assert_eq!(chosen, Some(108));
    }

    #[test]
    fn recognizes_common_racing_process_names() {
        assert!(is_likely_racing_process(
            "ForzaHorizon5.exe",
            "Forza Horizon 5"
        ));
        assert!(is_likely_racing_process("Game.exe", "EA SPORTS WRC"));
        assert!(!is_likely_racing_process(
            "notepad.exe",
            "Untitled - Notepad"
        ));
    }

    #[cfg(windows)]
    #[test]
    fn scales_ocr_region_relative_to_the_game_window() {
        let window_rect = WindowRect {
            left: 100,
            top: 50,
            width: 1600,
            height: 900,
        };
        let calibration = OcrCalibrationRegion {
            x: 1440,
            y: 760,
            width: 220,
            height: 120,
            reference_width: 1920,
            reference_height: 1080,
        };

        let scaled = scale_ocr_capture_rect(window_rect, &calibration).unwrap();

        assert_eq!(scaled.left, 1300);
        assert_eq!(scaled.top, 683);
        assert_eq!(scaled.width, 183);
        assert_eq!(scaled.height, 100);
    }
}
