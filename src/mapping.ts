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

export type ControllerEmulationTarget = "xbox360" | "xboxOne" | "xboxSeries" | "dualShock4";
export type EmulationFamily = "xbox" | "playstation";

export type XboxStick = "left" | "right";
export type XboxTrigger = "left" | "right";
export type PlayStationButton =
  | "cross"
  | "circle"
  | "square"
  | "triangle"
  | "up"
  | "right"
  | "down"
  | "left"
  | "l1"
  | "r1"
  | "share"
  | "options"
  | "l3"
  | "r3"
  | "ps"
  | "touchpad";
export type PlayStationStick = "left" | "right";
export type PlayStationTrigger = "left" | "right";
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
  | { type: "playstationButton"; button: PlayStationButton }
  | { type: "keyboardKey"; key: KeyCode }
  | { type: "mouseButton"; button: MouseButton };

export type StickBinding =
  | { type: "disabled" }
  | { type: "xboxStick"; stick: XboxStick }
  | { type: "playstationStick"; stick: PlayStationStick }
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
  | { type: "playstationTrigger"; trigger: PlayStationTrigger }
  | { type: "keyboardKey"; key: KeyCode; threshold: number }
  | { type: "mouseButton"; button: MouseButton; threshold: number };

export interface MappingProfile {
  id: string;
  name: string;
  builtIn: boolean;
  emulationTarget: ControllerEmulationTarget;
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

export interface AudioSettings {
  speakerVolume: number;
  headphoneVolume: number;
  micVolume: number;
  micMute: boolean;
  audioMute: boolean;
  micMuteLed: number;
  forceInternalMic: boolean;
  forceInternalSpeaker: boolean;
}

export interface LightingColor {
  r: number;
  g: number;
  b: number;
}

export type LightingEffect = "static" | "cycle" | "pulse" | "wave";

export interface LightingProfile {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  effect: LightingEffect;
  color: LightingColor;
  accentColor: LightingColor | null;
  speed: number;
  brightness: number;
}

export interface LightingSettings {
  enabled: boolean;
  profileId: string | null;
  profile: LightingProfile;
}

export type TriggerEffectKind =
  | "off"
  | "continuousResistance"
  | "sectionResistance"
  | "vibration"
  | "machineGun"
  | "raw";

export interface TriggerEffect {
  kind: TriggerEffectKind;
  startPosition?: number;
  endPosition?: number;
  force?: number;
  frequency?: number;
  rawMode?: number;
  rawParams?: number[];
}

export interface HapticProfile {
  id: string;
  name: string;
  description: string;
  category: string;
  builtIn: boolean;
  left: TriggerEffect;
  right: TriggerEffect;
}

export type AdaptiveTriggerGameId = "nfsHeat";
export type AdaptiveTriggerInputSource = "demo" | "live";
export type GameTelemetryStage =
  | "disabled"
  | "waitingForGame"
  | "gameDetected"
  | "attached"
  | "telemetryUnavailable"
  | "telemetryStale"
  | "unsupported"
  | "error";

export interface OcrCalibrationRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  referenceWidth: number;
  referenceHeight: number;
}

export interface ActiveProcessOption {
  processId: number;
  processName: string;
  windowTitle: string;
  likelyRacing: boolean;
}

export interface NeedForSpeedHeatAdaptiveTriggerSettings {
  demoSpeedKph: number;
  minSpeedKph: number;
  maxSpeedKph: number;
  brakeStartPosition: number;
  brakeEndPosition: number;
  brakeMinForce: number;
  brakeMaxForce: number;
  throttleStartPosition: number;
  throttleMinForce: number;
  throttleMaxForce: number;
  ocrCalibration: OcrCalibrationRegion | null;
  ocrProcessName: string | null;
}

export interface AdaptiveTriggerSettings {
  enabled: boolean;
  inputSource: AdaptiveTriggerInputSource;
  selectedGame: AdaptiveTriggerGameId;
  nfsHeat: NeedForSpeedHeatAdaptiveTriggerSettings;
}

export interface GameTelemetryStatus {
  enabled: boolean;
  inputSource: AdaptiveTriggerInputSource;
  selectedGame: AdaptiveTriggerGameId;
  stage: GameTelemetryStage;
  processId: number | null;
  speedKph: number | null;
  lastSpeedAtUnixMs: number | null;
  message: string;
}

