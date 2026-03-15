use hidapi::{BusType, DeviceInfo, HidApi, HidDevice};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use vigem_client::{
    Client, DS4Report, DualShock4Wired, TargetId, XButtons, XGamepad, Xbox360Wired,
};

mod audio;
mod game_monitor;
mod reports;

pub use game_monitor::{
    capture_live_ocr_preview, default_game_telemetry_status, default_runtime_settings,
    list_live_ocr_processes, ActiveProcessOption, AdaptiveTriggerInputSource,
    AdaptiveTriggerRuntimeSettings, GameTelemetryStage, GameTelemetryStatus, OcrCalibrationPreview,
    OcrCalibrationRegion,
};

#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    VIRTUAL_KEY,
};

const SONY_VID: u16 = 0x054C;
const DUALSENSE_PID: u16 = 0x0CE6;
const DUALSENSE_EDGE_PID: u16 = 0x0DF2;
const DS_INPUT_REPORT_USB: u8 = 0x01;
const DS_INPUT_REPORT_BT: u8 = 0x31;
const DS_OUTPUT_REPORT_USB: u8 = 0x02;
const DS_OUTPUT_REPORT_BT: u8 = 0x31;
const DS_OUTPUT_TAG: u8 = 0x10;
const USB_INPUT_REPORT_LEN: usize = 64;
const BT_INPUT_REPORT_LEN: usize = 78;
const BT_OUTPUT_REPORT_LEN: usize = 78;
const BT_OUTPUT_CRC_SEED: u8 = 0xA2;
const BT_INPUT_CRC_SEED: u8 = 0xA1;
const BT_WRITE_FAILURE_THRESHOLD: u8 = 5;

const TAP_TIMEOUT_MS: u128 = 180;
const TAP_MAX_DISTANCE_SQ: i32 = 900;
const MOVE_DEAD_ZONE_SQ: i32 = 100;
const TOUCHPAD_SCROLL_FACTOR: f64 = 0.65;
const TOUCHPAD_MID_X: i32 = 960;
const INPUT_EVENT_INTERVAL_MS: u128 = 33;
const FIRMWARE_REPORT_SET_TEST: u8 = 0x80;
const FIRMWARE_REPORT_SET_CALIBRATION: u8 = 0x82;
const FIRMWARE_REPORT_GET_CALIBRATION: u8 = 0x83;
const FIRMWARE_NVS_DEVICE_ID: u8 = 3;
const FIRMWARE_NVS_UNLOCK_ACTION: u8 = 2;
const FIRMWARE_NVS_LOCK_ACTION: u8 = 1;
const FIRMWARE_NVS_PASSWORD: [u8; 4] = [101, 50, 64, 12];
const FIRMWARE_CALIBRATION_DEVICE_ID: u8 = 1;
const FIRMWARE_CENTER_TARGET_ID: u8 = 1;
const FIRMWARE_RANGE_TARGET_ID: u8 = 2;
const FIRMWARE_ACTION_START: u8 = 1;
const FIRMWARE_ACTION_STORE: u8 = 2;
const FIRMWARE_ACTION_SAMPLE: u8 = 3;
const DUALSENSE_FEATURE_REPORT_LEN: usize = 64;

