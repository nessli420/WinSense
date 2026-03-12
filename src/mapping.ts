export type ControllerButton =
  | "cross"
  | "circle"
  | "square"
  | "triangle"
  | "l1"
  | "r1"
  | "create"
  | "options"
  | "l3"
  | "r3"
  | "ps"
  | "touchpad"
  | "mute"
  | "dpadUp"
  | "dpadRight"
  | "dpadDown"
  | "dpadLeft";

export type XboxButton =
  | "a"
  | "b"
  | "x"
  | "y"
  | "up"
  | "right"
  | "down"
  | "left"
  | "leftShoulder"
  | "rightShoulder"
  | "back"
  | "start"
  | "leftThumb"
  | "rightThumb"
  | "guide";

export type XboxStick = "left" | "right";
export type XboxTrigger = "left" | "right";
export type MouseButton = "left" | "right" | "middle";

export type KeyCode =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"
  | "digit0"
  | "digit1"
  | "digit2"
  | "digit3"
  | "digit4"
  | "digit5"
  | "digit6"
  | "digit7"
  | "digit8"
  | "digit9"
  | "space"
  | "enter"
  | "escape"
  | "tab"
  | "leftShift"
  | "leftCtrl"
  | "leftAlt"
  | "upArrow"
  | "rightArrow"
  | "downArrow"
  | "leftArrow";

export type ButtonBindingTarget =
  | { type: "disabled" }
  | { type: "xboxButton"; button: XboxButton }
  | { type: "keyboardKey"; key: KeyCode }
  | { type: "mouseButton"; button: MouseButton };

export type StickBinding =
  | { type: "disabled" }
  | { type: "xboxStick"; stick: XboxStick }
  | {
      type: "keyboard4";
      up: KeyCode;
      down: KeyCode;
      left: KeyCode;
      right: KeyCode;
      threshold: number;
    }
  | { type: "mouseMove"; sensitivity: number; deadzone: number };

export type TriggerBinding =
  | { type: "disabled" }
  | { type: "xboxTrigger"; trigger: XboxTrigger }
  | { type: "keyboardKey"; key: KeyCode; threshold: number }
  | { type: "mouseButton"; button: MouseButton; threshold: number };

export interface MappingProfile {
  id: string;
  name: string;
  builtIn: boolean;
  buttonBindings: Partial<Record<ControllerButton, ButtonBindingTarget>>;
  leftStick: StickBinding;
  rightStick: StickBinding;
  leftTrigger: TriggerBinding;
  rightTrigger: TriggerBinding;
}

export interface StickCalibration {
  centerX: number;
  centerY: number;
  deadzone: number;
  outerScale: number;
}

export interface TriggerCalibration {
  deadzone: number;
  maxValue: number;
}

export interface CalibrationProfile {
  leftStick: StickCalibration;
  rightStick: StickCalibration;
  leftTrigger: TriggerCalibration;
  rightTrigger: TriggerCalibration;
}

export interface StickSnapshot {
  rawX: number;
  rawY: number;
  normalizedX: number;
  normalizedY: number;
  calibratedX: number;
  calibratedY: number;
}

export interface TriggerSnapshot {
  rawValue: number;
  normalized: number;
  calibratedValue: number;
  calibratedNormalized: number;
}

export interface LiveInputSnapshot {
  connected: boolean;
  leftStick: StickSnapshot;
  rightStick: StickSnapshot;
  leftTrigger: TriggerSnapshot;
  rightTrigger: TriggerSnapshot;
  pressedButtons: ControllerButton[];
}

export interface CalibrationCapabilities {
  firmwareCalibrationAvailable: boolean;
  firmwareCalibrationNote: string;
}

export type ConnectionTransport = "unknown" | "usb" | "bluetooth";
export type FirmwareCalibrationMode = "center" | "range";
export type FirmwareCalibrationStep =
  | "idle"
  | "centerSampling"
  | "centerSampled"
  | "rangeSampling"
  | "completedTemporary"
  | "completedPermanent"
  | "cancelled"
  | "error";

