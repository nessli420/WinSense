use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use vigem_client::{Client, TargetId, XButtons, XGamepad};

#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEINPUT, VIRTUAL_KEY,
};

const SONY_VID: u16 = 0x054C;
const DUALSENSE_PID: u16 = 0x0CE6;
const DUALSENSE_PID_BT: u16 = 0x0DF2;

const TAP_TIMEOUT_MS: u128 = 180;
const TAP_MAX_DISTANCE_SQ: i32 = 900;
const MOVE_DEAD_ZONE_SQ: i32 = 100;
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
    KeyboardKey { key: KeyCode },
    MouseButton { button: MouseButton },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StickBinding {
    Disabled,
    XboxStick { stick: XboxStick },
    Keyboard4 {
        up: KeyCode,
        down: KeyCode,
        left: KeyCode,
        right: KeyCode,
        threshold: f32,
    },
    MouseMove { sensitivity: f32, deadzone: f32 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TriggerBinding {
    Disabled,
    XboxTrigger { trigger: XboxTrigger },
    KeyboardKey { key: KeyCode, threshold: u8 },
    MouseButton { button: MouseButton, threshold: u8 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingProfile {
    pub id: String,
    pub name: String,
    pub built_in: bool,
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
}

impl DualSenseInputState {
    fn pressed(&self, button: ControllerButton) -> bool {
        self.pressed_buttons.contains(&button)
    }
}

pub struct ControllerState {
    pub connected: bool,
    pub output_dirty: bool,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub left_mode: u8,
    pub left_force: u8,
    pub left_start: u8,
    pub left_end: u8,
    pub left_frequency: u8,
    pub right_mode: u8,
    pub right_force: u8,
    pub right_start: u8,
    pub right_end: u8,
    pub right_frequency: u8,
    pub rumble_left: u8,
    pub rumble_right: u8,
    pub vigem_client: Option<Client>,
    pub vigem_target: Option<TargetId>,
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
    pub click_held_button: Option<MouseButton>,
    pub last_tap_time: Option<Instant>,
    pub last_tap_button: Option<MouseButton>,
    pub drag_active: bool,
    pub drag_button: Option<MouseButton>,
}

pub struct AppState {
    pub controller: Arc<Mutex<ControllerState>>,
}

impl AppState {
    pub fn new() -> Self {
        let mut vigem_client = Client::connect().ok();
        let mut vigem_target = None;

        if let Some(ref mut client) = vigem_client {
            let mut target =
                vigem_client::Xbox360Wired::new(client, vigem_client::TargetId::XBOX360_WIRED);
            if target.plugin().is_ok() {
                vigem_target = Some(vigem_client::TargetId::XBOX360_WIRED);
            }
        }

        Self {
            controller: Arc::new(Mutex::new(ControllerState {
                connected: false,
                output_dirty: false,
                r: 0,
                g: 0,
                b: 255,
                left_mode: 0,
                left_force: 0,
                left_start: 0,
                left_end: 180,
                left_frequency: 30,
                right_mode: 0,
                right_force: 0,
                right_start: 0,
                right_end: 180,
                right_frequency: 30,
                rumble_left: 0,
                rumble_right: 0,
                vigem_client,
                vigem_target,
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
                click_held_button: None,
                last_tap_time: None,
                last_tap_button: None,
                drag_active: false,
                drag_button: None,
            })),
        }
    }
}

fn build_output_report(state: &ControllerState) -> [u8; 64] {
    let mut report = [0u8; 64];
    report[0] = 0x02;
    report[1] = 0xFF;
    report[2] = 0x1 | 0x2 | 0x4 | 0x10 | 0x40;

    report[3] = state.rumble_right;
    report[4] = state.rumble_left;

    report[11] = state.right_mode;
    match state.right_mode {
        1 => {
            report[12] = state.right_start;
            report[13] = state.right_force;
        }
        2 => {
            report[12] = state.right_start;
            report[13] = state.right_end;
            report[14] = state.right_force;
        }
        6 => {
            report[12] = state.right_frequency;
            report[13] = (state.right_force as u16 * 63 / 255) as u8;
            report[14] = state.right_start;
        }
        0x27 => {
            report[12] = 0xFF;
            report[13] = 0xFF;
            report[14] = (state.right_force >> 5) | ((state.right_force >> 5) << 3);
            report[15] = state.right_frequency;
            report[16] = 5;
        }
        _ => {}
    }

    report[22] = state.left_mode;
    match state.left_mode {
        1 => {
            report[23] = state.left_start;
            report[24] = state.left_force;
        }
        2 => {
            report[23] = state.left_start;
            report[24] = state.left_end;
            report[25] = state.left_force;
        }
        6 => {
            report[23] = state.left_frequency;
            report[24] = (state.left_force as u16 * 63 / 255) as u8;
            report[25] = state.left_start;
        }
        0x27 => {
            report[23] = 0xFF;
            report[24] = 0xFF;
            report[25] = (state.left_force >> 5) | ((state.left_force >> 5) << 3);
            report[26] = state.left_frequency;
            report[27] = 5;
        }
        _ => {}
    }

    report[39] = 2;
    report[42] = 2;
    report[43] = 0x02;
    report[44] = 0x04;
    report[45] = state.r;
    report[46] = state.g;
    report[47] = state.b;
    report
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

fn default_xbox_profile() -> MappingProfile {
    MappingProfile {
        id: "builtin-xbox".to_string(),
        name: "Xbox 360 Emulation".to_string(),
        built_in: true,
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

fn default_disabled_profile() -> MappingProfile {
    MappingProfile {
        id: "builtin-disabled".to_string(),
        name: "Disabled".to_string(),
        built_in: true,
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
        button_bindings: build_bindings(&[
            (
                ControllerButton::Cross,
                ButtonBindingTarget::KeyboardKey { key: KeyCode::Space },
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
                ButtonBindingTarget::KeyboardKey { key: KeyCode::Enter },
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

pub fn mapping_presets() -> Vec<MappingProfile> {
    vec![
        default_xbox_profile(),
        default_disabled_profile(),
        default_keyboard_mouse_profile(),
    ]
}

pub fn calibration_capabilities() -> CalibrationCapabilities {
    CalibrationCapabilities {
        // Future firmware calibration should live behind separate USB-only commands.
        firmware_calibration_available: false,
        firmware_calibration_note: "Software calibration is implemented here. Permanent DualSense firmware calibration would require a separate USB-only workflow built on undocumented controller commands and stronger safety warnings.".to_string(),
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

fn parse_touchpad(buf: &[u8]) -> (bool, i32, i32, bool, i32, i32) {
    let not_touching_0 = (buf[33] >> 7) & 1 == 1;
    let finger0_x = ((buf[35] as i32 & 0x0F) << 8) | buf[34] as i32;
    let finger0_y = ((buf[36] as i32) << 4) | ((buf[35] as i32 >> 4) & 0x0F);

    let not_touching_1 = (buf[37] >> 7) & 1 == 1;
    let finger1_x = ((buf[39] as i32 & 0x0F) << 8) | buf[38] as i32;
    let finger1_y = ((buf[40] as i32) << 4) | ((buf[39] as i32 >> 4) & 0x0F);

    (!not_touching_0, finger0_x, finger0_y, !not_touching_1, finger1_x, finger1_y)
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

fn parse_input_report(buf: &[u8], bytes_read: usize) -> Option<DualSenseInputState> {
    if bytes_read < 11 {
        return None;
    }

    let mut pressed_buttons = HashSet::new();
    let face_and_dpad = buf[8];
    let misc = buf[9];
    let system = buf[10];

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

    let (touching_0, finger0_x, finger0_y, touching_1, _, _) = if bytes_read >= 41 {
        parse_touchpad(buf)
    } else {
        (false, 0, 0, false, 0, 0)
    };

    Some(DualSenseInputState {
        pressed_buttons,
        left_stick_x: buf[1],
        left_stick_y: buf[2],
        right_stick_x: buf[3],
        right_stick_y: buf[4],
        left_trigger: buf[5],
        right_trigger: buf[6],
        touching_0,
        finger0_x,
        finger0_y,
        touching_1,
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

    let left_trigger_calibrated = calibrate_trigger_value(input.left_trigger, &calibration.left_trigger);
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
            "Firmware calibration is available over USB. Start with a temporary calibration first.".to_string()
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

fn open_usb_dualsense_for_firmware() -> Result<HidDevice, String> {
    let mut api = HidApi::new().map_err(|e| e.to_string())?;
    let _ = api.refresh_devices();

    for device_info in api.device_list() {
        if device_info.vendor_id() == SONY_VID
            && device_info.product_id() == DUALSENSE_PID
            && device_info.usage_page() == 0x01
        {
            return device_info.open_device(&api).map_err(|e| e.to_string());
        }
    }

    Err("DualSense USB device not found. Connect the controller with a USB cable and try again.".to_string())
}

fn send_feature_report_checked(
    device: &HidDevice,
    report_id: u8,
    payload: &[u8],
) -> Result<(), String> {
    let mut buf = Vec::with_capacity(payload.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(payload);
    device.send_feature_report(&buf).map_err(|e| e.to_string())
}

fn get_feature_report_checked(
    device: &HidDevice,
    report_id: u8,
    expected_len: usize,
) -> Result<Vec<u8>, String> {
    let mut buf = vec![0u8; expected_len + 1];
    buf[0] = report_id;
    let bytes_read = device.get_feature_report(&mut buf).map_err(|e| e.to_string())?;
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
    Ok(buf[1..=expected_len].to_vec())
}

fn expect_calibration_ready(device: &HidDevice, target_id: u8) -> Result<(), String> {
    let expected = vec![
        FIRMWARE_CALIBRATION_DEVICE_ID,
        target_id,
        1,
        0xFF,
    ];
    let response = get_feature_report_checked(device, FIRMWARE_REPORT_GET_CALIBRATION, 4)?;
    if response != expected {
        return Err(format!(
            "Controller returned an unexpected calibration state: expected {:02x?}, got {:02x?}. Reconnect the controller and try again.",
            expected, response
        ));
    }
    Ok(())
}

fn nvs_unlock(device: &HidDevice) -> Result<(), String> {
    let mut payload = vec![
        FIRMWARE_NVS_DEVICE_ID,
        FIRMWARE_NVS_UNLOCK_ACTION,
    ];
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

fn handle_button_binding(
    target: &ButtonBindingTarget,
    pressed: bool,
    gamepad: &mut XGamepad,
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
    desired_keys: &mut HashSet<KeyCode>,
    desired_mouse_buttons: &mut HashSet<MouseButton>,
) {
    match binding {
        TriggerBinding::Disabled => {}
        TriggerBinding::XboxTrigger { trigger } => match trigger {
            XboxTrigger::Left => gamepad.left_trigger = value,
            XboxTrigger::Right => gamepad.right_trigger = value,
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
            &mut desired_keys,
            &mut desired_mouse_buttons,
        );
    }

    handle_stick_binding(
        &profile.left_stick,
        snapshot.left_stick.calibrated_x,
        snapshot.left_stick.calibrated_y,
        &mut gamepad,
        &mut desired_keys,
    );
    handle_stick_binding(
        &profile.right_stick,
        snapshot.right_stick.calibrated_x,
        snapshot.right_stick.calibrated_y,
        &mut gamepad,
        &mut desired_keys,
    );

    handle_trigger_binding(
        &profile.left_trigger,
        snapshot.left_trigger.calibrated_value,
        &mut gamepad,
        &mut desired_keys,
        &mut desired_mouse_buttons,
    );
    handle_trigger_binding(
        &profile.right_trigger,
        snapshot.right_trigger.calibrated_value,
        &mut gamepad,
        &mut desired_keys,
        &mut desired_mouse_buttons,
    );

    sync_key_state(&mut state.active_keys, &desired_keys);
    sync_mouse_button_state(&mut state.active_mouse_buttons, &desired_mouse_buttons);

    let target_id = state.vigem_target;
    if let (Some(client), Some(t_id)) = (&mut state.vigem_client, target_id) {
        let mut target = vigem_client::Xbox360Wired::new(client, t_id);
        let _ = target.update(&gamepad);
    }
}

fn handle_touchpad_mouse(state: &mut ControllerState, input: &DualSenseInputState) {
    let touching_0 = input.touching_0;
    let touching_1 = input.touching_1;
    let fx = input.finger0_x;
    let fy = input.finger0_y;
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
            state.touch_start_x = fx;
            state.touch_start_y = fy;
            state.touch_moved = false;
            state.last_touch_x = Some(fx);
            state.last_touch_y = Some(fy);
            state.last_touch_active = true;
        } else {
            if !state.touch_moved && !state.drag_active {
                let dsx = fx - state.touch_start_x;
                let dsy = fy - state.touch_start_y;
                if dsx * dsx + dsy * dsy > MOVE_DEAD_ZONE_SQ {
                    state.touch_moved = true;
                }
            }

            if state.touch_moved || state.drag_active {
                if let (Some(lx), Some(ly)) = (state.last_touch_x, state.last_touch_y) {
                    let dx = ((fx - lx) as f64 * sensitivity) as i32;
                    let dy = ((fy - ly) as f64 * sensitivity) as i32;
                    if dx != 0 || dy != 0 {
                        send_mouse_move(dx, dy);
                    }
                }
            }

            state.last_touch_x = Some(fx);
            state.last_touch_y = Some(fy);
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
        let s = lock_state(&state);
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
    left_mode: u8,
    left_force: u8,
    left_start: u8,
    left_end: u8,
    left_frequency: u8,
    right_mode: u8,
    right_force: u8,
    right_start: u8,
    right_end: u8,
    right_frequency: u8,
) {
    let mut s = lock_state(&state);
    s.left_mode = left_mode;
    s.left_force = left_force;
    s.left_start = left_start;
    s.left_end = left_end;
    s.left_frequency = left_frequency;
    s.right_mode = right_mode;
    s.right_force = right_force;
    s.right_start = right_start;
    s.right_end = right_end;
    s.right_frequency = right_frequency;
    s.output_dirty = true;
}

pub fn set_rumble(state: Arc<Mutex<ControllerState>>, left: u8, right: u8) {
    let mut s = lock_state(&state);
    s.rumble_left = left;
    s.rumble_right = right;
    s.output_dirty = true;
}

pub fn start_controller_listener(state: Arc<Mutex<ControllerState>>, app_handle: AppHandle) {
    thread::spawn(move || {
        let mut api = HidApi::new().expect("Failed to initialize HidApi");
        let mut device: Option<HidDevice> = None;

        loop {
            if device.is_none() {
                let _ = api.refresh_devices();
                for device_info in api.device_list() {
                    if device_info.vendor_id() == SONY_VID
                        && (device_info.product_id() == DUALSENSE_PID
                            || device_info.product_id() == DUALSENSE_PID_BT)
                        && device_info.usage_page() == 0x01
                    {
                        if let Ok(opened_device) = device_info.open_device(&api) {
                            println!("DualSense Connected (usage_page=0x01)!");
                            device = Some(opened_device);
                            let mut current_state = lock_state(&state);
                            current_state.connected = true;
                            current_state.connection_transport = if device_info.product_id() == DUALSENSE_PID {
                                ConnectionTransport::Usb
                            } else {
                                ConnectionTransport::Bluetooth
                            };
                            current_state.output_dirty = true;
                            current_state.last_input_snapshot.connected = true;
                            update_firmware_eligibility(&mut current_state);
                            let firmware_status = current_state.firmware_status.clone();
                            drop(current_state);
                            let _ = app_handle.emit("controller-status", true);
                            let _ = app_handle.emit("firmware-calibration-status", firmware_status);
                            break;
                        }
                    }
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
                let mut buf = [0u8; 64];
                match device_ref.read_timeout(&mut buf, 2) {
                    Ok(bytes_read) if bytes_read > 0 => {
                        if let Some(input) = parse_input_report(&buf, bytes_read) {
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

                            if current_state.touchpad_enabled && bytes_read >= 41 {
                                handle_touchpad_mouse(&mut current_state, &input);
                            }

                            drop(current_state);
                            if should_emit {
                                let _ = app_handle.emit("controller-input", snapshot);
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(err) => {
                        eprintln!("DualSense read error: {err}");
                        disconnected = true;
                    }
                }
            }

            if let Some(device_ref) = device.as_ref() {
                let report_to_send = {
                    let current_state = lock_state(&state);
                    if current_state.output_dirty && current_state.connected {
                        Some(build_output_report(&current_state))
                    } else {
                        None
                    }
                };

                if let Some(report) = report_to_send {
                    if let Err(err) = device_ref.write(&report) {
                        eprintln!("DualSense write error: {err}");
                        disconnected = true;
                    } else {
                        let mut current_state = lock_state(&state);
                        current_state.output_dirty = false;
                    }
                }
            }

            if disconnected {
                println!("DualSense Disconnected!");
                device = None;
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
                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}