const AUDIO_REPORT_BT_EXT_BASE: u8 = 0x32;
const AUDIO_REPORT_BT_EXT_MAX: u8 = 0x39;
const AUDIO_PAYLOAD_STEP: usize = 64;
const AUDIO_PAYLOAD_MAX_PER_REPORT: usize = 512;
const AUDIO_PAYLOAD_OFFSET: usize = 74;
const AUDIO_WRITE_INTERVAL_MS: u128 = 21;
const MAX_HID_REPORT_LEN: usize = BT_OUTPUT_REPORT_LEN + AUDIO_PAYLOAD_MAX_PER_REPORT;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControllerButton {
    Cross,
    Circle,
    Square,
    Triangle,
    L1,
    R1,
    Create,
    Options,
    L3,
    R3,
    Ps,
    Touchpad,
    Mute,
    DpadUp,
    DpadRight,
    DpadDown,
    DpadLeft,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XboxButton {
    A,
    B,
    X,
    Y,
    Up,
    Right,
    Down,
    Left,
    LeftShoulder,
    RightShoulder,
    Back,
    Start,
    LeftThumb,
    RightThumb,
    Guide,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmulationTarget {
    Xbox360,
    XboxOne,
    XboxSeries,
    DualShock4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XboxStick {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XboxTrigger {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayStationButton {
    Cross,
    Circle,
    Square,
    Triangle,
    Up,
    Right,
    Down,
    Left,
    L1,
    R1,
    Share,
    Options,
    L3,
    R3,
    Ps,
    Touchpad,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayStationStick {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayStationTrigger {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyCode {
    A,
    B,
    C,
    D,
    E,
    F,
    G,
    H,
    I,
    J,
    K,
    L,
    M,
    N,
    O,
    P,
    Q,
    R,
    S,
    T,
    U,
    V,
    W,
    X,
    Y,
    Z,
    Digit0,
    Digit1,
    Digit2,
    Digit3,
    Digit4,
    Digit5,
    Digit6,
    Digit7,
    Digit8,
    Digit9,
    Space,
    Enter,
    Escape,
    Tab,
    LeftShift,
    LeftCtrl,
    LeftAlt,
    UpArrow,
    RightArrow,
    DownArrow,
    LeftArrow,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ButtonBindingTarget {
    Disabled,
    XboxButton { button: XboxButton },
    PlayStationButton { button: PlayStationButton },
    KeyboardKey { key: KeyCode },
    MouseButton { button: MouseButton },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StickBinding {
    Disabled,
    XboxStick {
        stick: XboxStick,
    },
    PlayStationStick {
        stick: PlayStationStick,
    },
    Keyboard4 {
        up: KeyCode,
        down: KeyCode,
        left: KeyCode,
        right: KeyCode,
        threshold: f32,
    },
    MouseMove {
        sensitivity: f32,
        deadzone: f32,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TriggerBinding {
    Disabled,
    XboxTrigger { trigger: XboxTrigger },
    PlayStationTrigger { trigger: PlayStationTrigger },
    KeyboardKey { key: KeyCode, threshold: u8 },
    MouseButton { button: MouseButton, threshold: u8 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingProfile {
    pub id: String,
    pub name: String,
    pub built_in: bool,
    pub emulation_target: EmulationTarget,
    pub button_bindings: BTreeMap<ControllerButton, ButtonBindingTarget>,
    pub left_stick: StickBinding,
    pub right_stick: StickBinding,
    pub left_trigger: TriggerBinding,
    pub right_trigger: TriggerBinding,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickCalibration {
    pub center_x: f32,
    pub center_y: f32,
    pub deadzone: f32,
    pub outer_scale: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerCalibration {
    pub deadzone: u8,
    pub max_value: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationProfile {
    pub left_stick: StickCalibration,
    pub right_stick: StickCalibration,
    pub left_trigger: TriggerCalibration,
    pub right_trigger: TriggerCalibration,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StickSnapshot {
    pub raw_x: u8,
    pub raw_y: u8,
    pub normalized_x: f32,
    pub normalized_y: f32,
    pub calibrated_x: f32,
    pub calibrated_y: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TriggerSnapshot {
    pub raw_value: u8,
    pub normalized: f32,
    pub calibrated_value: u8,
    pub calibrated_normalized: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveInputSnapshot {
    pub connected: bool,
    pub left_stick: StickSnapshot,
    pub right_stick: StickSnapshot,
    pub left_trigger: TriggerSnapshot,
    pub right_trigger: TriggerSnapshot,
    pub pressed_buttons: Vec<ControllerButton>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationCapabilities {
    pub firmware_calibration_available: bool,
    pub firmware_calibration_note: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionTransport {
    Unknown,
    Usb,
    Bluetooth,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerEffectKind {
    Off,
    ContinuousResistance,
    SectionResistance,
    Vibration,
    MachineGun,
    Raw,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerEffectConfig {
    pub kind: TriggerEffectKind,
    pub start_position: Option<u8>,
    pub end_position: Option<u8>,
    pub force: Option<u8>,
    pub frequency: Option<u8>,
    pub raw_mode: Option<u8>,
    pub raw_params: Option<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FirmwareCalibrationMode {
    Center,
    Range,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FirmwareCalibrationStep {
    Idle,
    CenterSampling,
    CenterSampled,
    RangeSampling,
    CompletedTemporary,
    CompletedPermanent,
    Cancelled,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareCalibrationStatus {
    pub connected: bool,
    pub transport: ConnectionTransport,
    pub eligible: bool,
    pub busy: bool,
    pub active_mode: Option<FirmwareCalibrationMode>,
    pub step: FirmwareCalibrationStep,
    pub can_sample_center: bool,
    pub can_store_temporarily: bool,
    pub can_store_permanently: bool,
    pub requires_stick_rotation: bool,
    pub last_completed_mode: Option<FirmwareCalibrationMode>,
    pub last_message: String,
    pub last_error: Option<String>,
}

#[derive(Default)]
struct DualSenseInputState {
    pressed_buttons: HashSet<ControllerButton>,
    left_stick_x: u8,
    left_stick_y: u8,
    right_stick_x: u8,
    right_stick_y: u8,
    left_trigger: u8,
    right_trigger: u8,
    touching_0: bool,
    finger0_x: i32,
    finger0_y: i32,
    touching_1: bool,
    finger1_x: i32,
    finger1_y: i32,
}

impl DualSenseInputState {
    fn pressed(&self, button: ControllerButton) -> bool {
        self.pressed_buttons.contains(&button)
    }
}

pub(crate) enum VirtualTarget {
    Xbox {
        emulation_target: EmulationTarget,
        device: Xbox360Wired<Client>,
    },
    DualShock4(DualShock4Wired<Client>),
}

impl VirtualTarget {
    fn matches(&self, target: EmulationTarget) -> bool {
        matches!(
            (self, target),
            (
                VirtualTarget::Xbox {
                    emulation_target: EmulationTarget::Xbox360,
                    ..
                },
                EmulationTarget::Xbox360,
            ) | (
                VirtualTarget::Xbox {
                    emulation_target: EmulationTarget::XboxOne,
                    ..
                },
                EmulationTarget::XboxOne,
            ) | (
                VirtualTarget::Xbox {
                    emulation_target: EmulationTarget::XboxSeries,
                    ..
                },
                EmulationTarget::XboxSeries,
            ) | (VirtualTarget::DualShock4(_), EmulationTarget::DualShock4)
        )
    }
}

pub struct ControllerState {
    pub connected: bool,
    pub output_dirty: bool,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub adaptive_trigger_settings: AdaptiveTriggerRuntimeSettings,
    pub game_telemetry_status: GameTelemetryStatus,
    pub manual_left_trigger: TriggerEffectConfig,
    pub manual_right_trigger: TriggerEffectConfig,
    pub adaptive_left_trigger: TriggerEffectConfig,
    pub adaptive_right_trigger: TriggerEffectConfig,
    pub adaptive_triggers_active: bool,
    pub left_trigger: TriggerEffectConfig,
    pub right_trigger: TriggerEffectConfig,
    pub rumble_left: u8,
    pub rumble_right: u8,
    vigem_bus: Option<Client>,
    vigem_target: Option<VirtualTarget>,
    pub touchpad_enabled: bool,
    pub touchpad_sensitivity: f64,
    pub mapping_profile: MappingProfile,
    pub calibration_profile: CalibrationProfile,
    pub connection_transport: ConnectionTransport,
    pub firmware_status: FirmwareCalibrationStatus,
    pub last_input_snapshot: LiveInputSnapshot,
    pub last_input_emit_at: Option<Instant>,
    pub active_keys: HashSet<KeyCode>,
    pub active_mouse_buttons: HashSet<MouseButton>,
    pub last_touch_x: Option<i32>,
    pub last_touch_y: Option<i32>,
    pub last_touch_active: bool,
    pub last_pad_button: bool,
    pub touch_start_time: Option<Instant>,
    pub touch_start_x: i32,
    pub touch_start_y: i32,
    pub touch_moved: bool,
    pub peak_finger_count: u8,
    pub last_touch_finger_count: u8,
    pub click_held_button: Option<MouseButton>,
    pub last_tap_time: Option<Instant>,
    pub last_tap_button: Option<MouseButton>,
    pub drag_active: bool,
    pub drag_button: Option<MouseButton>,
    pub bt_output_seq: u8,
    pub speaker_volume: u8,
    pub headphone_volume: u8,
    pub mic_volume: u8,
    pub mic_mute: bool,
    pub audio_mute: bool,
    pub mic_mute_led: u8,
    pub force_internal_mic: bool,
    pub force_internal_speaker: bool,
    pub audio_buf: Vec<u8>,
    pub audio_buf_offset: usize,
    pub speaker_test_active: bool,
    pub speaker_test_restore_audio: Option<AudioSettings>,
    pub pending_speaker_restore: bool,
    pub last_audio_write_at: Option<Instant>,
    pub mic_test_active: bool,
    pub mic_test_stop: Option<Arc<AtomicBool>>,
    pub bt_mic_probe_active: bool,
    pub bt_mic_probe_observations: Vec<String>,
}

pub struct AppState {
    pub controller: Arc<Mutex<ControllerState>>,
}

impl AppState {
    pub fn new() -> Self {
        let vigem_bus = Client::connect().ok();
        let mut controller_state = ControllerState {
            connected: false,
            output_dirty: false,
            r: 0,
            g: 0,
            b: 255,
            adaptive_trigger_settings: default_runtime_settings(),
            game_telemetry_status: default_game_telemetry_status(),
            manual_left_trigger: default_trigger_effect(),
            manual_right_trigger: default_trigger_effect(),
            adaptive_left_trigger: default_trigger_effect(),
            adaptive_right_trigger: default_trigger_effect(),
            adaptive_triggers_active: false,
            left_trigger: default_trigger_effect(),
            right_trigger: default_trigger_effect(),
            rumble_left: 0,
            rumble_right: 0,
            vigem_bus,
            vigem_target: None,
            touchpad_enabled: false,
            touchpad_sensitivity: 1.0,
            mapping_profile: default_disabled_profile(),
            calibration_profile: default_calibration_profile(),
            connection_transport: ConnectionTransport::Unknown,
            firmware_status: default_firmware_calibration_status(),
            last_input_snapshot: default_live_input_snapshot(),
            last_input_emit_at: None,
            active_keys: HashSet::new(),
            active_mouse_buttons: HashSet::new(),
            last_touch_x: None,
            last_touch_y: None,
            last_touch_active: false,
            last_pad_button: false,
            touch_start_time: None,
            touch_start_x: 0,
            touch_start_y: 0,
            touch_moved: false,
            peak_finger_count: 0,
            last_touch_finger_count: 0,
            click_held_button: None,
            last_tap_time: None,
            last_tap_button: None,
            drag_active: false,
            drag_button: None,
            bt_output_seq: 0,
            speaker_volume: 70,
            headphone_volume: 80,
            mic_volume: 40,
            mic_mute: false,
            audio_mute: false,
            mic_mute_led: 0,
            force_internal_mic: false,
            force_internal_speaker: false,
            audio_buf: Vec::new(),
            audio_buf_offset: 0,
            speaker_test_active: false,
            speaker_test_restore_audio: None,
            pending_speaker_restore: false,
            last_audio_write_at: None,
            mic_test_active: false,
            mic_test_stop: None,
            bt_mic_probe_active: false,
            bt_mic_probe_observations: Vec::new(),
        };

        let initial_target = controller_state.mapping_profile.emulation_target;
        ensure_virtual_target(&mut controller_state, initial_target);

        Self {
            controller: Arc::new(Mutex::new(controller_state)),
        }
    }
}

fn default_trigger_effect() -> TriggerEffectConfig {
    reports::default_trigger_effect()
}

fn normalize_trigger_effect(effect: &TriggerEffectConfig) -> TriggerEffectConfig {
    reports::normalize_trigger_effect(effect)
}

fn build_output_report(state: &mut ControllerState) -> Vec<u8> {
    reports::build_output_report(state)
}

fn build_bindings(
    pairs: &[(ControllerButton, ButtonBindingTarget)],
) -> BTreeMap<ControllerButton, ButtonBindingTarget> {
    pairs.iter().cloned().collect()
}

fn default_stick_calibration() -> StickCalibration {
    StickCalibration {
        center_x: 0.0,
        center_y: 0.0,
        deadzone: 0.08,
        outer_scale: 1.0,
    }
}

fn default_trigger_calibration() -> TriggerCalibration {
    TriggerCalibration {
        deadzone: 0,
        max_value: 255,
    }
}

fn default_calibration_profile() -> CalibrationProfile {
    CalibrationProfile {
        left_stick: default_stick_calibration(),
        right_stick: default_stick_calibration(),
        left_trigger: default_trigger_calibration(),
        right_trigger: default_trigger_calibration(),
    }
}

fn default_live_input_snapshot() -> LiveInputSnapshot {
    LiveInputSnapshot {
        connected: false,
        ..Default::default()
    }
}

fn default_firmware_calibration_status() -> FirmwareCalibrationStatus {
    FirmwareCalibrationStatus {
        connected: false,
        transport: ConnectionTransport::Unknown,
        eligible: false,
        busy: false,
        active_mode: None,
        step: FirmwareCalibrationStep::Idle,
        can_sample_center: false,
        can_store_temporarily: false,
        can_store_permanently: false,
        requires_stick_rotation: false,
        last_completed_mode: None,
        last_message: "Connect the DualSense over USB to enable firmware calibration.".to_string(),
        last_error: None,
    }
}

fn target_id_for_emulation_target(target: EmulationTarget) -> TargetId {
    match target {
        EmulationTarget::Xbox360 => TargetId::XBOX360_WIRED,
        EmulationTarget::XboxOne => TargetId {
            vendor: 0x045E,
            product: 0x02D1,
        },
        EmulationTarget::XboxSeries => TargetId {
            vendor: 0x045E,
            product: 0x0B13,
        },
        EmulationTarget::DualShock4 => TargetId::DUALSHOCK4_WIRED,
    }
}

fn build_virtual_target(bus: &Client, target: EmulationTarget) -> Option<VirtualTarget> {
    let cloned = bus.try_clone().ok()?;
    match target {
        EmulationTarget::DualShock4 => {
            let mut device = DualShock4Wired::new(cloned, target_id_for_emulation_target(target));
            device.plugin().ok()?;
            let _ = device.wait_ready();
            Some(VirtualTarget::DualShock4(device))
        }
        EmulationTarget::Xbox360 | EmulationTarget::XboxOne | EmulationTarget::XboxSeries => {
            let mut device = Xbox360Wired::new(cloned, target_id_for_emulation_target(target));
            device.plugin().ok()?;
            let _ = device.wait_ready();
            Some(VirtualTarget::Xbox {
                emulation_target: target,
                device,
            })
        }
    }
}

fn ensure_virtual_target(state: &mut ControllerState, target: EmulationTarget) {
    if state
        .vigem_target
        .as_ref()
        .map(|current| current.matches(target))
        .unwrap_or(false)
    {
        return;
    }

    state.vigem_target = None;

    if let Some(bus) = &state.vigem_bus {
        state.vigem_target = build_virtual_target(bus, target);
    }
}

fn base_xbox_profile(id: &str, name: &str, emulation_target: EmulationTarget) -> MappingProfile {
    MappingProfile {
        id: id.to_string(),
        name: name.to_string(),
        built_in: true,
        emulation_target,
        button_bindings: build_bindings(&[
            (
                ControllerButton::Cross,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::A,
                },
            ),
            (
                ControllerButton::Circle,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::B,
                },
            ),
            (
                ControllerButton::Square,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::X,
                },
            ),
            (
                ControllerButton::Triangle,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Y,
                },
            ),
            (
                ControllerButton::L1,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::LeftShoulder,
                },
            ),
            (
                ControllerButton::R1,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::RightShoulder,
                },
            ),
            (
                ControllerButton::Create,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Back,
                },
            ),
            (
                ControllerButton::Options,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Start,
                },
            ),
            (
                ControllerButton::L3,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::LeftThumb,
                },
            ),
            (
                ControllerButton::R3,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::RightThumb,
                },
            ),
            (
                ControllerButton::Ps,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Guide,
                },
            ),
            (ControllerButton::Touchpad, ButtonBindingTarget::Disabled),
            (ControllerButton::Mute, ButtonBindingTarget::Disabled),
            (
                ControllerButton::DpadUp,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Up,
                },
            ),
            (
                ControllerButton::DpadRight,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Right,
                },
            ),
            (
                ControllerButton::DpadDown,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Down,
                },
            ),
            (
                ControllerButton::DpadLeft,
                ButtonBindingTarget::XboxButton {
                    button: XboxButton::Left,
                },
            ),
        ]),
        left_stick: StickBinding::XboxStick {
            stick: XboxStick::Left,
        },
        right_stick: StickBinding::XboxStick {
            stick: XboxStick::Right,
        },
        left_trigger: TriggerBinding::XboxTrigger {
            trigger: XboxTrigger::Left,
        },
        right_trigger: TriggerBinding::XboxTrigger {
            trigger: XboxTrigger::Right,
        },
    }
}

fn default_xbox_profile() -> MappingProfile {
    base_xbox_profile(
        "builtin-xbox360",
        "Xbox 360 Emulation",
        EmulationTarget::Xbox360,
    )
}

fn default_xbox_one_profile() -> MappingProfile {
    base_xbox_profile(
        "builtin-xbox-one",
        "Xbox One Style Emulation",
        EmulationTarget::XboxOne,
    )
}

fn default_xbox_series_profile() -> MappingProfile {
    base_xbox_profile(
        "builtin-xbox-series",
        "Xbox Series Style Emulation",
        EmulationTarget::XboxSeries,
    )
}

fn default_disabled_profile() -> MappingProfile {
    MappingProfile {
        id: "builtin-disabled".to_string(),
        name: "Disabled".to_string(),
        built_in: true,
        emulation_target: EmulationTarget::Xbox360,
        button_bindings: build_bindings(&[
            (ControllerButton::Cross, ButtonBindingTarget::Disabled),
            (ControllerButton::Circle, ButtonBindingTarget::Disabled),
            (ControllerButton::Square, ButtonBindingTarget::Disabled),
            (ControllerButton::Triangle, ButtonBindingTarget::Disabled),
            (ControllerButton::L1, ButtonBindingTarget::Disabled),
            (ControllerButton::R1, ButtonBindingTarget::Disabled),
            (ControllerButton::Create, ButtonBindingTarget::Disabled),
            (ControllerButton::Options, ButtonBindingTarget::Disabled),
            (ControllerButton::L3, ButtonBindingTarget::Disabled),
            (ControllerButton::R3, ButtonBindingTarget::Disabled),
            (ControllerButton::Ps, ButtonBindingTarget::Disabled),
            (ControllerButton::Touchpad, ButtonBindingTarget::Disabled),
            (ControllerButton::Mute, ButtonBindingTarget::Disabled),
            (ControllerButton::DpadUp, ButtonBindingTarget::Disabled),
            (ControllerButton::DpadRight, ButtonBindingTarget::Disabled),
            (ControllerButton::DpadDown, ButtonBindingTarget::Disabled),
            (ControllerButton::DpadLeft, ButtonBindingTarget::Disabled),
        ]),
        left_stick: StickBinding::Disabled,
        right_stick: StickBinding::Disabled,
        left_trigger: TriggerBinding::Disabled,
        right_trigger: TriggerBinding::Disabled,
    }
}

fn default_keyboard_mouse_profile() -> MappingProfile {
    MappingProfile {
        id: "builtin-keyboard-mouse".to_string(),
        name: "Keyboard + Mouse".to_string(),
        built_in: true,
        emulation_target: EmulationTarget::Xbox360,
        button_bindings: build_bindings(&[
            (
                ControllerButton::Cross,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::Space,
                },
            ),
            (
                ControllerButton::Circle,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::LeftCtrl,
                },
            ),
            (
                ControllerButton::Square,
                ButtonBindingTarget::KeyboardKey { key: KeyCode::R },
            ),
            (
                ControllerButton::Triangle,
                ButtonBindingTarget::KeyboardKey { key: KeyCode::E },
            ),
            (
                ControllerButton::L1,
                ButtonBindingTarget::KeyboardKey { key: KeyCode::Q },
            ),
            (
                ControllerButton::R1,
                ButtonBindingTarget::KeyboardKey { key: KeyCode::F },
            ),
            (
                ControllerButton::Create,
                ButtonBindingTarget::KeyboardKey { key: KeyCode::Tab },
            ),
            (
                ControllerButton::Options,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::Escape,
                },
            ),
            (
                ControllerButton::L3,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::LeftShift,
                },
            ),
            (
                ControllerButton::R3,
                ButtonBindingTarget::MouseButton {
                    button: MouseButton::Middle,
                },
            ),
            (
                ControllerButton::Ps,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::Enter,
                },
            ),
            (ControllerButton::Touchpad, ButtonBindingTarget::Disabled),
            (
                ControllerButton::Mute,
                ButtonBindingTarget::KeyboardKey { key: KeyCode::M },
            ),
            (
                ControllerButton::DpadUp,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::Digit1,
                },
            ),
            (
                ControllerButton::DpadRight,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::Digit2,
                },
            ),
            (
                ControllerButton::DpadDown,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::Digit3,
                },
            ),
            (
                ControllerButton::DpadLeft,
                ButtonBindingTarget::KeyboardKey {
                    key: KeyCode::Digit4,
                },
            ),
        ]),
        left_stick: StickBinding::Keyboard4 {
            up: KeyCode::W,
            down: KeyCode::S,
            left: KeyCode::A,
            right: KeyCode::D,
            threshold: 0.35,
        },
        right_stick: StickBinding::MouseMove {
            sensitivity: 18.0,
            deadzone: 0.2,
        },
        left_trigger: TriggerBinding::MouseButton {
            button: MouseButton::Right,
            threshold: 40,
        },
        right_trigger: TriggerBinding::MouseButton {
            button: MouseButton::Left,
            threshold: 40,
        },
    }
}

fn default_dualshock4_profile() -> MappingProfile {
    MappingProfile {
        id: "builtin-dualshock4".to_string(),
        name: "DualShock 4 Emulation".to_string(),
        built_in: true,
        emulation_target: EmulationTarget::DualShock4,
        button_bindings: build_bindings(&[
            (
                ControllerButton::Cross,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Cross,
                },
            ),
            (
                ControllerButton::Circle,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Circle,
                },
            ),
            (
                ControllerButton::Square,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Square,
                },
            ),
            (
                ControllerButton::Triangle,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Triangle,
                },
            ),
            (
                ControllerButton::L1,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::L1,
                },
            ),
            (
                ControllerButton::R1,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::R1,
                },
            ),
            (
                ControllerButton::Create,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Share,
                },
            ),
            (
                ControllerButton::Options,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Options,
                },
            ),
            (
                ControllerButton::L3,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::L3,
                },
            ),
            (
                ControllerButton::R3,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::R3,
                },
            ),
            (
                ControllerButton::Ps,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Ps,
                },
            ),
            (
                ControllerButton::Touchpad,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Touchpad,
                },
            ),
            (ControllerButton::Mute, ButtonBindingTarget::Disabled),
            (
                ControllerButton::DpadUp,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Up,
                },
            ),
            (
                ControllerButton::DpadRight,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Right,
                },
            ),
            (
                ControllerButton::DpadDown,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Down,
                },
            ),
            (
                ControllerButton::DpadLeft,
                ButtonBindingTarget::PlayStationButton {
                    button: PlayStationButton::Left,
                },
            ),
        ]),
        left_stick: StickBinding::PlayStationStick {
            stick: PlayStationStick::Left,
        },
        right_stick: StickBinding::PlayStationStick {
            stick: PlayStationStick::Right,
        },
        left_trigger: TriggerBinding::PlayStationTrigger {
            trigger: PlayStationTrigger::Left,
        },
        right_trigger: TriggerBinding::PlayStationTrigger {
            trigger: PlayStationTrigger::Right,
        },
    }
}