export interface FirmwareCalibrationStatus {
  connected: boolean;
  transport: ConnectionTransport;
  eligible: boolean;
  busy: boolean;
  activeMode: FirmwareCalibrationMode | null;
  step: FirmwareCalibrationStep;
  canSampleCenter: boolean;
  canStoreTemporarily: boolean;
  canStorePermanently: boolean;
  requiresStickRotation: boolean;
  lastCompletedMode: FirmwareCalibrationMode | null;
  lastMessage: string;
  lastError: string | null;
}

export interface PersistedAppState {
  activeTab?: string;
  firmwareRiskAccepted?: boolean;
  lightingEnabled?: boolean;
  rgb?: {
    r: number;
    g: number;
    b: number;
  };
  leftTrigger?: {
    mode: number;
    force: number;
    startPos: number;
    endPos: number;
    frequency: number;
  };
  rightTrigger?: {
    mode: number;
    force: number;
    startPos: number;
    endPos: number;
    frequency: number;
  };
  activeProfileId?: string | null;
  touchpadEnabled?: boolean;
  touchpadSensitivity?: number;
  activeMappingProfileId?: string | null;
  manualMappingProfile?: MappingProfile | null;
  calibrationProfile?: CalibrationProfile;
  launchOnStartup?: boolean;
  startupOpenMode?: "normal" | "tray";
  closeToTray?: boolean;
}

export const CONTROLLER_BUTTONS: Array<{
  id: ControllerButton;
  label: string;
  description: string;
}> = [
  { id: "cross", label: "Cross", description: "Bottom face button" },
  { id: "circle", label: "Circle", description: "Right face button" },
  { id: "square", label: "Square", description: "Left face button" },
  { id: "triangle", label: "Triangle", description: "Top face button" },
  { id: "l1", label: "L1", description: "Left shoulder button" },
  { id: "r1", label: "R1", description: "Right shoulder button" },
  { id: "create", label: "Create (B8)", description: "Button near the D-pad" },
  { id: "options", label: "Options", description: "Menu button" },
  { id: "l3", label: "L3", description: "Left stick click" },
  { id: "r3", label: "R3", description: "Right stick click" },
  { id: "ps", label: "PS", description: "PlayStation button" },
  { id: "touchpad", label: "Touchpad Click", description: "Physical touchpad press" },
  { id: "mute", label: "Mute", description: "Mic mute button" },
  { id: "dpadUp", label: "D-pad Up", description: "Directional up" },
  { id: "dpadRight", label: "D-pad Right", description: "Directional right" },
  { id: "dpadDown", label: "D-pad Down", description: "Directional down" },
  { id: "dpadLeft", label: "D-pad Left", description: "Directional left" },
];

export const KEY_OPTIONS: Array<{ value: KeyCode; label: string }> = [
  { value: "w", label: "W" },
  { value: "a", label: "A" },
  { value: "s", label: "S" },
  { value: "d", label: "D" },
  { value: "q", label: "Q" },
  { value: "e", label: "E" },
  { value: "r", label: "R" },
  { value: "f", label: "F" },
  { value: "c", label: "C" },
  { value: "v", label: "V" },
  { value: "space", label: "Space" },
  { value: "enter", label: "Enter" },
  { value: "escape", label: "Escape" },
  { value: "tab", label: "Tab" },
  { value: "leftShift", label: "Left Shift" },
  { value: "leftCtrl", label: "Left Ctrl" },
  { value: "leftAlt", label: "Left Alt" },
  { value: "upArrow", label: "Up Arrow" },
  { value: "rightArrow", label: "Right Arrow" },
  { value: "downArrow", label: "Down Arrow" },
  { value: "leftArrow", label: "Left Arrow" },
  { value: "digit1", label: "1" },
  { value: "digit2", label: "2" },
  { value: "digit3", label: "3" },
  { value: "digit4", label: "4" },
  { value: "digit5", label: "5" },
  { value: "digit6", label: "6" },
  { value: "digit7", label: "7" },
  { value: "digit8", label: "8" },
  { value: "digit9", label: "9" },
  { value: "digit0", label: "0" },
  { value: "m", label: "M" },
  { value: "t", label: "T" },
  { value: "g", label: "G" },
  { value: "x", label: "X" },
  { value: "z", label: "Z" },
];