export interface PersistedAppState {
  schemaVersion?: number;
  activeTab?: string;
  firmwareRiskAccepted?: boolean;
  lightingEnabled?: boolean;
  runtimeSettings?: {
    launchOnStartup: boolean;
    startupOpenMode: "normal" | "tray";
    closeToTray: boolean;
  };
  rgb?: {
    r: number;
    g: number;
    b: number;
  };
  leftTrigger?: TriggerEffect | {
    mode: number;
    force: number;
    startPos: number;
    endPos: number;
    frequency: number;
  };
  rightTrigger?: TriggerEffect | {
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
  audioSettings?: AudioSettings;
  lighting?: LightingSettings;
  adaptiveTriggers?: AdaptiveTriggerSettings;
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

export const EMULATION_TARGET_OPTIONS: Array<{
  value: ControllerEmulationTarget;
  label: string;
  description: string;
  family: EmulationFamily;
}> = [
  {
    value: "xbox360",
    label: "Xbox 360",
    description: "Classic XInput-compatible virtual pad.",
    family: "xbox",
  },
  {
    value: "xboxOne",
    label: "Xbox One",
    description: "Xbox-style virtual pad with newer device identity.",
    family: "xbox",
  },
  {
    value: "xboxSeries",
    label: "Xbox Series",
    description: "Xbox-style virtual pad tuned for newer controller profiles.",
    family: "xbox",
  },
  {
    value: "dualShock4",
    label: "DualShock 4",
    description: "Older PlayStation-style virtual pad output.",
    family: "playstation",
  },
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

export const PLAYSTATION_BUTTON_OPTIONS: Array<{ value: PlayStationButton; label: string }> = [
  { value: "cross", label: "PlayStation Cross" },
  { value: "circle", label: "PlayStation Circle" },
  { value: "square", label: "PlayStation Square" },
  { value: "triangle", label: "PlayStation Triangle" },
  { value: "l1", label: "PlayStation L1" },
  { value: "r1", label: "PlayStation R1" },
  { value: "share", label: "PlayStation Share" },
  { value: "options", label: "PlayStation Options" },
  { value: "l3", label: "PlayStation L3" },
  { value: "r3", label: "PlayStation R3" },
  { value: "ps", label: "PlayStation PS" },
  { value: "touchpad", label: "PlayStation Touchpad" },
  { value: "up", label: "PlayStation D-pad Up" },
  { value: "right", label: "PlayStation D-pad Right" },
  { value: "down", label: "PlayStation D-pad Down" },
  { value: "left", label: "PlayStation D-pad Left" },
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

export const PLAYSTATION_STICK_OPTIONS: Array<{ value: PlayStationStick; label: string }> = [
  { value: "left", label: "PlayStation Left Stick" },
  { value: "right", label: "PlayStation Right Stick" },
];

export const XBOX_TRIGGER_OPTIONS: Array<{ value: XboxTrigger; label: string }> = [
  { value: "left", label: "Xbox Left Trigger" },
  { value: "right", label: "Xbox Right Trigger" },
];

export const PLAYSTATION_TRIGGER_OPTIONS: Array<{ value: PlayStationTrigger; label: string }> = [
  { value: "left", label: "PlayStation L2" },
  { value: "right", label: "PlayStation R2" },
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

export const DEFAULT_TRIGGER_EFFECT: TriggerEffect = {
  kind: "off",
  startPosition: 0,
  endPosition: 180,
  force: 0,
  frequency: 30,
  rawMode: 0,
  rawParams: Array(10).fill(0),
};

const MAX_ADAPTIVE_TRIGGER_SPEED_KPH = 999;
const clampU8 = (value: number) => Math.max(0, Math.min(255, Math.round(value || 0)));
const clampSpeedKph = (value: number) => Math.max(0, Math.min(MAX_ADAPTIVE_TRIGGER_SPEED_KPH, Math.round(value || 0)));
const clampPositiveInt = (value: number, fallback: number) => Math.max(1, Math.round(Number.isFinite(value) ? value : fallback));
const clampRectInt = (value: number) => Math.max(0, Math.round(value || 0));

export const DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS: NeedForSpeedHeatAdaptiveTriggerSettings = {
  demoSpeedKph: 90,
  minSpeedKph: 0,
  maxSpeedKph: 280,
  brakeStartPosition: 72,
  brakeEndPosition: 188,
  brakeMinForce: 38,
  brakeMaxForce: 168,
  throttleStartPosition: 92,
  throttleMinForce: 18,
  throttleMaxForce: 92,
  ocrCalibration: null,
  ocrProcessName: null,
};

export const DEFAULT_ADAPTIVE_TRIGGER_SETTINGS: AdaptiveTriggerSettings = {
  enabled: false,
  inputSource: "demo",
  selectedGame: "nfsHeat",
  nfsHeat: { ...DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS },
};

export const EMPTY_GAME_TELEMETRY_STATUS: GameTelemetryStatus = {
  enabled: false,
  inputSource: "demo",
  selectedGame: "nfsHeat",
  stage: "disabled",
  processId: null,
  speedKph: null,
  lastSpeedAtUnixMs: null,
  message: "Adaptive trigger live telemetry is disabled.",
};

const KEY_CODE_LABELS: Record<KeyCode, string> = Object.fromEntries(
  KEY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<KeyCode, string>;

const KEYBOARD_CODE_TO_KEY_CODE: Partial<Record<string, KeyCode>> = {
  KeyA: "a",
  KeyB: "b",
  KeyC: "c",
  KeyD: "d",
  KeyE: "e",
  KeyF: "f",
  KeyG: "g",
  KeyH: "h",
  KeyI: "i",
  KeyJ: "j",
  KeyK: "k",
  KeyL: "l",
  KeyM: "m",
  KeyN: "n",
  KeyO: "o",
  KeyP: "p",
  KeyQ: "q",
  KeyR: "r",
  KeyS: "s",
  KeyT: "t",
  KeyU: "u",
  KeyV: "v",
  KeyW: "w",
  KeyX: "x",
  KeyY: "y",
  KeyZ: "z",
  Digit0: "digit0",
  Digit1: "digit1",
  Digit2: "digit2",
  Digit3: "digit3",
  Digit4: "digit4",
  Digit5: "digit5",
  Digit6: "digit6",
  Digit7: "digit7",
  Digit8: "digit8",
  Digit9: "digit9",
  Space: "space",
  Enter: "enter",
  Escape: "escape",
  Tab: "tab",
  ShiftLeft: "leftShift",
  ControlLeft: "leftCtrl",
  AltLeft: "leftAlt",
  ArrowUp: "upArrow",
  ArrowRight: "rightArrow",
  ArrowDown: "downArrow",
  ArrowLeft: "leftArrow",
};

const XBOX_TO_PLAYSTATION_BUTTON: Record<XboxButton, PlayStationButton> = {
  a: "cross",
  b: "circle",
  x: "square",
  y: "triangle",
  leftShoulder: "l1",
  rightShoulder: "r1",
  back: "share",
  start: "options",
  leftThumb: "l3",
  rightThumb: "r3",
  guide: "ps",
  up: "up",
  right: "right",
  down: "down",
  left: "left",
};

const PLAYSTATION_TO_XBOX_BUTTON: Record<PlayStationButton, XboxButton> = {
  cross: "a",
  circle: "b",
  square: "x",
  triangle: "y",
  l1: "leftShoulder",
  r1: "rightShoulder",
  share: "back",
  options: "start",
  l3: "leftThumb",
  r3: "rightThumb",
  ps: "guide",
  touchpad: "back",
  up: "up",
  right: "right",
  down: "down",
  left: "left",
};

export function cloneTriggerEffect(effect: TriggerEffect): TriggerEffect {
  return {
    ...effect,
    rawParams: effect.rawParams ? [...effect.rawParams] : undefined,
  };
}

export function cloneHapticProfile(profile: HapticProfile): HapticProfile {
  return {
    ...profile,
    left: cloneTriggerEffect(profile.left),
    right: cloneTriggerEffect(profile.right),
  };
}

export function cloneNeedForSpeedHeatAdaptiveTriggerSettings(
  settings: NeedForSpeedHeatAdaptiveTriggerSettings,
): NeedForSpeedHeatAdaptiveTriggerSettings {
  return {
    ...settings,
    ocrCalibration: settings.ocrCalibration ? { ...settings.ocrCalibration } : null,
    ocrProcessName: settings.ocrProcessName ?? null,
  };
}

export function normalizeOcrCalibrationRegion(
  region: Partial<OcrCalibrationRegion> | null | undefined,
): OcrCalibrationRegion | null {
  if (!region) {
    return null;
  }

  const referenceWidth = clampPositiveInt(region.referenceWidth ?? 0, 1);
  const referenceHeight = clampPositiveInt(region.referenceHeight ?? 0, 1);
  const x = Math.min(referenceWidth - 1, clampRectInt(region.x ?? 0));
  const y = Math.min(referenceHeight - 1, clampRectInt(region.y ?? 0));
  const maxWidth = Math.max(1, referenceWidth - x);
  const maxHeight = Math.max(1, referenceHeight - y);

  return {
    x,
    y,
    width: Math.min(maxWidth, clampPositiveInt(region.width ?? 0, maxWidth)),
    height: Math.min(maxHeight, clampPositiveInt(region.height ?? 0, maxHeight)),
    referenceWidth,
    referenceHeight,
  };
}

export function cloneAdaptiveTriggerSettings(settings: AdaptiveTriggerSettings): AdaptiveTriggerSettings {
  return {
    ...settings,
    nfsHeat: cloneNeedForSpeedHeatAdaptiveTriggerSettings(settings.nfsHeat),
  };
}

export function normalizeNeedForSpeedHeatAdaptiveTriggerSettings(
  settings: Partial<NeedForSpeedHeatAdaptiveTriggerSettings> | null | undefined,
): NeedForSpeedHeatAdaptiveTriggerSettings {
  const normalizedMinSpeed = clampSpeedKph(settings?.minSpeedKph ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.minSpeedKph);
  const normalizedMaxSpeed = Math.max(
    normalizedMinSpeed + 1,
    clampSpeedKph(settings?.maxSpeedKph ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.maxSpeedKph),
  );

  return {
    demoSpeedKph: Math.max(
      normalizedMinSpeed,
      Math.min(
        normalizedMaxSpeed,
        clampSpeedKph(settings?.demoSpeedKph ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.demoSpeedKph),
      ),
    ),
    minSpeedKph: normalizedMinSpeed,
    maxSpeedKph: normalizedMaxSpeed,
    brakeStartPosition: clampU8(
      settings?.brakeStartPosition ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.brakeStartPosition,
    ),
    brakeEndPosition: clampU8(
      settings?.brakeEndPosition ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.brakeEndPosition,
    ),
    brakeMinForce: clampU8(settings?.brakeMinForce ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.brakeMinForce),
    brakeMaxForce: clampU8(settings?.brakeMaxForce ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.brakeMaxForce),
    throttleStartPosition: clampU8(
      settings?.throttleStartPosition ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.throttleStartPosition,
    ),
    throttleMinForce: clampU8(
      settings?.throttleMinForce ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.throttleMinForce,
    ),
    throttleMaxForce: clampU8(
      settings?.throttleMaxForce ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.throttleMaxForce,
    ),
    ocrCalibration: normalizeOcrCalibrationRegion(
      settings?.ocrCalibration ?? DEFAULT_NFS_HEAT_ADAPTIVE_TRIGGER_SETTINGS.ocrCalibration,
    ),
    ocrProcessName: typeof settings?.ocrProcessName === "string" && settings.ocrProcessName.trim()
      ? settings.ocrProcessName.trim()
      : null,
  };
}

export function normalizeAdaptiveTriggerSettings(
  settings: Partial<AdaptiveTriggerSettings> | null | undefined,
): AdaptiveTriggerSettings {
  return {
    enabled: Boolean(settings?.enabled),
    inputSource: settings?.inputSource === "live" ? "live" : DEFAULT_ADAPTIVE_TRIGGER_SETTINGS.inputSource,
    selectedGame: settings?.selectedGame === "nfsHeat" ? "nfsHeat" : DEFAULT_ADAPTIVE_TRIGGER_SETTINGS.selectedGame,
    nfsHeat: normalizeNeedForSpeedHeatAdaptiveTriggerSettings(settings?.nfsHeat),
  };
}

export function normalizeTriggerEffect(effect: TriggerEffect): TriggerEffect {
  const rawParams = Array.from({ length: 10 }, (_, index) => effect.rawParams?.[index] ?? 0);
  return {
    kind: effect.kind,
    startPosition: Math.max(0, Math.min(255, Math.round(effect.startPosition ?? DEFAULT_TRIGGER_EFFECT.startPosition ?? 0))),
    endPosition: Math.max(0, Math.min(255, Math.round(effect.endPosition ?? DEFAULT_TRIGGER_EFFECT.endPosition ?? 180))),
    force: Math.max(0, Math.min(255, Math.round(effect.force ?? DEFAULT_TRIGGER_EFFECT.force ?? 0))),
    frequency: Math.max(0, Math.min(255, Math.round(effect.frequency ?? DEFAULT_TRIGGER_EFFECT.frequency ?? 30))),
    rawMode: Math.max(0, Math.min(255, Math.round(effect.rawMode ?? DEFAULT_TRIGGER_EFFECT.rawMode ?? 0))),
    rawParams,
  };
}

export function migrateLegacyTriggerEffect(
  effect:
    | TriggerEffect
    | {
        mode: number;
        force: number;
        startPos: number;
        endPos: number;
        frequency: number;
      }
    | null
    | undefined,
): TriggerEffect {
  if (!effect) {
    return cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT);
  }

  if ("kind" in effect) {
    return normalizeTriggerEffect(effect);
  }

  const mode = Math.max(0, Math.min(255, Math.round(effect.mode ?? 0)));
  const migrated: TriggerEffect = {
    kind:
      mode === 1
        ? "continuousResistance"
        : mode === 2
          ? "sectionResistance"
          : mode === 6
            ? "vibration"
            : mode === 39
              ? "machineGun"
              : "off",
    startPosition: effect.startPos,
    endPosition: effect.endPos,
    force: effect.force,
    frequency: effect.frequency,
    rawMode: mode,
    rawParams: Array(10).fill(0),
  };

  return normalizeTriggerEffect(migrated);
}

export function cloneMappingProfile(profile: MappingProfile): MappingProfile {
  return {
    ...profile,
    buttonBindings: { ...profile.buttonBindings },
    leftStick: { ...profile.leftStick },
    rightStick: { ...profile.rightStick },
    leftTrigger: { ...profile.leftTrigger },
    rightTrigger: { ...profile.rightTrigger },
  };
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
  return {
    leftStick: { ...profile.leftStick },
    rightStick: { ...profile.rightStick },
    leftTrigger: { ...profile.leftTrigger },
    rightTrigger: { ...profile.rightTrigger },
  };
}

export function getEmulationFamily(target: ControllerEmulationTarget): EmulationFamily {
  return target === "dualShock4" ? "playstation" : "xbox";
}

export function getEmulationTargetDetails(target: ControllerEmulationTarget) {
  return EMULATION_TARGET_OPTIONS.find((option) => option.value === target) ?? EMULATION_TARGET_OPTIONS[0];
}

export function getKeyCodeLabel(key: KeyCode) {
  return KEY_CODE_LABELS[key] ?? key;
}

export function translateKeyboardCodeToKeyCode(code: string): KeyCode | null {
  return KEYBOARD_CODE_TO_KEY_CODE[code] ?? null;
}

export function getControllerButtonBindingTypeForTarget(
  target: ControllerEmulationTarget,
): Extract<ButtonBindingTarget, { type: "xboxButton" | "playstationButton" }>["type"] {
  return getEmulationFamily(target) === "playstation" ? "playstationButton" : "xboxButton";
}

export function getControllerStickBindingTypeForTarget(
  target: ControllerEmulationTarget,
): Extract<StickBinding, { type: "xboxStick" | "playstationStick" }>["type"] {
  return getEmulationFamily(target) === "playstation" ? "playstationStick" : "xboxStick";
}

export function getControllerTriggerBindingTypeForTarget(
  target: ControllerEmulationTarget,
): Extract<TriggerBinding, { type: "xboxTrigger" | "playstationTrigger" }>["type"] {
  return getEmulationFamily(target) === "playstation" ? "playstationTrigger" : "xboxTrigger";
}

export function createButtonBindingTarget(
  type: ButtonBindingTarget["type"],
  current: ButtonBindingTarget,
): ButtonBindingTarget {
  switch (type) {
    case "disabled":
      return { type: "disabled" };
    case "xboxButton":
      return {
        type: "xboxButton",
        button: current.type === "xboxButton" ? current.button : "a",
      };
    case "playstationButton":
      return {
        type: "playstationButton",
        button: current.type === "playstationButton" ? current.button : "cross",
      };
    case "keyboardKey":
      return {
        type: "keyboardKey",
        key: current.type === "keyboardKey" ? current.key : "space",
      };
    case "mouseButton":
      return {
        type: "mouseButton",
        button: current.type === "mouseButton" ? current.button : "left",
      };
  }
}

function convertButtonBindingTarget(
  binding: ButtonBindingTarget,
  nextFamily: EmulationFamily,
): ButtonBindingTarget {
  if (binding.type === "xboxButton" && nextFamily === "playstation") {
    return {
      type: "playstationButton",
      button: XBOX_TO_PLAYSTATION_BUTTON[binding.button],
    };
  }

  if (binding.type === "playstationButton" && nextFamily === "xbox") {
    return {
      type: "xboxButton",
      button: PLAYSTATION_TO_XBOX_BUTTON[binding.button],
    };
  }

  return binding;
}

function convertStickBinding(binding: StickBinding, nextFamily: EmulationFamily): StickBinding {
  if (binding.type === "xboxStick" && nextFamily === "playstation") {
    return {
      type: "playstationStick",
      stick: binding.stick,
    };
  }

  if (binding.type === "playstationStick" && nextFamily === "xbox") {
    return {
      type: "xboxStick",
      stick: binding.stick,
    };
  }

  return binding;
}

function convertTriggerBinding(binding: TriggerBinding, nextFamily: EmulationFamily): TriggerBinding {
  if (binding.type === "xboxTrigger" && nextFamily === "playstation") {
    return {
      type: "playstationTrigger",
      trigger: binding.trigger,
    };
  }

  if (binding.type === "playstationTrigger" && nextFamily === "xbox") {
    return {
      type: "xboxTrigger",
      trigger: binding.trigger,
    };
  }

  return binding;
}

function isControllerEmulationTarget(value: unknown): value is ControllerEmulationTarget {
  return EMULATION_TARGET_OPTIONS.some((option) => option.value === value);
}

export function inferMappingProfileEmulationTarget(profile: Partial<MappingProfile> | null | undefined): ControllerEmulationTarget {
  if (profile?.leftStick?.type === "playstationStick" || profile?.rightStick?.type === "playstationStick") {
    return "dualShock4";
  }
  if (profile?.leftTrigger?.type === "playstationTrigger" || profile?.rightTrigger?.type === "playstationTrigger") {
    return "dualShock4";
  }
  if (Object.values(profile?.buttonBindings ?? {}).some((binding) => binding?.type === "playstationButton")) {
    return "dualShock4";
  }

  return "xbox360";
}

export function normalizeMappingProfile(profile: MappingProfile): MappingProfile {
  const emulationTarget = isControllerEmulationTarget(profile.emulationTarget)
    ? profile.emulationTarget
    : inferMappingProfileEmulationTarget(profile);

  return {
    ...cloneMappingProfile({
      ...profile,
      emulationTarget,
    }),
    builtIn: Boolean(profile.builtIn),
  };
}

export function convertMappingProfileEmulationTarget(
  profile: MappingProfile,
  emulationTarget: ControllerEmulationTarget,
): MappingProfile {
  const nextFamily = getEmulationFamily(emulationTarget);
  const normalized = normalizeMappingProfile(profile);
  const nextBindings = Object.fromEntries(
    Object.entries(normalized.buttonBindings).map(([button, binding]) => [
      button,
      binding ? convertButtonBindingTarget(binding, nextFamily) : binding,
    ]),
  ) as Partial<Record<ControllerButton, ButtonBindingTarget>>;

  return {
    ...normalized,
    emulationTarget,
    buttonBindings: nextBindings,
    leftStick: convertStickBinding(normalized.leftStick, nextFamily),
    rightStick: convertStickBinding(normalized.rightStick, nextFamily),
    leftTrigger: convertTriggerBinding(normalized.leftTrigger, nextFamily),
    rightTrigger: convertTriggerBinding(normalized.rightTrigger, nextFamily),
  };
}