pub fn mapping_presets() -> Vec<MappingProfile> {
    vec![
        default_xbox_profile(),
        default_xbox_one_profile(),
        default_xbox_series_profile(),
        default_dualshock4_profile(),
        default_disabled_profile(),
        default_keyboard_mouse_profile(),
    ]
}

pub fn calibration_capabilities() -> CalibrationCapabilities {
    CalibrationCapabilities {
        firmware_calibration_available: true,
        firmware_calibration_note: "Firmware calibration is available only for a DualSense connected over USB. It follows the community-documented DualSense center/range workflow and should still be treated as an advanced repair step, especially before any permanent write.".to_string(),
    }
}

fn xbox_button_bits(button: XboxButton) -> u16 {
    match button {
        XboxButton::A => XButtons::A,
        XboxButton::B => XButtons::B,
        XboxButton::X => XButtons::X,
        XboxButton::Y => XButtons::Y,
        XboxButton::Up => XButtons::UP,
        XboxButton::Right => XButtons::RIGHT,
        XboxButton::Down => XButtons::DOWN,
        XboxButton::Left => XButtons::LEFT,
        XboxButton::LeftShoulder => XButtons::LB,
        XboxButton::RightShoulder => XButtons::RB,
        XboxButton::Back => XButtons::BACK,
        XboxButton::Start => XButtons::START,
        XboxButton::LeftThumb => XButtons::LTHUMB,
        XboxButton::RightThumb => XButtons::RTHUMB,
        XboxButton::Guide => XButtons::GUIDE,
    }
}