export const XBOX_BUTTON_OPTIONS: Array<{ value: XboxButton; label: string }> = [
  { value: "a", label: "Xbox A" },
  { value: "b", label: "Xbox B" },
  { value: "x", label: "Xbox X" },
  { value: "y", label: "Xbox Y" },
  { value: "leftShoulder", label: "Xbox LB" },
  { value: "rightShoulder", label: "Xbox RB" },
  { value: "back", label: "Xbox Back" },
  { value: "start", label: "Xbox Start" },
  { value: "leftThumb", label: "Xbox L3" },
  { value: "rightThumb", label: "Xbox R3" },
  { value: "guide", label: "Xbox Guide" },
  { value: "up", label: "Xbox D-pad Up" },
  { value: "right", label: "Xbox D-pad Right" },
  { value: "down", label: "Xbox D-pad Down" },
  { value: "left", label: "Xbox D-pad Left" },
];

export const MOUSE_BUTTON_OPTIONS: Array<{ value: MouseButton; label: string }> = [
  { value: "left", label: "Left Click" },
  { value: "right", label: "Right Click" },
  { value: "middle", label: "Middle Click" },
];

export const XBOX_STICK_OPTIONS: Array<{ value: XboxStick; label: string }> = [
  { value: "left", label: "Xbox Left Stick" },
  { value: "right", label: "Xbox Right Stick" },
];

export const XBOX_TRIGGER_OPTIONS: Array<{ value: XboxTrigger; label: string }> = [
  { value: "left", label: "Xbox Left Trigger" },
  { value: "right", label: "Xbox Right Trigger" },
];

export const DEFAULT_BUTTON_TARGET: ButtonBindingTarget = { type: "disabled" };

export const DEFAULT_CALIBRATION_PROFILE: CalibrationProfile = {
  leftStick: { centerX: 0, centerY: 0, deadzone: 0.08, outerScale: 1 },
  rightStick: { centerX: 0, centerY: 0, deadzone: 0.08, outerScale: 1 },
  leftTrigger: { deadzone: 0, maxValue: 255 },
  rightTrigger: { deadzone: 0, maxValue: 255 },
};

export const EMPTY_LIVE_INPUT: LiveInputSnapshot = {
  connected: false,
  leftStick: { rawX: 128, rawY: 128, normalizedX: 0, normalizedY: 0, calibratedX: 0, calibratedY: 0 },
  rightStick: { rawX: 128, rawY: 128, normalizedX: 0, normalizedY: 0, calibratedX: 0, calibratedY: 0 },
  leftTrigger: { rawValue: 0, normalized: 0, calibratedValue: 0, calibratedNormalized: 0 },
  rightTrigger: { rawValue: 0, normalized: 0, calibratedValue: 0, calibratedNormalized: 0 },
  pressedButtons: [],
};

export const EMPTY_FIRMWARE_STATUS: FirmwareCalibrationStatus = {
  connected: false,
  transport: "unknown",
  eligible: false,
  busy: false,
  activeMode: null,
  step: "idle",
  canSampleCenter: false,
  canStoreTemporarily: false,
  canStorePermanently: false,
  requiresStickRotation: false,
  lastCompletedMode: null,
  lastMessage: "Connect the DualSense over USB to enable firmware calibration.",
  lastError: null,
};

export function cloneMappingProfile(profile: MappingProfile): MappingProfile {
  return JSON.parse(JSON.stringify(profile)) as MappingProfile;
}

export function toManualProfile(profile: MappingProfile): MappingProfile {
  return {
    ...cloneMappingProfile(profile),
    id: "manual-custom",
    name: "Manual / Custom",
    builtIn: false,
  };
}

export function getButtonBinding(
  profile: MappingProfile,
  button: ControllerButton,
): ButtonBindingTarget {
  return profile.buttonBindings[button] ?? DEFAULT_BUTTON_TARGET;
}

export function cloneCalibrationProfile(profile: CalibrationProfile): CalibrationProfile {
  return JSON.parse(JSON.stringify(profile)) as CalibrationProfile;
}