#[cfg(windows)]
fn send_mouse_move(dx: i32, dy: i32) {
    unsafe {
        let mut input = INPUT::default();
        input.r#type = INPUT_MOUSE;
        input.Anonymous.mi = MOUSEINPUT {
            dx,
            dy,
            dwFlags: MOUSEEVENTF_MOVE,
            ..Default::default()
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(windows))]
fn send_mouse_move(_dx: i32, _dy: i32) {}

#[cfg(windows)]
fn send_mouse_scroll(delta: i32) {
    if delta == 0 {
        return;
    }

    unsafe {
        let mut input = INPUT::default();
        input.r#type = INPUT_MOUSE;
        input.Anonymous.mi = MOUSEINPUT {
            mouseData: delta as u32,
            dwFlags: MOUSEEVENTF_WHEEL,
            ..Default::default()
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(windows))]
fn send_mouse_scroll(_delta: i32) {}

#[cfg(windows)]
fn send_mouse_button(button: MouseButton, down: bool) {
    unsafe {
        let mut input = INPUT::default();
        input.r#type = INPUT_MOUSE;
        input.Anonymous.mi = MOUSEINPUT {
            dwFlags: match (button, down) {
                (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
                (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
                (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
                (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
                (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
                (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
            },
            ..Default::default()
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(windows))]
fn send_mouse_button(_button: MouseButton, _down: bool) {}

#[cfg(windows)]
fn key_code_vk(key: KeyCode) -> u16 {
    match key {
        KeyCode::A => 0x41,
        KeyCode::B => 0x42,
        KeyCode::C => 0x43,
        KeyCode::D => 0x44,
        KeyCode::E => 0x45,
        KeyCode::F => 0x46,
        KeyCode::G => 0x47,
        KeyCode::H => 0x48,
        KeyCode::I => 0x49,
        KeyCode::J => 0x4A,
        KeyCode::K => 0x4B,
        KeyCode::L => 0x4C,
        KeyCode::M => 0x4D,
        KeyCode::N => 0x4E,
        KeyCode::O => 0x4F,
        KeyCode::P => 0x50,
        KeyCode::Q => 0x51,
        KeyCode::R => 0x52,
        KeyCode::S => 0x53,
        KeyCode::T => 0x54,
        KeyCode::U => 0x55,
        KeyCode::V => 0x56,
        KeyCode::W => 0x57,
        KeyCode::X => 0x58,
        KeyCode::Y => 0x59,
        KeyCode::Z => 0x5A,
        KeyCode::Digit0 => 0x30,
        KeyCode::Digit1 => 0x31,
        KeyCode::Digit2 => 0x32,
        KeyCode::Digit3 => 0x33,
        KeyCode::Digit4 => 0x34,
        KeyCode::Digit5 => 0x35,
        KeyCode::Digit6 => 0x36,
        KeyCode::Digit7 => 0x37,
        KeyCode::Digit8 => 0x38,
        KeyCode::Digit9 => 0x39,
        KeyCode::Space => 0x20,
        KeyCode::Enter => 0x0D,
        KeyCode::Escape => 0x1B,
        KeyCode::Tab => 0x09,
        KeyCode::LeftShift => 0xA0,
        KeyCode::LeftCtrl => 0xA2,
        KeyCode::LeftAlt => 0xA4,
        KeyCode::UpArrow => 0x26,
        KeyCode::RightArrow => 0x27,
        KeyCode::DownArrow => 0x28,
        KeyCode::LeftArrow => 0x25,
    }
}

#[cfg(windows)]
fn send_key_event(key: KeyCode, down: bool) {
    unsafe {
        let mut input = INPUT::default();
        input.r#type = INPUT_KEYBOARD;
        input.Anonymous.ki = KEYBDINPUT {
            wVk: VIRTUAL_KEY(key_code_vk(key)),
            dwFlags: if down {
                Default::default()
            } else {
                KEYEVENTF_KEYUP
            },
            ..Default::default()
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(windows))]
fn send_key_event(_key: KeyCode, _down: bool) {}

fn parse_touchpad(buf: &[u8], offset_shift: usize) -> (bool, i32, i32, bool, i32, i32) {
    let base = 33 + offset_shift;
    let not_touching_0 = (buf[base] >> 7) & 1 == 1;
    let finger0_x = ((buf[base + 2] as i32 & 0x0F) << 8) | buf[base + 1] as i32;
    let finger0_y = ((buf[base + 3] as i32) << 4) | ((buf[base + 2] as i32 >> 4) & 0x0F);

    let not_touching_1 = (buf[base + 4] >> 7) & 1 == 1;
    let finger1_x = ((buf[base + 6] as i32 & 0x0F) << 8) | buf[base + 5] as i32;
    let finger1_y = ((buf[base + 7] as i32) << 4) | ((buf[base + 6] as i32 >> 4) & 0x0F);

    (
        !not_touching_0,
        finger0_x,
        finger0_y,
        !not_touching_1,
        finger1_x,
        finger1_y,
    )
}

fn parse_dpad(buttons: &mut HashSet<ControllerButton>, dpad: u8) {
    match dpad {
        0 => {
            buttons.insert(ControllerButton::DpadUp);
        }
        1 => {
            buttons.insert(ControllerButton::DpadUp);
            buttons.insert(ControllerButton::DpadRight);
        }
        2 => {
            buttons.insert(ControllerButton::DpadRight);
        }
        3 => {
            buttons.insert(ControllerButton::DpadRight);
            buttons.insert(ControllerButton::DpadDown);
        }
        4 => {
            buttons.insert(ControllerButton::DpadDown);
        }
        5 => {
            buttons.insert(ControllerButton::DpadDown);
            buttons.insert(ControllerButton::DpadLeft);
        }
        6 => {
            buttons.insert(ControllerButton::DpadLeft);
        }
        7 => {
            buttons.insert(ControllerButton::DpadLeft);
            buttons.insert(ControllerButton::DpadUp);
        }
        _ => {}
    }
}

fn parse_input_report(
    buf: &[u8],
    bytes_read: usize,
    transport: ConnectionTransport,
) -> Option<DualSenseInputState> {
    if bytes_read < 2 {
        return None;
    }

    let report_id = buf[0];
    let (base, touchpad_shift) = match (transport, report_id) {
        (ConnectionTransport::Bluetooth, DS_INPUT_REPORT_BT) => {
            if bytes_read < BT_INPUT_REPORT_LEN {
                return None;
            }

            let expected_crc = u32::from_le_bytes(buf[bytes_read - 4..bytes_read].try_into().ok()?);
            if reports::crc32_with_seed(BT_INPUT_CRC_SEED, &buf[..bytes_read - 4]) != expected_crc {
                return None;
            }

            (2usize, 1usize)
        }
        (ConnectionTransport::Bluetooth, DS_INPUT_REPORT_USB) => {
            // BT simple-mode 10-byte report; skip until controller switches to full 0x31 reports
            return None;
        }
        (_, DS_INPUT_REPORT_USB) if bytes_read >= 11 => (1usize, 0usize),
        _ => return None,
    };

    let mut pressed_buttons = HashSet::new();
    let face_and_dpad = buf[base + 7];
    let misc = buf[base + 8];
    let system = buf[base + 9];

    parse_dpad(&mut pressed_buttons, face_and_dpad & 0x0F);

    if face_and_dpad & 0x10 != 0 {
        pressed_buttons.insert(ControllerButton::Square);
    }
    if face_and_dpad & 0x20 != 0 {
        pressed_buttons.insert(ControllerButton::Triangle);
    }
    if face_and_dpad & 0x40 != 0 {
        pressed_buttons.insert(ControllerButton::Circle);
    }
    if face_and_dpad & 0x80 != 0 {
        pressed_buttons.insert(ControllerButton::Cross);
    }

    if misc & 0x01 != 0 {
        pressed_buttons.insert(ControllerButton::L1);
    }
    if misc & 0x02 != 0 {
        pressed_buttons.insert(ControllerButton::R1);
    }
    if misc & 0x10 != 0 {
        pressed_buttons.insert(ControllerButton::Create);
    }
    if misc & 0x20 != 0 {
        pressed_buttons.insert(ControllerButton::Options);
    }
    if misc & 0x40 != 0 {
        pressed_buttons.insert(ControllerButton::L3);
    }
    if misc & 0x80 != 0 {
        pressed_buttons.insert(ControllerButton::R3);
    }
    if system & 0x01 != 0 {
        pressed_buttons.insert(ControllerButton::Ps);
    }
    if system & 0x02 != 0 {
        pressed_buttons.insert(ControllerButton::Touchpad);
    }
    if system & 0x04 != 0 {
        pressed_buttons.insert(ControllerButton::Mute);
    }

    let (touching_0, finger0_x, finger0_y, touching_1, finger1_x, finger1_y) =
        if bytes_read >= 41 + touchpad_shift {
            parse_touchpad(buf, touchpad_shift)
        } else {
            (false, 0, 0, false, 0, 0)
        };

    Some(DualSenseInputState {
        pressed_buttons,
        left_stick_x: buf[base],
        left_stick_y: buf[base + 1],
        right_stick_x: buf[base + 2],
        right_stick_y: buf[base + 3],
        left_trigger: buf[base + 4],
        right_trigger: buf[base + 5],
        touching_0,
        finger0_x,
        finger0_y,
        touching_1,
        finger1_x,
        finger1_y,
    })
}

fn normalize_axis(value: u8) -> f32 {
    ((value as f32 - 127.5) / 127.5).clamp(-1.0, 1.0)
}

fn normalize_trigger(value: u8) -> f32 {
    (value as f32 / 255.0).clamp(0.0, 1.0)
}

fn axis_to_thumb(value: f32, invert: bool) -> i16 {
    let normalized = if invert { -value } else { value };
    (normalized.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

fn axis_to_ds4(value: f32, invert: bool) -> u8 {
    let normalized = if invert { -value } else { value };
    (((normalized.clamp(-1.0, 1.0) + 1.0) * 127.5).round()).clamp(0.0, 255.0) as u8
}

fn apply_deadzone(value: f32, deadzone: f32) -> f32 {
    let magnitude = value.abs();
    if magnitude <= deadzone {
        0.0
    } else {
        let scaled = (magnitude - deadzone) / (1.0 - deadzone);
        scaled.clamp(0.0, 1.0) * value.signum()
    }
}

fn calibrate_stick_axis(value: f32, center: f32, deadzone: f32, outer_scale: f32) -> f32 {
    let centered = ((value - center) * outer_scale.clamp(0.25, 2.0)).clamp(-1.0, 1.0);
    apply_deadzone(centered, deadzone.clamp(0.0, 0.95))
}

fn calibrate_trigger_value(value: u8, calibration: &TriggerCalibration) -> u8 {
    let deadzone = calibration.deadzone.min(254);
    let max_value = calibration.max_value.max(deadzone.saturating_add(1));
    if value <= deadzone {
        0
    } else if value >= max_value {
        255
    } else {
        let scaled = ((value - deadzone) as f32 / (max_value - deadzone) as f32) * 255.0;
        scaled.round().clamp(0.0, 255.0) as u8
    }
}

fn build_live_input_snapshot(
    connected: bool,
    input: &DualSenseInputState,
    calibration: &CalibrationProfile,
) -> LiveInputSnapshot {
    let left_norm_x = normalize_axis(input.left_stick_x);
    let left_norm_y = normalize_axis(input.left_stick_y);
    let right_norm_x = normalize_axis(input.right_stick_x);
    let right_norm_y = normalize_axis(input.right_stick_y);

    let left_cal_x = calibrate_stick_axis(
        left_norm_x,
        calibration.left_stick.center_x,
        calibration.left_stick.deadzone,
        calibration.left_stick.outer_scale,
    );
    let left_cal_y = calibrate_stick_axis(
        left_norm_y,
        calibration.left_stick.center_y,
        calibration.left_stick.deadzone,
        calibration.left_stick.outer_scale,
    );
    let right_cal_x = calibrate_stick_axis(
        right_norm_x,
        calibration.right_stick.center_x,
        calibration.right_stick.deadzone,
        calibration.right_stick.outer_scale,
    );
    let right_cal_y = calibrate_stick_axis(
        right_norm_y,
        calibration.right_stick.center_y,
        calibration.right_stick.deadzone,
        calibration.right_stick.outer_scale,
    );

    let left_trigger_calibrated =
        calibrate_trigger_value(input.left_trigger, &calibration.left_trigger);
    let right_trigger_calibrated =
        calibrate_trigger_value(input.right_trigger, &calibration.right_trigger);

    let mut pressed_buttons: Vec<_> = input.pressed_buttons.iter().copied().collect();
    pressed_buttons.sort();

    LiveInputSnapshot {
        connected,
        left_stick: StickSnapshot {
            raw_x: input.left_stick_x,
            raw_y: input.left_stick_y,
            normalized_x: left_norm_x,
            normalized_y: left_norm_y,
            calibrated_x: left_cal_x,
            calibrated_y: left_cal_y,
        },
        right_stick: StickSnapshot {
            raw_x: input.right_stick_x,
            raw_y: input.right_stick_y,
            normalized_x: right_norm_x,
            normalized_y: right_norm_y,
            calibrated_x: right_cal_x,
            calibrated_y: right_cal_y,
        },
        left_trigger: TriggerSnapshot {
            raw_value: input.left_trigger,
            normalized: normalize_trigger(input.left_trigger),
            calibrated_value: left_trigger_calibrated,
            calibrated_normalized: normalize_trigger(left_trigger_calibrated),
        },
        right_trigger: TriggerSnapshot {
            raw_value: input.right_trigger,
            normalized: normalize_trigger(input.right_trigger),
            calibrated_value: right_trigger_calibrated,
            calibrated_normalized: normalize_trigger(right_trigger_calibrated),
        },
        pressed_buttons,
    }
}

fn update_firmware_eligibility(state: &mut ControllerState) {
    state.firmware_status.connected = state.connected;
    state.firmware_status.transport = state.connection_transport;
    state.firmware_status.eligible =
        state.connected && matches!(state.connection_transport, ConnectionTransport::Usb);

    if !state.firmware_status.busy && state.firmware_status.step == FirmwareCalibrationStep::Idle {
        state.firmware_status.last_message = if state.firmware_status.eligible {
            "Firmware calibration is available over USB. Start with a temporary calibration first."
                .to_string()
        } else if !state.connected {
            "Connect the DualSense over USB to enable firmware calibration.".to_string()
        } else {
            "Firmware calibration is disabled on Bluetooth. Reconnect over USB.".to_string()
        };
    }
}

fn set_firmware_error(state: &mut ControllerState, message: String) -> FirmwareCalibrationStatus {
    state.firmware_status.busy = false;
    state.firmware_status.step = FirmwareCalibrationStep::Error;
    state.firmware_status.can_sample_center = false;
    state.firmware_status.can_store_temporarily = false;
    state.firmware_status.can_store_permanently = false;
    state.firmware_status.requires_stick_rotation = false;
    state.firmware_status.last_error = Some(message.clone());
    state.firmware_status.last_message = message;
    update_firmware_eligibility(state);
    state.firmware_status.clone()
}

fn reset_firmware_step_controls(state: &mut ControllerState) {
    state.firmware_status.can_sample_center = false;
    state.firmware_status.can_store_temporarily = false;
    state.firmware_status.can_store_permanently = false;
    state.firmware_status.requires_stick_rotation = false;
}

fn build_feature_report_buffer(report_id: u8, payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() + 1 > DUALSENSE_FEATURE_REPORT_LEN {
        return Err(format!(
            "Firmware payload is too large for the DualSense feature report: {} bytes.",
            payload.len()
        ));
    }

    let mut buf = vec![0u8; DUALSENSE_FEATURE_REPORT_LEN];
    buf[0] = report_id;
    buf[1..1 + payload.len()].copy_from_slice(payload);
    Ok(buf)
}

fn open_usb_dualsense_for_firmware() -> Result<HidDevice, String> {
    let mut api = HidApi::new().map_err(|e| e.to_string())?;
    let _ = api.refresh_devices();

    open_usb_dualsense_device(&api).ok_or_else(|| {
        "DualSense USB device not found. Connect the controller with a USB cable and try again."
            .to_string()
    })
}

fn send_feature_report_checked(
    device: &HidDevice,
    report_id: u8,
    payload: &[u8],
) -> Result<(), String> {
    let buf = build_feature_report_buffer(report_id, payload)?;
    device.send_feature_report(&buf).map_err(|e| e.to_string())
}

fn get_feature_report_checked(
    device: &HidDevice,
    report_id: u8,
    expected_len: usize,
) -> Result<Vec<u8>, String> {
    let mut buf = build_feature_report_buffer(report_id, &[])?;
    let bytes_read = device
        .get_feature_report(&mut buf)
        .map_err(|e| e.to_string())?;
    if bytes_read == 0 {
        return Err("No response from controller while reading calibration status.".to_string());
    }
    if bytes_read < expected_len + 1 {
        return Err(format!(
            "Controller returned an unexpected calibration payload length: expected at least {}, got {}.",
            expected_len + 1,
            bytes_read
        ));
    }
    Ok(buf[1..1 + expected_len].to_vec())
}

fn expected_calibration_ready_response(target_id: u8) -> [u8; 4] {
    [FIRMWARE_CALIBRATION_DEVICE_ID, target_id, 1, 0xFF]
}

fn expect_calibration_ready(device: &HidDevice, target_id: u8) -> Result<(), String> {
    let expected = expected_calibration_ready_response(target_id);
    let response = get_feature_report_checked(device, FIRMWARE_REPORT_GET_CALIBRATION, 4)?;
    if response.as_slice() != expected {
        return Err(format!(
            "Controller returned an unexpected calibration state: expected {:02x?}, got {:02x?}. Reconnect the controller and try again.",
            expected, response
        ));
    }
    Ok(())
}

fn nvs_unlock(device: &HidDevice) -> Result<(), String> {
    let mut payload = vec![FIRMWARE_NVS_DEVICE_ID, FIRMWARE_NVS_UNLOCK_ACTION];
    payload.extend_from_slice(&FIRMWARE_NVS_PASSWORD);
    send_feature_report_checked(device, FIRMWARE_REPORT_SET_TEST, &payload)
}

fn nvs_lock(device: &HidDevice) -> Result<(), String> {
    send_feature_report_checked(
        device,
        FIRMWARE_REPORT_SET_TEST,
        &[FIRMWARE_NVS_DEVICE_ID, FIRMWARE_NVS_LOCK_ACTION],
    )
}

fn start_center_calibration(device: &HidDevice) -> Result<(), String> {
    send_feature_report_checked(
        device,
        FIRMWARE_REPORT_SET_CALIBRATION,
        &[
            FIRMWARE_ACTION_START,
            FIRMWARE_CALIBRATION_DEVICE_ID,
            FIRMWARE_CENTER_TARGET_ID,
        ],
    )?;
    expect_calibration_ready(device, FIRMWARE_CENTER_TARGET_ID)
}

fn sample_center_calibration(device: &HidDevice) -> Result<(), String> {
    send_feature_report_checked(
        device,
        FIRMWARE_REPORT_SET_CALIBRATION,
        &[
            FIRMWARE_ACTION_SAMPLE,
            FIRMWARE_CALIBRATION_DEVICE_ID,
            FIRMWARE_CENTER_TARGET_ID,
        ],
    )?;
    expect_calibration_ready(device, FIRMWARE_CENTER_TARGET_ID)
}

fn store_center_calibration(device: &HidDevice) -> Result<(), String> {
    send_feature_report_checked(
        device,
        FIRMWARE_REPORT_SET_CALIBRATION,
        &[
            FIRMWARE_ACTION_STORE,
            FIRMWARE_CALIBRATION_DEVICE_ID,
            FIRMWARE_CENTER_TARGET_ID,
        ],
    )
}

fn start_range_calibration(device: &HidDevice) -> Result<(), String> {
    send_feature_report_checked(
        device,
        FIRMWARE_REPORT_SET_CALIBRATION,
        &[
            FIRMWARE_ACTION_START,
            FIRMWARE_CALIBRATION_DEVICE_ID,
            FIRMWARE_RANGE_TARGET_ID,
        ],
    )?;
    expect_calibration_ready(device, FIRMWARE_RANGE_TARGET_ID)
}

fn store_range_calibration(device: &HidDevice) -> Result<(), String> {
    send_feature_report_checked(
        device,
        FIRMWARE_REPORT_SET_CALIBRATION,
        &[
            FIRMWARE_ACTION_STORE,
            FIRMWARE_CALIBRATION_DEVICE_ID,
            FIRMWARE_RANGE_TARGET_ID,
        ],
    )
}

fn sync_key_state(active: &mut HashSet<KeyCode>, desired: &HashSet<KeyCode>) {
    let to_release: Vec<_> = active.difference(desired).copied().collect();
    let to_press: Vec<_> = desired.difference(active).copied().collect();

    for key in &to_release {
        send_key_event(*key, false);
    }
    for key in &to_press {
        send_key_event(*key, true);
    }

    *active = desired.clone();
}

fn sync_mouse_button_state(active: &mut HashSet<MouseButton>, desired: &HashSet<MouseButton>) {
    let to_release: Vec<_> = active.difference(desired).copied().collect();
    let to_press: Vec<_> = desired.difference(active).copied().collect();

    for button in &to_release {
        send_mouse_button(*button, false);
    }
    for button in &to_press {
        send_mouse_button(*button, true);
    }

    *active = desired.clone();
}

fn release_binding_outputs(state: &mut ControllerState) {
    let active_keys: Vec<_> = state.active_keys.drain().collect();
    let active_mouse_buttons: Vec<_> = state.active_mouse_buttons.drain().collect();

    for key in active_keys {
        send_key_event(key, false);
    }
    for button in active_mouse_buttons {
        send_mouse_button(button, false);
    }
}

fn release_touchpad_outputs(state: &mut ControllerState) {
    if let Some(button) = state.click_held_button.take() {
        send_mouse_button(button, false);
    }
    if let Some(button) = state.drag_button.take() {
        send_mouse_button(button, false);
    }
}

fn reset_touchpad_tracking(state: &mut ControllerState) {
    state.last_touch_x = None;
    state.last_touch_y = None;
    state.last_touch_active = false;
    state.last_pad_button = false;
    state.touch_start_time = None;
    state.touch_start_x = 0;
    state.touch_start_y = 0;
    state.touch_moved = false;
    state.peak_finger_count = 0;
    state.last_touch_finger_count = 0;
    state.last_tap_time = None;
    state.last_tap_button = None;
    state.drag_active = false;
    state.drag_button = None;
}

fn touchpad_click_button(finger_count: u8, touching_0: bool, fx: i32) -> MouseButton {
    if finger_count >= 2 || (touching_0 && fx >= TOUCHPAD_MID_X) {
        MouseButton::Right
    } else {
        MouseButton::Left
    }
}

fn playstation_dpad_value(up: bool, right: bool, down: bool, left: bool) -> u8 {
    match (up, right, down, left) {
        (true, true, false, false) => 0x01,
        (false, true, false, false) => 0x02,
        (false, true, true, false) => 0x03,
        (false, false, true, false) => 0x04,
        (false, false, true, true) => 0x05,
        (false, false, false, true) => 0x06,
        (true, false, false, true) => 0x07,
        (true, false, false, false) => 0x00,
        _ => 0x08,
    }
}

fn apply_playstation_button_state(report: &mut DS4Report, pressed: &HashSet<PlayStationButton>) {
    let mut low = playstation_dpad_value(
        pressed.contains(&PlayStationButton::Up),
        pressed.contains(&PlayStationButton::Right),
        pressed.contains(&PlayStationButton::Down),
        pressed.contains(&PlayStationButton::Left),
    );
    let mut high = 0u8;
    let mut special = 0u8;

    if pressed.contains(&PlayStationButton::Square) {
        low |= 1 << 4;
    }
    if pressed.contains(&PlayStationButton::Cross) {
        low |= 1 << 5;
    }
    if pressed.contains(&PlayStationButton::Circle) {
        low |= 1 << 6;
    }
    if pressed.contains(&PlayStationButton::Triangle) {
        low |= 1 << 7;
    }
    if pressed.contains(&PlayStationButton::L1) {
        high |= 1 << 0;
    }
    if pressed.contains(&PlayStationButton::R1) {
        high |= 1 << 1;
    }
    if report.trigger_l > 0 {
        high |= 1 << 2;
    }
    if report.trigger_r > 0 {
        high |= 1 << 3;
    }
    if pressed.contains(&PlayStationButton::Share) {
        high |= 1 << 4;
    }
    if pressed.contains(&PlayStationButton::Options) {
        high |= 1 << 5;
    }
    if pressed.contains(&PlayStationButton::L3) {
        high |= 1 << 6;
    }
    if pressed.contains(&PlayStationButton::R3) {
        high |= 1 << 7;
    }
    if pressed.contains(&PlayStationButton::Ps) {
        special |= 1 << 0;
    }
    if pressed.contains(&PlayStationButton::Touchpad) {
        special |= 1 << 1;
    }

    report.buttons = u16::from(low) | (u16::from(high) << 8);
    report.special = special;
}

fn handle_button_binding(
    target: &ButtonBindingTarget,
    pressed: bool,
    gamepad: &mut XGamepad,
    playstation_buttons: &mut HashSet<PlayStationButton>,
    desired_keys: &mut HashSet<KeyCode>,
    desired_mouse_buttons: &mut HashSet<MouseButton>,
) {
    if !pressed {
        return;
    }

    match target {
        ButtonBindingTarget::Disabled => {}
        ButtonBindingTarget::XboxButton { button } => {
            gamepad.buttons.raw |= xbox_button_bits(*button);
        }
        ButtonBindingTarget::PlayStationButton { button } => {
            playstation_buttons.insert(*button);
        }
        ButtonBindingTarget::KeyboardKey { key } => {
            desired_keys.insert(*key);
        }
        ButtonBindingTarget::MouseButton { button } => {
            desired_mouse_buttons.insert(*button);
        }
    }
}

fn handle_stick_binding(
    binding: &StickBinding,
    x: f32,
    y: f32,
    gamepad: &mut XGamepad,
    playstation_report: &mut DS4Report,
    desired_keys: &mut HashSet<KeyCode>,
) {
    match binding {
        StickBinding::Disabled => {}
        StickBinding::XboxStick { stick } => match stick {
            XboxStick::Left => {
                gamepad.thumb_lx = axis_to_thumb(x, false);
                gamepad.thumb_ly = axis_to_thumb(y, true);
            }
            XboxStick::Right => {
                gamepad.thumb_rx = axis_to_thumb(x, false);
                gamepad.thumb_ry = axis_to_thumb(y, true);
            }
        },
        StickBinding::PlayStationStick { stick } => match stick {
            PlayStationStick::Left => {
                playstation_report.thumb_lx = axis_to_ds4(x, false);
                playstation_report.thumb_ly = axis_to_ds4(y, true);
            }
            PlayStationStick::Right => {
                playstation_report.thumb_rx = axis_to_ds4(x, false);
                playstation_report.thumb_ry = axis_to_ds4(y, true);
            }
        },
        StickBinding::Keyboard4 {
            up,
            down,
            left,
            right,
            threshold,
        } => {
            let threshold = threshold.clamp(0.05, 0.95);
            if y <= -threshold {
                desired_keys.insert(*up);
            }
            if y >= threshold {
                desired_keys.insert(*down);
            }
            if x <= -threshold {
                desired_keys.insert(*left);
            }
            if x >= threshold {
                desired_keys.insert(*right);
            }
        }
        StickBinding::MouseMove {
            sensitivity,
            deadzone,
        } => {
            let x = apply_deadzone(x, deadzone.clamp(0.0, 0.95));
            let y = apply_deadzone(y, deadzone.clamp(0.0, 0.95));
            let dx = (x * sensitivity.max(0.0)).round() as i32;
            let dy = (y * sensitivity.max(0.0)).round() as i32;
            if dx != 0 || dy != 0 {
                send_mouse_move(dx, dy);
            }
        }
    }
}

fn handle_trigger_binding(
    binding: &TriggerBinding,
    value: u8,
    gamepad: &mut XGamepad,
    playstation_report: &mut DS4Report,
    desired_keys: &mut HashSet<KeyCode>,
    desired_mouse_buttons: &mut HashSet<MouseButton>,
) {
    match binding {
        TriggerBinding::Disabled => {}
        TriggerBinding::XboxTrigger { trigger } => match trigger {
            XboxTrigger::Left => gamepad.left_trigger = value,
            XboxTrigger::Right => gamepad.right_trigger = value,
        },
        TriggerBinding::PlayStationTrigger { trigger } => match trigger {
            PlayStationTrigger::Left => playstation_report.trigger_l = value,
            PlayStationTrigger::Right => playstation_report.trigger_r = value,
        },
        TriggerBinding::KeyboardKey { key, threshold } => {
            if value >= *threshold {
                desired_keys.insert(*key);
            }
        }
        TriggerBinding::MouseButton { button, threshold } => {
            if value >= *threshold {
                desired_mouse_buttons.insert(*button);
            }
        }
    }
}

fn apply_mapping_profile(
    state: &mut ControllerState,
    input: &DualSenseInputState,
    snapshot: &LiveInputSnapshot,
) {
    let profile = state.mapping_profile.clone();
    let mut gamepad = XGamepad::default();
    let mut playstation_report = DS4Report::default();
    let mut playstation_buttons = HashSet::new();
    let mut desired_keys = HashSet::new();
    let mut desired_mouse_buttons = HashSet::new();

    for (button, target) in &profile.button_bindings {
        if *button == ControllerButton::Touchpad && state.touchpad_enabled {
            continue;
        }

        handle_button_binding(
            target,
            input.pressed(*button),
            &mut gamepad,
            &mut playstation_buttons,
            &mut desired_keys,
            &mut desired_mouse_buttons,
        );
    }

    handle_stick_binding(
        &profile.left_stick,
        snapshot.left_stick.calibrated_x,
        snapshot.left_stick.calibrated_y,
        &mut gamepad,
        &mut playstation_report,
        &mut desired_keys,
    );
    handle_stick_binding(
        &profile.right_stick,
        snapshot.right_stick.calibrated_x,
        snapshot.right_stick.calibrated_y,
        &mut gamepad,
        &mut playstation_report,
        &mut desired_keys,
    );

    handle_trigger_binding(
        &profile.left_trigger,
        snapshot.left_trigger.calibrated_value,
        &mut gamepad,
        &mut playstation_report,
        &mut desired_keys,
        &mut desired_mouse_buttons,
    );
    handle_trigger_binding(
        &profile.right_trigger,
        snapshot.right_trigger.calibrated_value,
        &mut gamepad,
        &mut playstation_report,
        &mut desired_keys,
        &mut desired_mouse_buttons,
    );

    apply_playstation_button_state(&mut playstation_report, &playstation_buttons);

    sync_key_state(&mut state.active_keys, &desired_keys);
    sync_mouse_button_state(&mut state.active_mouse_buttons, &desired_mouse_buttons);

    if let Some(target) = &mut state.vigem_target {
        match target {
            VirtualTarget::Xbox { device, .. } => {
                let _ = device.update(&gamepad);
            }
            VirtualTarget::DualShock4(device) => {
                let _ = device.update(&playstation_report);
            }
        }
    }
}

fn handle_touchpad_mouse(state: &mut ControllerState, input: &DualSenseInputState) {
    let touching_0 = input.touching_0;
    let touching_1 = input.touching_1;
    let fx = input.finger0_x;
    let fy = input.finger0_y;
    let finger1_x = input.finger1_x;
    let finger1_y = input.finger1_y;
    let pad_button = input.pressed(ControllerButton::Touchpad);
    let sensitivity = state.touchpad_sensitivity;

    let finger_count = if touching_0 && touching_1 {
        2u8
    } else if touching_0 {
        1u8
    } else {
        0u8
    };

    if finger_count > state.peak_finger_count {
        state.peak_finger_count = finger_count;
    }

    if touching_0 {
        let current_x = if finger_count >= 2 {
            (fx + finger1_x) / 2
        } else {
            fx
        };
        let current_y = if finger_count >= 2 {
            (fy + finger1_y) / 2
        } else {
            fy
        };

        if !state.last_touch_active {
            let is_follow_up = state
                .last_tap_time
                .map(|t| t.elapsed().as_millis() < TAP_TIMEOUT_MS)
                .unwrap_or(false);

            if is_follow_up {
                if let Some(last_button) = state.last_tap_button {
                    state.drag_active = true;
                    state.drag_button = Some(last_button);
                    state.last_tap_time = None;
                    send_mouse_button(last_button, true);
                }
            }

            state.touch_start_time = Some(Instant::now());
            state.touch_start_x = current_x;
            state.touch_start_y = current_y;
            state.touch_moved = false;
            state.last_touch_x = Some(current_x);
            state.last_touch_y = Some(current_y);
            state.last_touch_active = true;
            state.last_touch_finger_count = finger_count;
        } else {
            if finger_count != state.last_touch_finger_count {
                state.touch_start_time = Some(Instant::now());
                state.touch_start_x = current_x;
                state.touch_start_y = current_y;
                state.touch_moved = false;
                state.last_touch_x = Some(current_x);
                state.last_touch_y = Some(current_y);
                state.last_touch_finger_count = finger_count;
            }

            if !state.touch_moved && !state.drag_active {
                let dsx = current_x - state.touch_start_x;
                let dsy = current_y - state.touch_start_y;
                if dsx * dsx + dsy * dsy > MOVE_DEAD_ZONE_SQ {
                    state.touch_moved = true;
                }
            }

            if state.touch_moved || state.drag_active {
                if let (Some(lx), Some(ly)) = (state.last_touch_x, state.last_touch_y) {
                    if finger_count >= 2 && !state.drag_active {
                        let scroll_delta =
                            (-(current_y - ly) as f64 * sensitivity * TOUCHPAD_SCROLL_FACTOR)
                                .round() as i32;
                        if scroll_delta != 0 {
                            send_mouse_scroll(scroll_delta);
                        }
                    } else {
                        let dx = ((current_x - lx) as f64 * sensitivity) as i32;
                        let dy = ((current_y - ly) as f64 * sensitivity) as i32;
                        if dx != 0 || dy != 0 {
                            send_mouse_move(dx, dy);
                        }
                    }
                }
            }

            state.last_touch_x = Some(current_x);
            state.last_touch_y = Some(current_y);
            state.last_touch_finger_count = finger_count;
        }
    } else if state.last_touch_active {
        let is_tap = state
            .touch_start_time
            .map(|t| {
                let dur = t.elapsed().as_millis();
                let ex = state.last_touch_x.unwrap_or(0);
                let ey = state.last_touch_y.unwrap_or(0);
                let tdx = ex - state.touch_start_x;
                let tdy = ey - state.touch_start_y;
                dur < TAP_TIMEOUT_MS && (tdx * tdx + tdy * tdy) < TAP_MAX_DISTANCE_SQ
            })
            .unwrap_or(false);

        if state.drag_active {
            if let Some(button) = state.drag_button {
                send_mouse_button(button, false);
                if is_tap {
                    state.last_tap_time = Some(Instant::now());
                    state.last_tap_button = Some(button);
                }
            }
            state.drag_active = false;
            state.drag_button = None;
        } else if is_tap {
            let button = if state.peak_finger_count >= 2 {
                MouseButton::Right
            } else {
                MouseButton::Left
            };
            send_mouse_button(button, true);
            send_mouse_button(button, false);
            state.last_tap_time = Some(Instant::now());
            state.last_tap_button = Some(button);
        }

        state.last_touch_x = None;
        state.last_touch_y = None;
        state.last_touch_active = false;
        state.touch_start_time = None;
        state.peak_finger_count = 0;
        state.last_touch_finger_count = 0;
    }

    if pad_button && !state.last_pad_button {
        let button = touchpad_click_button(finger_count, touching_0, fx);
        state.click_held_button = Some(button);
        send_mouse_button(button, true);
    }
    if !pad_button && state.last_pad_button {
        if let Some(button) = state.click_held_button.take() {
            send_mouse_button(button, false);
        }
    }
    state.last_pad_button = pad_button;
}

fn lock_state(state: &Mutex<ControllerState>) -> std::sync::MutexGuard<'_, ControllerState> {
    state.lock().unwrap_or_else(|poisoned| {
        eprintln!("Mutex was poisoned, recovering...");
        poisoned.into_inner()
    })
}

fn apply_adaptive_trigger_override(
    state: &mut ControllerState,
    left: TriggerEffectConfig,
    right: TriggerEffectConfig,
) {
    state.adaptive_left_trigger = normalize_trigger_effect(&left);
    state.adaptive_right_trigger = normalize_trigger_effect(&right);
    state.adaptive_triggers_active = true;
    state.left_trigger = state.adaptive_left_trigger.clone();
    state.right_trigger = state.adaptive_right_trigger.clone();
    state.output_dirty = true;
}

fn clear_adaptive_trigger_override(state: &mut ControllerState) {
    state.adaptive_triggers_active = false;
    state.left_trigger = state.manual_left_trigger.clone();
    state.right_trigger = state.manual_right_trigger.clone();
    state.output_dirty = true;
}

pub fn get_mapping_profile(state: Arc<Mutex<ControllerState>>) -> MappingProfile {
    let s = lock_state(&state);
    s.mapping_profile.clone()
}

pub fn get_calibration_profile(state: Arc<Mutex<ControllerState>>) -> CalibrationProfile {
    let s = lock_state(&state);
    s.calibration_profile.clone()
}

pub fn set_calibration_profile(state: Arc<Mutex<ControllerState>>, profile: CalibrationProfile) {
    let mut s = lock_state(&state);
    s.calibration_profile = profile;
}

pub fn get_live_input_snapshot(state: Arc<Mutex<ControllerState>>) -> LiveInputSnapshot {
    let s = lock_state(&state);
    s.last_input_snapshot.clone()
}

pub fn get_game_telemetry_status(state: Arc<Mutex<ControllerState>>) -> GameTelemetryStatus {
    let s = lock_state(&state);
    s.game_telemetry_status.clone()
}

pub fn capture_live_ocr_calibration_preview(
    settings: AdaptiveTriggerRuntimeSettings,
) -> Result<OcrCalibrationPreview, String> {
    game_monitor::capture_live_ocr_preview(&settings)
}

pub fn list_live_ocr_process_options() -> Result<Vec<ActiveProcessOption>, String> {
    game_monitor::list_live_ocr_processes()
}

pub fn sync_adaptive_trigger_settings(
    state: Arc<Mutex<ControllerState>>,
    settings: AdaptiveTriggerRuntimeSettings,
) {
    let mut s = lock_state(&state);
    s.adaptive_trigger_settings = settings;
}

pub fn get_firmware_calibration_status(
    state: Arc<Mutex<ControllerState>>,
) -> FirmwareCalibrationStatus {
    let s = lock_state(&state);
    s.firmware_status.clone()
}

pub fn start_firmware_center_calibration(
    state: Arc<Mutex<ControllerState>>,
) -> Result<FirmwareCalibrationStatus, String> {
    {
        let mut s = lock_state(&state);
        update_firmware_eligibility(&mut s);
        if !s.firmware_status.eligible {
            return Err(
                "Firmware calibration requires a connected DualSense over USB.".to_string(),
            );
        }
        if s.firmware_status.busy {
            return Err("Another firmware calibration session is already active.".to_string());
        }
        s.firmware_status.busy = true;
        s.firmware_status.active_mode = Some(FirmwareCalibrationMode::Center);
        s.firmware_status.step = FirmwareCalibrationStep::CenterSampling;
        s.firmware_status.can_sample_center = true;
        s.firmware_status.can_store_temporarily = false;
        s.firmware_status.can_store_permanently = false;
        s.firmware_status.requires_stick_rotation = false;
        s.firmware_status.last_error = None;
        s.firmware_status.last_message =
            "Leave both sticks centered, then click Sample Center.".to_string();
    }

    thread::sleep(Duration::from_millis(20));
    let device = open_usb_dualsense_for_firmware()?;
    if let Err(err) = start_center_calibration(&device) {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(&mut s, err));
    }

    let s = lock_state(&state);
    Ok(s.firmware_status.clone())
}

pub fn sample_firmware_center_calibration(
    state: Arc<Mutex<ControllerState>>,
) -> Result<FirmwareCalibrationStatus, String> {
    {
        let s = lock_state(&state);
        if s.firmware_status.active_mode != Some(FirmwareCalibrationMode::Center)
            || s.firmware_status.step != FirmwareCalibrationStep::CenterSampling
        {
            return Err("Start center calibration before sampling.".to_string());
        }
    }

    let device = open_usb_dualsense_for_firmware()?;
    if let Err(err) = sample_center_calibration(&device) {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(&mut s, err));
    }

    let mut s = lock_state(&state);
    s.firmware_status.step = FirmwareCalibrationStep::CenterSampled;
    s.firmware_status.can_sample_center = false;
    s.firmware_status.can_store_temporarily = true;
    s.firmware_status.can_store_permanently = true;
    s.firmware_status.last_error = None;
    s.firmware_status.last_message =
        "Center sampled. Store temporarily first, or save permanently if you accept the risk."
            .to_string();
    Ok(s.firmware_status.clone())
}

pub fn store_firmware_center_calibration(
    state: Arc<Mutex<ControllerState>>,
) -> Result<FirmwareCalibrationStatus, String> {
    {
        let s = lock_state(&state);
        if s.firmware_status.active_mode != Some(FirmwareCalibrationMode::Center)
            || s.firmware_status.step != FirmwareCalibrationStep::CenterSampled
        {
            return Err("Sample the center position before storing it.".to_string());
        }
    }

    let device = open_usb_dualsense_for_firmware()?;
    if let Err(err) = store_center_calibration(&device) {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(&mut s, err));
    }

    let mut s = lock_state(&state);
    s.firmware_status.busy = false;
    s.firmware_status.active_mode = None;
    s.firmware_status.step = FirmwareCalibrationStep::CompletedTemporary;
    reset_firmware_step_controls(&mut s);
    s.firmware_status.last_completed_mode = Some(FirmwareCalibrationMode::Center);
    s.firmware_status.last_error = None;
    s.firmware_status.last_message =
        "Temporary center calibration stored. Test it before attempting a permanent save."
            .to_string();
    update_firmware_eligibility(&mut s);
    Ok(s.firmware_status.clone())
}

pub fn start_firmware_range_calibration(
    state: Arc<Mutex<ControllerState>>,
) -> Result<FirmwareCalibrationStatus, String> {
    {
        let mut s = lock_state(&state);
        update_firmware_eligibility(&mut s);
        if !s.firmware_status.eligible {
            return Err(
                "Firmware calibration requires a connected DualSense over USB.".to_string(),
            );
        }
        if s.firmware_status.busy {
            return Err("Another firmware calibration session is already active.".to_string());
        }
        s.firmware_status.busy = true;
        s.firmware_status.active_mode = Some(FirmwareCalibrationMode::Range);
        s.firmware_status.step = FirmwareCalibrationStep::RangeSampling;
        s.firmware_status.can_sample_center = false;
        s.firmware_status.can_store_temporarily = true;
        s.firmware_status.can_store_permanently = true;
        s.firmware_status.requires_stick_rotation = true;
        s.firmware_status.last_error = None;
        s.firmware_status.last_message =
            "Move both sticks through their full circular range, then store the sampled range."
                .to_string();
    }

    thread::sleep(Duration::from_millis(20));
    let device = open_usb_dualsense_for_firmware()?;
    if let Err(err) = start_range_calibration(&device) {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(&mut s, err));
    }

    let s = lock_state(&state);
    Ok(s.firmware_status.clone())
}

pub fn store_firmware_range_calibration(
    state: Arc<Mutex<ControllerState>>,
) -> Result<FirmwareCalibrationStatus, String> {
    {
        let s = lock_state(&state);
        if s.firmware_status.active_mode != Some(FirmwareCalibrationMode::Range)
            || s.firmware_status.step != FirmwareCalibrationStep::RangeSampling
        {
            return Err("Start range calibration before storing it.".to_string());
        }
    }

    let device = open_usb_dualsense_for_firmware()?;
    if let Err(err) = store_range_calibration(&device) {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(&mut s, err));
    }

    let mut s = lock_state(&state);
    s.firmware_status.busy = false;
    s.firmware_status.active_mode = None;
    s.firmware_status.step = FirmwareCalibrationStep::CompletedTemporary;
    reset_firmware_step_controls(&mut s);
    s.firmware_status.last_completed_mode = Some(FirmwareCalibrationMode::Range);
    s.firmware_status.last_error = None;
    s.firmware_status.last_message =
        "Temporary range calibration stored. Test the controller before attempting a permanent save."
            .to_string();
    update_firmware_eligibility(&mut s);
    Ok(s.firmware_status.clone())
}

pub fn save_firmware_calibration_permanently(
    state: Arc<Mutex<ControllerState>>,
) -> Result<FirmwareCalibrationStatus, String> {
    let active_mode = {
        let mut s = lock_state(&state);
        update_firmware_eligibility(&mut s);
        if !s.firmware_status.eligible {
            return Err(
                "Permanent firmware calibration requires a connected DualSense over USB."
                    .to_string(),
            );
        }
        if !s.firmware_status.busy {
            return Err(
                "Permanent save is only available while a firmware calibration session is ready to store."
                    .to_string(),
            );
        }
        match (s.firmware_status.active_mode, s.firmware_status.step) {
            (Some(FirmwareCalibrationMode::Center), FirmwareCalibrationStep::CenterSampled) => {
                FirmwareCalibrationMode::Center
            }
            (Some(FirmwareCalibrationMode::Range), FirmwareCalibrationStep::RangeSampling) => {
                FirmwareCalibrationMode::Range
            }
            _ => {
                return Err(
                    "Finish sampling a firmware calibration step before saving permanently."
                        .to_string(),
                )
            }
        }
    };

    let device = open_usb_dualsense_for_firmware()?;
    if let Err(err) = nvs_unlock(&device) {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(
            &mut s,
            format!("Failed to unlock controller NVS: {err}"),
        ));
    }

    let write_result = match active_mode {
        FirmwareCalibrationMode::Center => store_center_calibration(&device),
        FirmwareCalibrationMode::Range => store_range_calibration(&device),
    };

    let lock_result = nvs_lock(&device);

    if let Err(err) = write_result {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(
            &mut s,
            format!("Failed to write permanent firmware calibration: {err}"),
        ));
    }
    if let Err(err) = lock_result {
        let mut s = lock_state(&state);
        return Ok(set_firmware_error(
            &mut s,
            format!("Calibration write finished, but re-locking NVS failed: {err}"),
        ));
    }

    let mut s = lock_state(&state);
    s.firmware_status.busy = false;
    s.firmware_status.active_mode = None;
    s.firmware_status.step = FirmwareCalibrationStep::CompletedPermanent;
    reset_firmware_step_controls(&mut s);
    s.firmware_status.last_completed_mode = Some(active_mode);
    s.firmware_status.last_error = None;
    s.firmware_status.last_message = match active_mode {
        FirmwareCalibrationMode::Center => {
            "Permanent center calibration saved to the controller firmware.".to_string()
        }
        FirmwareCalibrationMode::Range => {
            "Permanent range calibration saved to the controller firmware.".to_string()
        }
    };
    update_firmware_eligibility(&mut s);
    Ok(s.firmware_status.clone())
}

pub fn cancel_firmware_calibration(
    state: Arc<Mutex<ControllerState>>,
) -> Result<FirmwareCalibrationStatus, String> {
    let mut s = lock_state(&state);
    s.firmware_status.busy = false;
    s.firmware_status.active_mode = None;
    s.firmware_status.step = FirmwareCalibrationStep::Cancelled;
    reset_firmware_step_controls(&mut s);
    s.firmware_status.last_error = None;
    s.firmware_status.last_message =
        "Firmware calibration session cancelled. Reconnect the controller if it behaves unexpectedly."
            .to_string();
    update_firmware_eligibility(&mut s);
    Ok(s.firmware_status.clone())
}

pub fn set_mapping_profile(state: Arc<Mutex<ControllerState>>, profile: MappingProfile) {
    let mut s = lock_state(&state);
    release_binding_outputs(&mut s);
    s.mapping_profile = profile;
    let next_target = s.mapping_profile.emulation_target;
    ensure_virtual_target(&mut s, next_target);
}

pub fn set_touchpad_enabled(state: Arc<Mutex<ControllerState>>, enabled: bool) {
    let mut s = lock_state(&state);
    if !enabled {
        release_touchpad_outputs(&mut s);
    }
    s.touchpad_enabled = enabled;
    reset_touchpad_tracking(&mut s);
    if !enabled {
        s.click_held_button = None;
    }
}

pub fn set_touchpad_sensitivity(state: Arc<Mutex<ControllerState>>, sensitivity: f64) {
    let mut s = lock_state(&state);
    s.touchpad_sensitivity = sensitivity;
}

pub fn set_lightbar(state: Arc<Mutex<ControllerState>>, r: u8, g: u8, b: u8) {
    let mut s = lock_state(&state);
    s.r = r;
    s.g = g;
    s.b = b;
    s.output_dirty = true;
}

pub fn set_triggers(
    state: Arc<Mutex<ControllerState>>,
    left: TriggerEffectConfig,
    right: TriggerEffectConfig,
) {
    let mut s = lock_state(&state);
    s.manual_left_trigger = normalize_trigger_effect(&left);
    s.manual_right_trigger = normalize_trigger_effect(&right);
    if !s.adaptive_triggers_active {
        s.left_trigger = s.manual_left_trigger.clone();
        s.right_trigger = s.manual_right_trigger.clone();
    }
    s.output_dirty = true;
}

pub fn set_adaptive_triggers(
    state: Arc<Mutex<ControllerState>>,
    left: TriggerEffectConfig,
    right: TriggerEffectConfig,
) {
    let mut s = lock_state(&state);
    apply_adaptive_trigger_override(&mut s, left, right);
}

pub fn clear_adaptive_triggers(state: Arc<Mutex<ControllerState>>) {
    let mut s = lock_state(&state);
    clear_adaptive_trigger_override(&mut s);
}

pub fn set_rumble(state: Arc<Mutex<ControllerState>>, left: u8, right: u8) {
    let mut s = lock_state(&state);
    s.rumble_left = left;
    s.rumble_right = right;
    s.output_dirty = true;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub speaker_volume: u8,
    pub headphone_volume: u8,
    pub mic_volume: u8,
    pub mic_mute: bool,
    pub audio_mute: bool,
    pub mic_mute_led: u8,
    pub force_internal_mic: bool,
    pub force_internal_speaker: bool,
}

pub fn get_audio(state: Arc<Mutex<ControllerState>>) -> AudioSettings {
    audio::get_audio(state)
}

pub fn set_audio(
    state: Arc<Mutex<ControllerState>>,
    speaker_volume: u8,
    headphone_volume: u8,
    mic_volume: u8,
    mic_mute: bool,
    audio_mute: bool,
    mic_mute_led: u8,
    force_internal_mic: bool,
    force_internal_speaker: bool,
) {
    audio::set_audio(
        state,
        speaker_volume,
        headphone_volume,
        mic_volume,
        mic_mute,
        audio_mute,
        mic_mute_led,
        force_internal_mic,
        force_internal_speaker,
    );
}

pub fn test_speaker(state: Arc<Mutex<ControllerState>>) -> Result<(), String> {
    audio::test_speaker(state)
}

pub fn get_audio_test_status(state: Arc<Mutex<ControllerState>>) -> (bool, bool) {
    audio::get_audio_test_status(state)
}

pub fn start_mic_test(state: Arc<Mutex<ControllerState>>) -> Result<(), String> {
    audio::start_mic_test(state)
}

pub fn stop_mic_test(state: Arc<Mutex<ControllerState>>) {
    audio::stop_mic_test(state)
}

fn record_bt_mic_probe_observation(state: &mut ControllerState, report_id: u8, bytes_read: usize) {
    if !state.bt_mic_probe_active {
        return;
    }

    let observation = format!("0x{report_id:02X} ({bytes_read} bytes)");
    if state
        .bt_mic_probe_observations
        .iter()
        .any(|entry| entry == &observation)
    {
        return;
    }
    if state.bt_mic_probe_observations.len() >= 8 {
        return;
    }

    state.bt_mic_probe_observations.push(observation);
}

pub fn reset_on_exit(state: Arc<Mutex<ControllerState>>) {
    let mut s = lock_state(&state);
    release_binding_outputs(&mut s);
    release_touchpad_outputs(&mut s);
    reset_touchpad_tracking(&mut s);
    s.vigem_target = None;

    s.touchpad_enabled = false;
    s.touchpad_sensitivity = 1.0;
    s.mapping_profile = default_disabled_profile();
    s.adaptive_trigger_settings = default_runtime_settings();
    s.game_telemetry_status = default_game_telemetry_status();

    s.manual_left_trigger = default_trigger_effect();
    s.manual_right_trigger = default_trigger_effect();
    s.adaptive_left_trigger = default_trigger_effect();
    s.adaptive_right_trigger = default_trigger_effect();
    s.adaptive_triggers_active = false;
    s.left_trigger = default_trigger_effect();
    s.right_trigger = default_trigger_effect();
    s.rumble_left = 0;
    s.rumble_right = 0;

    s.r = 0;
    s.g = 0;
    s.b = 0;

    s.speaker_volume = 0;
    s.headphone_volume = 0;
    s.mic_volume = 0;
    s.mic_mute = false;
    s.audio_mute = false;
    s.mic_mute_led = 0;
    s.force_internal_mic = false;
    s.force_internal_speaker = false;

    s.speaker_test_active = false;
    s.speaker_test_restore_audio = None;
    s.pending_speaker_restore = false;
    s.audio_buf.clear();
    s.audio_buf_offset = 0;
    s.last_audio_write_at = None;

    if let Some(ref flag) = s.mic_test_stop {
        flag.store(true, Ordering::Relaxed);
    }
    s.mic_test_active = false;
    s.mic_test_stop = None;
    s.bt_mic_probe_active = false;
    s.bt_mic_probe_observations.clear();

    s.output_dirty = s.connected;
}

fn transport_from_device_info(device_info: &DeviceInfo) -> Option<ConnectionTransport> {
    if device_info.vendor_id() != SONY_VID {
        return None;
    }
    if !matches!(device_info.product_id(), DUALSENSE_PID | DUALSENSE_EDGE_PID) {
        return None;
    }
    match device_info.bus_type() {
        BusType::Bluetooth => Some(ConnectionTransport::Bluetooth),
        _ => Some(ConnectionTransport::Usb),
    }
}

fn open_usb_dualsense_device(api: &HidApi) -> Option<HidDevice> {
    let mut fallback: Option<HidDevice> = None;

    for device_info in api.device_list() {
        if transport_from_device_info(device_info) != Some(ConnectionTransport::Usb) {
            continue;
        }

        let usage_page = device_info.usage_page();
        let usage = device_info.usage();
        let preferred_collection = usage_page == 0x01 && matches!(usage, 0x04 | 0x05);
        let fallback_collection = usage_page == 0x01;
        if !preferred_collection && !fallback_collection {
            continue;
        }

        match device_info.open_device(api) {
            Ok(opened_device) => {
                if preferred_collection {
                    return Some(opened_device);
                }
                if fallback.is_none() {
                    fallback = Some(opened_device);
                }
            }
            Err(err) => {
                let path = device_info.path().to_string_lossy();
                eprintln!(
                    "DualSense USB open failed: usage_page=0x{usage_page:04X} usage=0x{usage:04X} path={path} error={err}"
                );
            }
        }
    }

    fallback
}

fn open_dualsense_device(api: &HidApi) -> Option<(HidDevice, ConnectionTransport)> {
    let mut fallback: Option<(HidDevice, ConnectionTransport)> = None;

    for device_info in api.device_list() {
        let Some(transport) = transport_from_device_info(device_info) else {
            continue;
        };

        let usage_page = device_info.usage_page();
        let usage = device_info.usage();
        let preferred_collection = usage_page == 0x01 && matches!(usage, 0x04 | 0x05);
        let fallback_collection = usage_page == 0x01;
        if !preferred_collection && !fallback_collection {
            continue;
        }

        match device_info.open_device(api) {
            Ok(opened_device) => {
                if preferred_collection {
                    return Some((opened_device, transport));
                }
                if fallback.is_none() {
                    fallback = Some((opened_device, transport));
                }
            }
            Err(err) => {
                let path = device_info.path().to_string_lossy();
                eprintln!(
                    "DualSense open failed: transport={transport:?} usage_page=0x{usage_page:04X} usage=0x{usage:04X} path={path} error={err}"
                );
            }
        }
    }

    fallback
}

pub fn start_game_monitor(state: Arc<Mutex<ControllerState>>, app_handle: AppHandle) {
    thread::spawn(move || {
        let mut runtime = game_monitor::GameMonitorRuntime::new();
        let mut last_emitted_status: Option<GameTelemetryStatus> = None;

        loop {
            let settings = {
                let current_state = lock_state(&state);
                current_state.adaptive_trigger_settings.clone()
            };

            let snapshot = runtime.poll(&settings);
            let status = snapshot.status;
            let effects = snapshot.effects;

            {
                let mut current_state = lock_state(&state);
                current_state.game_telemetry_status = status.clone();

                if settings.enabled
                    && settings.input_source == AdaptiveTriggerInputSource::Live
                    && effects.is_none()
                    && current_state.adaptive_triggers_active
                {
                    clear_adaptive_trigger_override(&mut current_state);
                }

                if let Some((left, right)) = effects {
                    apply_adaptive_trigger_override(&mut current_state, left, right);
                }
            }

            if last_emitted_status.as_ref() != Some(&status) {
                let _ = app_handle.emit("game-telemetry-status", status.clone());
                last_emitted_status = Some(status);
            }

            thread::sleep(Duration::from_millis(150));
        }
    });
}

const RECONNECT_DELAY_MIN_MS: u64 = 100;
const RECONNECT_DELAY_MAX_MS: u64 = 2000;
const RECONNECT_RETRY_PAUSE_MS: u64 = 250;
const LIVENESS_WATCHDOG_SECS: u64 = 5;

fn try_open_dualsense() -> Option<(HidDevice, ConnectionTransport)> {
    let api = HidApi::new().ok()?;
    open_dualsense_device(&api)
}

fn attempt_dualsense_connection() -> Option<(HidDevice, ConnectionTransport)> {
    if let Some(result) = try_open_dualsense() {
        return Some(result);
    }

    thread::sleep(Duration::from_millis(RECONNECT_RETRY_PAUSE_MS));
    try_open_dualsense()
}

pub fn start_controller_listener(state: Arc<Mutex<ControllerState>>, app_handle: AppHandle) {
    thread::spawn(move || {
        let mut device: Option<HidDevice> = None;
        let mut device_transport = ConnectionTransport::Unknown;
        let mut bt_write_failures = 0u8;
        let mut reconnect_delay_ms: u64 = RECONNECT_DELAY_MIN_MS;
        let mut last_successful_read = Instant::now();

        loop {
            if device.is_none() {
                if let Some((opened_device, transport)) = attempt_dualsense_connection() {
                    println!("DualSense Connected ({transport:?})!");
                    bt_write_failures = 0;
                    reconnect_delay_ms = RECONNECT_DELAY_MIN_MS;
                    last_successful_read = Instant::now();
                    device_transport = transport;
                    device = Some(opened_device);
                    let mut current_state = lock_state(&state);
                    current_state.connected = true;
                    current_state.connection_transport = transport;
                    current_state.output_dirty = true;
                    current_state.last_input_snapshot.connected = true;
                    update_firmware_eligibility(&mut current_state);
                    let firmware_status = current_state.firmware_status.clone();
                    drop(current_state);
                    let _ = app_handle.emit("controller-status", true);
                    let _ = app_handle.emit("firmware-calibration-status", firmware_status);
                }
            }

            let mut disconnected = false;

            {
                let current_state = lock_state(&state);
                if current_state.firmware_status.busy {
                    drop(current_state);
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }
            }

            if let Some(device_ref) = device.as_ref() {
                let mut buf = [0u8; MAX_HID_REPORT_LEN];
                match device_ref.read_timeout(&mut buf, 2) {
                    Ok(bytes_read) if bytes_read > 0 => {
                        last_successful_read = Instant::now();
                        if device_transport == ConnectionTransport::Bluetooth {
                            let mut current_state = lock_state(&state);
                            record_bt_mic_probe_observation(&mut current_state, buf[0], bytes_read);
                        }
                        if let Some(input) = parse_input_report(&buf, bytes_read, device_transport)
                        {
                            let mut current_state = lock_state(&state);
                            let snapshot = build_live_input_snapshot(
                                current_state.connected,
                                &input,
                                &current_state.calibration_profile,
                            );
                            current_state.last_input_snapshot = snapshot.clone();

                            let should_emit = current_state
                                .last_input_emit_at
                                .map(|t| t.elapsed().as_millis() >= INPUT_EVENT_INTERVAL_MS)
                                .unwrap_or(true);
                            if should_emit {
                                current_state.last_input_emit_at = Some(Instant::now());
                            }

                            apply_mapping_profile(&mut current_state, &input, &snapshot);

                            if current_state.touchpad_enabled {
                                handle_touchpad_mouse(&mut current_state, &input);
                            }

                            drop(current_state);
                            bt_write_failures = 0;
                            if should_emit {
                                let _ = app_handle.emit("controller-input", snapshot);
                            }
                        }
                    }
                    Ok(_) => {
                        if last_successful_read.elapsed() > Duration::from_secs(LIVENESS_WATCHDOG_SECS) {
                            eprintln!("DualSense watchdog: no data for {LIVENESS_WATCHDOG_SECS}s, forcing reconnect");
                            disconnected = true;
                        }
                    }
                    Err(err) => {
                        eprintln!("DualSense read error: {err}");
                        disconnected = true;
                    }
                }
            }

            if let Some(device_ref) = device.as_ref() {
                let report_to_send = {
                    let mut current_state = lock_state(&state);
                    let audio_due = current_state.speaker_test_active
                        && current_state.audio_buf_offset < current_state.audio_buf.len()
                        && current_state
                            .last_audio_write_at
                            .map(|t| t.elapsed().as_millis() >= AUDIO_WRITE_INTERVAL_MS)
                            .unwrap_or(true);

                    if (current_state.output_dirty || audio_due) && current_state.connected {
                        if audio_due {
                            current_state.last_audio_write_at = Some(Instant::now());
                        }
                        Some(build_output_report(&mut current_state))
                    } else {
                        None
                    }
                };

                if let Some(report) = report_to_send {
                    if let Err(err) = device_ref.write(&report) {
                        eprintln!("DualSense write error: {err}");
                        if device_transport == ConnectionTransport::Bluetooth {
                            bt_write_failures = bt_write_failures.saturating_add(1);
                            disconnected = bt_write_failures >= BT_WRITE_FAILURE_THRESHOLD;
                        } else {
                            disconnected = true;
                        }
                    } else {
                        let mut current_state = lock_state(&state);
                        if !audio::complete_pending_speaker_restore(&mut current_state) {
                            current_state.output_dirty = false;
                        }
                        bt_write_failures = 0;
                    }
                }
            }

            if disconnected {
                println!("DualSense Disconnected!");
                device = None;
                device_transport = ConnectionTransport::Unknown;
                bt_write_failures = 0;
                let mut current_state = lock_state(&state);
                release_binding_outputs(&mut current_state);
                release_touchpad_outputs(&mut current_state);
                reset_touchpad_tracking(&mut current_state);
                current_state.connected = false;
                current_state.connection_transport = ConnectionTransport::Unknown;
                current_state.output_dirty = true;
                current_state.last_input_snapshot = default_live_input_snapshot();
                current_state.last_input_emit_at = None;
                current_state.firmware_status.busy = false;
                current_state.firmware_status.active_mode = None;
                current_state.firmware_status.step = FirmwareCalibrationStep::Idle;
                reset_firmware_step_controls(&mut current_state);
                update_firmware_eligibility(&mut current_state);
                let firmware_status = current_state.firmware_status.clone();
                drop(current_state);
                let _ = app_handle.emit("controller-status", false);
                let _ = app_handle.emit("controller-input", default_live_input_snapshot());
                let _ = app_handle.emit("firmware-calibration-status", firmware_status);
            }

            if device.is_none() {
                thread::sleep(Duration::from_millis(reconnect_delay_ms));
                reconnect_delay_ms = (reconnect_delay_ms * 2).min(RECONNECT_DELAY_MAX_MS);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapping_presets_cover_xbox_and_playstation_targets() {
        let presets = mapping_presets();

        assert!(presets
            .iter()
            .any(|profile| profile.emulation_target == EmulationTarget::Xbox360));
        assert!(presets
            .iter()
            .any(|profile| profile.emulation_target == EmulationTarget::XboxOne));
        assert!(presets
            .iter()
            .any(|profile| profile.emulation_target == EmulationTarget::XboxSeries));
        assert!(presets
            .iter()
            .any(|profile| profile.emulation_target == EmulationTarget::DualShock4));
    }

    #[test]
    fn playstation_report_encodes_face_buttons_dpad_and_special_bits() {
        let mut report = DS4Report::default();
        let pressed = HashSet::from([
            PlayStationButton::Up,
            PlayStationButton::Cross,
            PlayStationButton::Options,
            PlayStationButton::Ps,
        ]);

        apply_playstation_button_state(&mut report, &pressed);

        assert_eq!(report.buttons & 0x000F, 0x0000);
        assert_ne!(report.buttons & 0x0020, 0);
        assert_ne!(report.buttons & 0x2000, 0);
        assert_eq!(report.special & 0x01, 0x01);
    }

    #[test]
    fn firmware_feature_report_buffers_are_padded_for_windows_hidapi() {
        let payload = [FIRMWARE_ACTION_START, FIRMWARE_CALIBRATION_DEVICE_ID, FIRMWARE_CENTER_TARGET_ID];
        let buf = build_feature_report_buffer(FIRMWARE_REPORT_SET_CALIBRATION, &payload).unwrap();

        assert_eq!(buf.len(), DUALSENSE_FEATURE_REPORT_LEN);
        assert_eq!(buf[0], FIRMWARE_REPORT_SET_CALIBRATION);
        assert_eq!(&buf[1..4], &payload);
        assert!(buf[4..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn calibration_ready_response_matches_expected_targets() {
        assert_eq!(
            expected_calibration_ready_response(FIRMWARE_CENTER_TARGET_ID),
            [FIRMWARE_CALIBRATION_DEVICE_ID, FIRMWARE_CENTER_TARGET_ID, 1, 0xFF]
        );
        assert_eq!(
            expected_calibration_ready_response(FIRMWARE_RANGE_TARGET_ID),
            [FIRMWARE_CALIBRATION_DEVICE_ID, FIRMWARE_RANGE_TARGET_ID, 1, 0xFF]
        );
    }
}
