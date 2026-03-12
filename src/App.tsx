import { useEffect, useRef, useState } from "react";
import {
  Battery,
  ChevronDown,
  Gamepad2,
  Keyboard,
  Minus,
  MousePointer,
  Palette,
  Pencil,
  Plus,
  Power,
  Save,
  Settings,
  Sliders,
  Square,
  Trash2,
  Usb,
  X,
  Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BaseDirectory, writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import winSenseMark from "../winsense-square.png";
import {
  CONTROLLER_BUTTONS,
  DEFAULT_CALIBRATION_PROFILE,
  EMPTY_LIVE_INPUT,
  EMPTY_FIRMWARE_STATUS,
  KEY_OPTIONS,
  MOUSE_BUTTON_OPTIONS,
  XBOX_BUTTON_OPTIONS,
  XBOX_STICK_OPTIONS,
  XBOX_TRIGGER_OPTIONS,
  cloneCalibrationProfile,
  cloneMappingProfile,
  getButtonBinding,
  toManualProfile,
} from "./mapping";
import "./App.css";
import type {
  CalibrationCapabilities,
  CalibrationProfile,
  ButtonBindingTarget,
  ControllerButton,
  FirmwareCalibrationStatus,
  KeyCode,
  LiveInputSnapshot,
  MappingProfile,
  MouseButton,
  PersistedAppState,
  StickBinding,
  StickSnapshot,
  TriggerBinding,
  TriggerSnapshot,
  XboxButton,
  XboxStick,
  XboxTrigger,
} from "./mapping";

const appWindow = getCurrentWindow();

interface TriggerConfig {
  mode: number;
  force: number;
  startPos: number;
  endPos: number;
  frequency: number;
}

interface HapticProfile {
  id: string;
  name: string;
  builtIn: boolean;
  left: TriggerConfig;
  right: TriggerConfig;
}

type StartupOpenMode = "normal" | "tray";

interface ToastState {
  title: string;
  message: string;
  tone: "success" | "error";
}

const DEFAULT_TRIGGER: TriggerConfig = { mode: 0, force: 0, startPos: 0, endPos: 180, frequency: 30 };

const BUILTIN_PROFILES: HapticProfile[] = [
  {
    id: "builtin-fps", name: "FPS Resistance", builtIn: true,
    left: { mode: 2, force: 180, startPos: 60, endPos: 160, frequency: 30 },
    right: { mode: 2, force: 200, startPos: 40, endPos: 180, frequency: 30 },
  },
  {
    id: "builtin-racing", name: "Racing Vibration", builtIn: true,
    left: { mode: 6, force: 140, startPos: 0, endPos: 180, frequency: 40 },
    right: { mode: 6, force: 160, startPos: 0, endPos: 180, frequency: 25 },
  },
  {
    id: "builtin-heavy", name: "Heavy Feedback", builtIn: true,
    left: { mode: 39, force: 200, startPos: 0, endPos: 255, frequency: 30 },
    right: { mode: 39, force: 220, startPos: 0, endPos: 255, frequency: 35 },
  },
];

const MODE_LABELS: Record<number, string> = {
  0: "Normal (Off)",
  1: "Continuous Resistance",
  2: "Section Resistance",
  6: "Vibration",
  39: "Machine Gun",
};

function generateId() {
  return "hp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function generateMappingProfileId() {
  return "mp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const clampU8 = (v: number) => Math.max(0, Math.min(255, Math.round(v || 0)));
const APP_STATE_FILE = "app-state.json";
const HAPTIC_PROFILES_FILE = "haptic-profiles.json";
const MAPPING_PROFILES_FILE = "mapping-profiles.json";
const LEGACY_PROFILE_FILE = "profile.json";
const AUTOSAVE_DELAY_MS = 450;
const TOAST_DURATION_MS = 2800;

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isConnected, setIsConnected] = useState(false);
  const [lightingEnabled, setLightingEnabled] = useState(true);
  const [rgb, setRgb] = useState({ r: 0, g: 0, b: 255 });
  const [leftTrigger, setLeftTrigger] = useState<TriggerConfig>({ ...DEFAULT_TRIGGER });
  const [rightTrigger, setRightTrigger] = useState<TriggerConfig>({ ...DEFAULT_TRIGGER });
  const [touchpadEnabled, setTouchpadEnabled] = useState(false);
  const [touchpadSensitivity, setTouchpadSensitivity] = useState(1.0);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [startupOpenMode, setStartupOpenMode] = useState<StartupOpenMode>("normal");
  const [closeToTray, setCloseToTray] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [hapticProfiles, setHapticProfiles] = useState<HapticProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<HapticProfile | null>(null);
  const [mappingPresets, setMappingPresets] = useState<MappingProfile[]>([]);
  const [customMappingProfiles, setCustomMappingProfiles] = useState<MappingProfile[]>([]);
  const [mappingProfile, setMappingProfile] = useState<MappingProfile | null>(null);
  const [activeMappingProfileId, setActiveMappingProfileId] = useState<string | null>(null);
  const [editingMappingProfile, setEditingMappingProfile] = useState<MappingProfile | null>(null);
  const [calibrationProfile, setCalibrationProfile] = useState<CalibrationProfile>(DEFAULT_CALIBRATION_PROFILE);
  const [liveInput, setLiveInput] = useState<LiveInputSnapshot>(EMPTY_LIVE_INPUT);
  const [calibrationCapabilities, setCalibrationCapabilities] = useState<CalibrationCapabilities | null>(null);
  const [firmwareStatus, setFirmwareStatus] = useState<FirmwareCalibrationStatus>(EMPTY_FIRMWARE_STATUS);
  const [firmwareRiskAccepted, setFirmwareRiskAccepted] = useState(false);

  const pendingLightbarRef = useRef<{ r: number; g: number; b: number } | null>(null);
  const pendingTriggersRef = useRef<{ lt: TriggerConfig; rt: TriggerConfig } | null>(null);
  const rafIdRef = useRef(0);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const hasLoadedPersistenceRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    void initializeApp();

    const statusUnlisten = listen<boolean>("controller-status", (event) => {
      setIsConnected(event.payload);
    });
    const inputUnlisten = listen<LiveInputSnapshot>("controller-input", (event) => {
      setLiveInput(event.payload);
    });
    const firmwareUnlisten = listen<FirmwareCalibrationStatus>("firmware-calibration-status", (event) => {
      setFirmwareStatus(event.payload);
    });

    return () => {
      statusUnlisten.then(f => f());
      inputUnlisten.then(f => f());
      firmwareUnlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistenceRef.current || !mappingProfile) {
      return;
    }

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(() => {
      autosaveTimeoutRef.current = null;
      void saveAppState();
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, [
    activeMappingProfileId,
    activeProfileId,
    activeTab,
    calibrationProfile,
    closeToTray,
    firmwareRiskAccepted,
    launchOnStartup,
    leftTrigger,
    lightingEnabled,
    mappingProfile,
    rgb,
    rightTrigger,
    startupOpenMode,
    touchpadEnabled,
    touchpadSensitivity,
  ]);

  useEffect(() => {
    if (!hasLoadedPersistenceRef.current) {
      return;
    }

    void syncRuntimeSettings(closeToTray, startupOpenMode);
  }, [closeToTray, startupOpenMode]);

  const initializeApp = async () => {
    try {
      const [presets, backendProfile, backendCalibration, liveSnapshot, capabilities, fwStatus, status] = await Promise.all([
        invoke<MappingProfile[]>("get_mapping_presets"),
        invoke<MappingProfile>("get_mapping_profile"),
        invoke<CalibrationProfile>("get_calibration_profile"),
        invoke<LiveInputSnapshot>("get_live_input_snapshot"),
        invoke<CalibrationCapabilities>("get_calibration_capabilities"),
        invoke<FirmwareCalibrationStatus>("get_firmware_calibration_status"),
        invoke<boolean>("get_controller_status"),
      ]);

      setMappingPresets(presets);
      setCalibrationCapabilities(capabilities);
      setLiveInput(liveSnapshot);
      setFirmwareStatus(fwStatus);
      setIsConnected(status);

      const [loadedHaptics, loadedCustomMappings] = await Promise.all([
        loadHapticProfiles(),
        loadMappingProfiles(),
      ]);

      await loadAppState(backendProfile, backendCalibration, presets, loadedCustomMappings, loadedHaptics);
      try {
        setLaunchOnStartup(await isAutostartEnabled());
      } catch (error) {
        console.error("Failed to read autostart state:", error);
      }
      hasLoadedPersistenceRef.current = true;
    } catch (e) {
      console.error("Failed to initialize app state:", e);
    }
  };

  const flushIpc = () => {
    rafIdRef.current = 0;
    const lb = pendingLightbarRef.current;
    if (lb) {
      invoke("set_lightbar", lb).catch(console.error);
      pendingLightbarRef.current = null;
    }
    const tg = pendingTriggersRef.current;
    if (tg) {
      invoke("set_triggers", {
        leftMode: clampU8(tg.lt.mode), leftForce: clampU8(tg.lt.force), leftStart: clampU8(tg.lt.startPos), leftEnd: clampU8(tg.lt.endPos), leftFrequency: clampU8(tg.lt.frequency),
        rightMode: clampU8(tg.rt.mode), rightForce: clampU8(tg.rt.force), rightStart: clampU8(tg.rt.startPos), rightEnd: clampU8(tg.rt.endPos), rightFrequency: clampU8(tg.rt.frequency),
      }).catch(console.error);
      pendingTriggersRef.current = null;
    }
  };

  const scheduleIpcFlush = () => {
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(flushIpc);
    }
  };

  const sendTriggers = (lt: TriggerConfig, rt: TriggerConfig) => {
    invoke("set_triggers", {
      leftMode: clampU8(lt.mode), leftForce: clampU8(lt.force), leftStart: clampU8(lt.startPos), leftEnd: clampU8(lt.endPos), leftFrequency: clampU8(lt.frequency),
      rightMode: clampU8(rt.mode), rightForce: clampU8(rt.force), rightStart: clampU8(rt.startPos), rightEnd: clampU8(rt.endPos), rightFrequency: clampU8(rt.frequency),
    }).catch(console.error);
  };

  const readJsonFile = async <T,>(fileName: string, baseDir: BaseDirectory): Promise<T | null> => {
    try {
      const contents = await readTextFile(fileName, { baseDir });
      return JSON.parse(contents) as T;
    } catch {
      return null;
    }
  };

  const writeJsonFile = async (fileName: string, value: unknown, baseDir: BaseDirectory = BaseDirectory.AppData) => {
    await writeTextFile(fileName, JSON.stringify(value, null, 2), { baseDir });
  };

  const loadPersistedJson = async <T,>(fileName: string, legacyFileName: string = fileName): Promise<T | null> => {
    const appDataValue = await readJsonFile<T>(fileName, BaseDirectory.AppData);
    if (appDataValue !== null) {
      return appDataValue;
    }

    const legacyValue = await readJsonFile<T>(legacyFileName, BaseDirectory.AppConfig);
    if (legacyValue !== null) {
      try {
        await writeJsonFile(fileName, legacyValue);
      } catch (error) {
        console.error(`Failed to migrate ${legacyFileName} to AppData:`, error);
      }
    }
    return legacyValue;
  };

  const showToast = (nextToast: ToastState) => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToast(nextToast);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, TOAST_DURATION_MS);
  };

  const syncRuntimeSettings = async (nextCloseToTray: boolean, nextStartupOpenMode: StartupOpenMode) => {
    try {
      await invoke("sync_runtime_settings", {
        closeToTray: nextCloseToTray,
        startupOpenMode: nextStartupOpenMode,
      });
    } catch (error) {
      console.error("Failed to sync runtime settings:", error);
    }
  };

  const buildPersistedAppState = (): PersistedAppState => ({
    activeTab,
    firmwareRiskAccepted,
    lightingEnabled,
    rgb,
    leftTrigger,
    rightTrigger,
    activeProfileId,
    touchpadEnabled,
    touchpadSensitivity,
    activeMappingProfileId,
    manualMappingProfile: activeMappingProfileId ? null : mappingProfile,
    calibrationProfile,
    launchOnStartup,
    startupOpenMode,
    closeToTray,
  });

  const saveAppState = async (notify = false) => {
    try {
      await writeJsonFile(APP_STATE_FILE, buildPersistedAppState());
      if (notify) {
        showToast({
          title: "Profile saved",
          message: "Your WinSense settings were saved successfully.",
          tone: "success",
        });
      }
    } catch (e) {
      console.error("Failed to save app state:", e);
      showToast({
        title: "Save failed",
        message: "WinSense could not save your settings.",
        tone: "error",
      });
    }
  };

  const loadHapticProfiles = async () => {
    const parsed = await loadPersistedJson<HapticProfile[]>(HAPTIC_PROFILES_FILE);
    if (Array.isArray(parsed) && parsed.length > 0) {
      setHapticProfiles(parsed);
      return parsed;
    }

    const seededProfiles = [...BUILTIN_PROFILES];
    setHapticProfiles(seededProfiles);
    try {
      await saveHapticProfilesList(seededProfiles);
    } catch (error) {
      console.error("Failed to seed haptic profiles:", error);
    }
    return seededProfiles;
  };

  const saveHapticProfilesList = async (profiles: HapticProfile[]) => {
    try {
      await writeJsonFile(HAPTIC_PROFILES_FILE, profiles);
    } catch (e) {
      console.error("Failed to save haptic profiles:", e);
    }
  };

  const loadMappingProfiles = async () => {
    const parsed = await loadPersistedJson<MappingProfile[]>(MAPPING_PROFILES_FILE);
    if (Array.isArray(parsed)) {
      const customOnly = parsed.filter((profile) => !profile.builtIn);
      setCustomMappingProfiles(customOnly);
      return customOnly;
    }

    setCustomMappingProfiles([]);
    return [] as MappingProfile[];
  };

  const saveMappingProfilesList = async (profiles: MappingProfile[]) => {
    try {
      await writeJsonFile(MAPPING_PROFILES_FILE, profiles);
    } catch (e) {
      console.error("Failed to save mapping profiles:", e);
    }
  };

  const commitMappingProfile = (profile: MappingProfile, profileId: string | null = null) => {
    const next = cloneMappingProfile(profile);
    setMappingProfile(next);
    setActiveMappingProfileId(profileId);
    invoke("set_mapping_profile", { profile: next }).catch(console.error);
  };

  const commitCalibrationProfile = (profile: CalibrationProfile) => {
    const next = cloneCalibrationProfile(profile);
    setCalibrationProfile(next);
    invoke("set_calibration_profile", { profile: next }).catch(console.error);
  };

  const loadAppState = async (
    defaultMappingProfile: MappingProfile,
    defaultCalibration: CalibrationProfile,
    builtInMappingPresets: MappingProfile[],
    loadedCustomMappings: MappingProfile[],
    loadedHaptics: HapticProfile[],
  ) => {
    const data = await loadPersistedJson<PersistedAppState>(APP_STATE_FILE, LEGACY_PROFILE_FILE);
    const resolvedState = data ?? {};
    const nextStartupOpenMode: StartupOpenMode = resolvedState.startupOpenMode === "tray" ? "tray" : "normal";
    const nextCloseToTray = Boolean(resolvedState.closeToTray);
    const nextLaunchOnStartup = Boolean(resolvedState.launchOnStartup);

    if (resolvedState.activeTab) {
      setActiveTab(resolvedState.activeTab);
    }

    if (resolvedState.firmwareRiskAccepted !== undefined) {
      setFirmwareRiskAccepted(Boolean(resolvedState.firmwareRiskAccepted));
    }

    if (resolvedState.rgb && typeof resolvedState.rgb === "object") {
      const { r, g, b } = resolvedState.rgb;
      setRgb({ r, g, b });
      if (resolvedState.lightingEnabled !== false) {
        invoke("set_lightbar", { r, g, b }).catch(console.error);
      }
    }
    if (resolvedState.lightingEnabled !== undefined) {
      setLightingEnabled(Boolean(resolvedState.lightingEnabled));
    }
    const lt: TriggerConfig = resolvedState.leftTrigger
      ? { ...DEFAULT_TRIGGER, ...resolvedState.leftTrigger }
      : { ...DEFAULT_TRIGGER };
    const rt: TriggerConfig = resolvedState.rightTrigger
      ? { ...DEFAULT_TRIGGER, ...resolvedState.rightTrigger }
      : { ...DEFAULT_TRIGGER };
    setLeftTrigger(lt);
    setRightTrigger(rt);
    sendTriggers(lt, rt);

    if (resolvedState.activeProfileId !== undefined) {
      setActiveProfileId(resolvedState.activeProfileId ?? null);
      const selectedHaptic = loadedHaptics.find((profile) => profile.id === resolvedState.activeProfileId);
      if (selectedHaptic) {
        setLeftTrigger({ ...selectedHaptic.left });
        setRightTrigger({ ...selectedHaptic.right });
        sendTriggers(selectedHaptic.left, selectedHaptic.right);
      }
    }

    if (resolvedState.touchpadEnabled !== undefined) {
      setTouchpadEnabled(Boolean(resolvedState.touchpadEnabled));
      invoke("set_touchpad_enabled", { enabled: resolvedState.touchpadEnabled }).catch(console.error);
    }

    if (resolvedState.touchpadSensitivity !== undefined) {
      setTouchpadSensitivity(resolvedState.touchpadSensitivity);
      invoke("set_touchpad_sensitivity", { sensitivity: resolvedState.touchpadSensitivity }).catch(console.error);
    }

    setLaunchOnStartup(nextLaunchOnStartup);
    setStartupOpenMode(nextStartupOpenMode);
    setCloseToTray(nextCloseToTray);

    const allMappingProfiles = [...builtInMappingPresets, ...loadedCustomMappings];
    if (resolvedState.activeMappingProfileId) {
      const activeProfile = allMappingProfiles.find((profile) => profile.id === resolvedState.activeMappingProfileId);
      if (activeProfile) {
        commitMappingProfile(activeProfile, activeProfile.id);
      } else if (resolvedState.manualMappingProfile) {
        commitMappingProfile(toManualProfile(resolvedState.manualMappingProfile), null);
      } else {
        commitMappingProfile(defaultMappingProfile, defaultMappingProfile.builtIn ? defaultMappingProfile.id : null);
      }
    } else if (resolvedState.manualMappingProfile && typeof resolvedState.manualMappingProfile === "object") {
      commitMappingProfile(toManualProfile(resolvedState.manualMappingProfile), null);
    } else {
      commitMappingProfile(defaultMappingProfile, defaultMappingProfile.builtIn ? defaultMappingProfile.id : null);
    }

    if (resolvedState.calibrationProfile && typeof resolvedState.calibrationProfile === "object") {
      commitCalibrationProfile(resolvedState.calibrationProfile);
    } else {
      commitCalibrationProfile(defaultCalibration);
    }

    await syncRuntimeSettings(nextCloseToTray, nextStartupOpenMode);
  };

  const saveProfile = async () => {
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    await saveAppState(true);
  };

  const toggleLaunchOnStartup = async () => {
    const nextValue = !launchOnStartup;
    setLaunchOnStartup(nextValue);

    try {
      if (nextValue) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      showToast({
        title: nextValue ? "Startup enabled" : "Startup disabled",
        message: nextValue ? "WinSense will launch automatically when Windows starts." : "WinSense will no longer launch automatically on startup.",
        tone: "success",
      });
    } catch (error) {
      console.error("Failed to update autostart setting:", error);
      setLaunchOnStartup(!nextValue);
      showToast({
        title: "Startup setting failed",
        message: "WinSense could not update the startup registration.",
        tone: "error",
      });
    }
  };

  const selectStartupOpenMode = (mode: StartupOpenMode) => {
    setStartupOpenMode(mode);
  };

  const toggleCloseToTray = () => {
    const nextValue = !closeToTray;
    setCloseToTray(nextValue);
    showToast({
      title: nextValue ? "Close to tray enabled" : "Close to tray disabled",
      message: nextValue ? "Closing WinSense will hide it to the tray and keep it running." : "Closing WinSense will fully exit the application.",
      tone: "success",
    });
  };

  const handleColorChange = (color: string, value: number) => {
    const newRgb = { ...rgb, [color]: value };
    setRgb(newRgb);
    if (lightingEnabled) {
      pendingLightbarRef.current = { r: newRgb.r, g: newRgb.g, b: newRgb.b };
      scheduleIpcFlush();
    }
  };

  const toggleLighting = async () => {
    const newState = !lightingEnabled;
    setLightingEnabled(newState);
    try {
      if (newState) {
        await invoke("set_lightbar", { r: rgb.r, g: rgb.g, b: rgb.b });
      } else {
        await invoke("set_lightbar", { r: 0, g: 0, b: 0 });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTriggerChange = (side: 'left' | 'right', field: keyof TriggerConfig, value: number) => {
    setActiveProfileId(null);
    let newLeft = leftTrigger;
    let newRight = rightTrigger;
    if (side === 'left') {
      newLeft = { ...leftTrigger, [field]: value };
      setLeftTrigger(newLeft);
    } else {
      newRight = { ...rightTrigger, [field]: value };
      setRightTrigger(newRight);
    }
    pendingTriggersRef.current = { lt: newLeft, rt: newRight };
    scheduleIpcFlush();
  };

  const applyHapticProfile = (profile: HapticProfile) => {
    setActiveProfileId(profile.id);
    setLeftTrigger({ ...profile.left });
    setRightTrigger({ ...profile.right });
    sendTriggers(profile.left, profile.right);
  };

  const saveHapticProfile = (profile: HapticProfile) => {
    const existing = hapticProfiles.findIndex(p => p.id === profile.id);
    let updated: HapticProfile[];
    if (existing >= 0) {
      updated = hapticProfiles.map(p => p.id === profile.id ? profile : p);
    } else {
      updated = [...hapticProfiles, profile];
    }
    setHapticProfiles(updated);
    saveHapticProfilesList(updated);
    setEditingProfile(null);
  };

  const deleteHapticProfile = (id: string) => {
    const updated = hapticProfiles.filter(p => p.id !== id);
    setHapticProfiles(updated);
    saveHapticProfilesList(updated);
    if (activeProfileId === id) setActiveProfileId(null);
  };

  const toggleTouchpad = async () => {
    const newState = !touchpadEnabled;
    setTouchpadEnabled(newState);
    try {
      await invoke("set_touchpad_enabled", { enabled: newState });
    } catch (e) { console.error(e); }
  };

  const handleSensitivityChange = async (value: number) => {
    setTouchpadSensitivity(value);
    try {
      await invoke("set_touchpad_sensitivity", { sensitivity: value });
    } catch (e) { console.error(e); }
  };

  const persistCustomMappingProfiles = (profiles: MappingProfile[]) => {
    const normalized = profiles.map((profile) => ({ ...cloneMappingProfile(profile), builtIn: false }));
    setCustomMappingProfiles(normalized);
    void saveMappingProfilesList(normalized);
  };

  const getCustomMappingProfile = (id: string | null) =>
    id ? customMappingProfiles.find((profile) => profile.id === id) ?? null : null;

  const updateCurrentMappingProfile = (updater: (profile: MappingProfile) => MappingProfile) => {
    if (!mappingProfile) return;

    const currentCustomProfile = getCustomMappingProfile(activeMappingProfileId);
    if (currentCustomProfile) {
      const next = { ...updater(cloneMappingProfile(currentCustomProfile)), id: currentCustomProfile.id, builtIn: false };
      const updatedProfiles = customMappingProfiles.map((profile) => profile.id === next.id ? next : profile);
      persistCustomMappingProfiles(updatedProfiles);
      commitMappingProfile(next, next.id);
      if (editingMappingProfile?.id === next.id) {
        setEditingMappingProfile(cloneMappingProfile(next));
      }
      return;
    }

    const next = updater(toManualProfile(mappingProfile));
    commitMappingProfile(toManualProfile(next), null);
  };

  const applyMappingPreset = (presetId: string) => {
    const preset = [...mappingPresets, ...customMappingProfiles].find((item) => item.id === presetId);
    if (!preset) return;
    commitMappingProfile(preset, preset.id);
  };

  const createMappingProfileFromCurrent = () => {
    if (!mappingProfile) return;
    setEditingMappingProfile({
      ...cloneMappingProfile(mappingProfile),
      id: generateMappingProfileId(),
      name: "",
      builtIn: false,
    });
  };

  const saveMappingLibraryProfile = (profile: MappingProfile) => {
    const nextProfile = { ...cloneMappingProfile(profile), builtIn: false };
    const exists = customMappingProfiles.some((item) => item.id === nextProfile.id);
    const updatedProfiles = exists
      ? customMappingProfiles.map((item) => item.id === nextProfile.id ? nextProfile : item)
      : [...customMappingProfiles, nextProfile];

    persistCustomMappingProfiles(updatedProfiles);
    setEditingMappingProfile(null);

    if (activeMappingProfileId === nextProfile.id) {
      commitMappingProfile(nextProfile, nextProfile.id);
    }
  };

  const deleteMappingLibraryProfile = (id: string) => {
    const updatedProfiles = customMappingProfiles.filter((profile) => profile.id !== id);
    persistCustomMappingProfiles(updatedProfiles);
    if (editingMappingProfile?.id === id) {
      setEditingMappingProfile(null);
    }
    if (activeMappingProfileId === id && mappingProfile) {
      commitMappingProfile(toManualProfile(mappingProfile), null);
    }
  };

  const loadCustomMappingProfileForEditing = (profile: MappingProfile) => {
    setEditingMappingProfile(cloneMappingProfile(profile));
  };

  const handleButtonBindingTypeChange = (button: ControllerButton, type: ButtonBindingTarget["type"]) => {
    updateCurrentMappingProfile(profile => {
      const next = cloneMappingProfile(profile);
      const binding = getButtonBinding(next, button);
      next.buttonBindings[button] = createButtonBindingTarget(type, binding);
      return next;
    });
  };

  const handleButtonBindingValueChange = (button: ControllerButton, binding: ButtonBindingTarget) => {
    updateCurrentMappingProfile(profile => {
      const next = cloneMappingProfile(profile);
      next.buttonBindings[button] = binding;
      return next;
    });
  };

  const handleStickBindingChange = (side: "leftStick" | "rightStick", binding: StickBinding) => {
    updateCurrentMappingProfile(profile => ({ ...cloneMappingProfile(profile), [side]: binding }));
  };

  const handleTriggerBindingChange = (side: "leftTrigger" | "rightTrigger", binding: TriggerBinding) => {
    updateCurrentMappingProfile(profile => ({ ...cloneMappingProfile(profile), [side]: binding }));
  };

  const updateCalibration = (updater: (profile: CalibrationProfile) => CalibrationProfile) => {
    const next = updater(cloneCalibrationProfile(calibrationProfile));
    commitCalibrationProfile(next);
  };

  const setStickCenterFromCurrent = (side: "leftStick" | "rightStick") => {
    const snapshot = liveInput[side];
    updateCalibration(profile => ({
      ...profile,
      [side]: {
        ...profile[side],
        centerX: snapshot.normalizedX,
        centerY: snapshot.normalizedY,
      },
    }));
  };

  const resetCalibration = () => {
    commitCalibrationProfile(DEFAULT_CALIBRATION_PROFILE);
  };

  const runFirmwareCommand = async (command: string) => {
    try {
      const status = await invoke<FirmwareCalibrationStatus>(command);
      setFirmwareStatus(status);
    } catch (e) {
      console.error(`Failed to run firmware calibration command "${command}":`, e);
    }
  };

  const testRumble = async () => {
    try {
      await invoke("set_rumble", { left: 255, right: 255 });
      setTimeout(async () => {
        await invoke("set_rumble", { left: 0, right: 0 });
      }, 500);
    } catch (e) { console.error(e); }
  };

  const startWindowDrag = async () => {
    try {
      await appWindow.startDragging();
    } catch (e) {
      console.error("Failed to start dragging window:", e);
    }
  };

  const minimizeWindow = async () => {
    try {
      await appWindow.minimize();
    } catch (e) {
      console.error("Failed to minimize window:", e);
    }
  };

  const toggleMaximizeWindow = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch (e) {
      console.error("Failed to toggle maximize:", e);
    }
  };

  const closeWindow = async () => {
    try {
      await appWindow.close();
    } catch (e) {
      console.error("Failed to close window:", e);
    }
  };

  return (
    <div className="h-screen bg-[#0a0a0a] text-white flex flex-col overflow-hidden relative border border-white/10 rounded-xl">
      {toast && (
        <div className="absolute right-6 top-14 z-[90] w-full max-w-sm pointer-events-none">
          <div
            className={`rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-3 duration-300 ${
              toast.tone === "success"
                ? "border-emerald-400/30 bg-emerald-500/10"
                : "border-red-400/30 bg-red-500/10"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  toast.tone === "success" ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <div>
                <p className="text-sm font-semibold text-white">{toast.title}</p>
                <p className="mt-1 text-sm text-white/70">{toast.message}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Custom Titlebar */}
      <div
        data-tauri-drag-region
        className="h-10 shrink-0 flex items-center justify-between px-4 bg-[#0a0a0a] border-b border-white/5 select-none z-50"
        onDoubleClick={() => void toggleMaximizeWindow()}
      >
        <div
          data-tauri-drag-region
          className="flex min-w-0 flex-1 items-center gap-2 text-white/70 cursor-move"
          onMouseDown={(e) => {
            if (e.button === 0) {
              void startWindowDrag();
            }
          }}
        >
          <img src={winSenseMark} alt="" className="h-4 w-4 rounded-sm object-cover object-top" draggable={false} />
          <span className="text-xs font-medium tracking-wide">WinSense</span>
        </div>
        <div
          data-tauri-drag-region
          className="mx-4 h-full flex-1 cursor-move"
          onMouseDown={(e) => {
            if (e.button === 0) {
              void startWindowDrag();
            }
          }}
        />
        <div data-tauri-drag-region-exclude className="flex items-center gap-2">
          <button data-tauri-drag-region-exclude type="button" onClick={() => void minimizeWindow()} className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-white/50 hover:text-white">
            <Minus size={14} />
          </button>
          <button data-tauri-drag-region-exclude type="button" onClick={() => void toggleMaximizeWindow()} className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-white/50 hover:text-white">
            <Square size={12} />
          </button>
          <button data-tauri-drag-region-exclude type="button" onClick={() => void closeWindow()} className="p-1.5 hover:bg-red-500/80 rounded-md transition-colors text-white/50 hover:text-white">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Background ambient glow */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full opacity-20 blur-[80px] pointer-events-none" style={{ background: lightingEnabled ? `radial-gradient(circle, rgb(${rgb.r}, ${rgb.g}, ${rgb.b}) 0%, transparent 70%)` : 'transparent' }}></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full opacity-10 blur-[120px] pointer-events-none bg-blue-600"></div>

        {/* Sidebar */}
        <div className="w-64 glass border-r border-white/5 p-6 flex flex-col gap-2 z-10">
          <div className="flex items-center gap-3 mb-10 px-2 mt-4">
            <div className="overflow-hidden rounded-xl shadow-lg shadow-blue-500/20 ring-1 ring-white/10">
              <img src={winSenseMark} alt="" className="h-10 w-10 object-cover object-top" draggable={false} />
            </div>
            <h1 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">WinSense</h1>
          </div>

          <div className="space-y-2">
            {[
              { id: "dashboard", icon: Gamepad2, label: "Dashboard" },
              { id: "calibration", icon: Sliders, label: "Calibration" },
              { id: "mapping", icon: Keyboard, label: "Mapping" },
              { id: "lighting", icon: Palette, label: "Lighting" },
              { id: "triggers", icon: Sliders, label: "Triggers" },
              { id: "settings", icon: Settings, label: "Settings" }
            ].map((item) => (
              <button 
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 font-medium ${
                  activeTab === item.id 
                    ? "bg-white/10 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] border border-white/10" 
                    : "text-white/50 hover:bg-white/5 hover:text-white border border-transparent"
                }`}
              >
                <item.icon size={20} className={activeTab === item.id ? "text-blue-400" : ""} /> {item.label}
              </button>
            ))}
          </div>
          
          <div className="mt-auto pt-6 border-t border-white/5">
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors duration-300 ${isConnected ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-red-500'}`}></div>
              <span className={`text-sm font-medium ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-10 overflow-y-auto z-10">
          {activeTab === "dashboard" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <header className="mb-10 flex justify-between items-end">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Dashboard</h2>
                  <p className="text-white/50">Manage your DualSense controller settings.</p>
                </div>
                <button onClick={saveProfile} className="glass-button flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium">
                  <Save size={18} /> Save Profile
                </button>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="glass-panel p-8 rounded-3xl lg:col-span-2 flex flex-col items-center justify-center min-h-[400px] relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent z-0"></div>
                  <Gamepad2
                    size={160}
                    className={`mb-8 z-10 drop-shadow-2xl transition-all duration-500 group-hover:scale-105 ${isConnected ? "text-white/80" : "text-white/20"}`}
                    style={{ filter: (isConnected && lightingEnabled) ? `drop-shadow(0 10px 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4))` : "none" }}
                  />
                  
                  {isConnected ? (
                    <div className="flex gap-6 z-10">
                      <div className="flex items-center gap-2 glass px-4 py-2 rounded-full">
                        <Battery size={16} className="text-green-400" />
                        <span className="text-sm font-medium">85%</span>
                      </div>
                      <div className="flex items-center gap-2 glass px-4 py-2 rounded-full">
                        <Usb size={16} className="text-blue-400" />
                        <span className="text-sm font-medium">USB</span>
                      </div>
                    </div>
                  ) : (
                    <div className="z-10 text-white/40 font-medium">Please connect a controller</div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="glass-panel p-6 rounded-3xl">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Zap size={18} className="text-yellow-400" /> Quick Actions
                    </h3>
                    <div className="space-y-3">
                      <button onClick={testRumble} disabled={!isConnected} className="w-full glass-button py-3 rounded-xl font-medium flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        Test Rumble
                      </button>
                      <button 
                        disabled={!isConnected}
                        onClick={() => {
                          const reset = { ...DEFAULT_TRIGGER };
                          setLeftTrigger(reset);
                          setRightTrigger(reset);
                          setActiveProfileId(null);
                          sendTriggers(reset, reset);
                        }}
                        className="w-full glass-button py-3 rounded-xl font-medium flex justify-center items-center gap-2 text-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Reset Triggers
                      </button>
                    </div>
                  </div>

                  <div className="glass-panel p-6 rounded-3xl">
                    <h3 className="text-lg font-semibold mb-4 text-white/80">Active Mapping</h3>
                    <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 font-medium">
                      {mappingProfile?.name ?? "Loading..."}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "mapping" && mappingProfile && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Mapping</h2>
                  <p className="text-white/50 max-w-3xl">
                    Remap every controller button, stick, and trigger. The Create button near the D-pad
                    is now exposed as <span className="font-medium text-white/70">Create (B8)</span>, and the
                    built-in Keyboard + Mouse preset lets you use the controller in games without native support.
                  </p>
                </div>
                <div className="glass-panel p-4 rounded-2xl min-w-[260px]">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/30 mb-2">Preset</div>
                  <div className="relative">
                    <select
                      value={activeMappingProfileId ?? ""}
                      onChange={(e) => {
                        if (e.target.value) {
                          applyMappingPreset(e.target.value);
                          return;
                        }
                        commitMappingProfile(toManualProfile(mappingProfile), null);
                      }}
                      className="w-full glass-input rounded-xl p-3 pr-9 text-white outline-none appearance-none font-medium text-sm"
                    >
                      <option value="" className="bg-neutral-900">Manual / Custom</option>
                      {mappingPresets.map((preset) => (
                        <option key={preset.id} value={preset.id} className="bg-neutral-900">
                          {preset.name} (Built-in)
                        </option>
                      ))}
                      {customMappingProfiles.map((preset) => (
                        <option key={preset.id} value={preset.id} className="bg-neutral-900">
                          {preset.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                  </div>
                  <div className="text-xs text-white/35 mt-2">
                    Built-ins apply instantly. Editing a selected custom profile updates it automatically.
                  </div>
                  <button
                    onClick={createMappingProfileFromCurrent}
                    className="mt-3 glass-button w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
                  >
                    <Plus size={15} /> Save Current as Profile
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                <StickBindingCard
                  title="Left Stick"
                  subtitle="Use it as Xbox movement, keyboard movement, or disable it."
                  binding={mappingProfile.leftStick}
                  onChange={(binding) => handleStickBindingChange("leftStick", binding)}
                />
                <StickBindingCard
                  title="Right Stick"
                  subtitle="Keep Xbox camera aim or turn it into mouse movement."
                  binding={mappingProfile.rightStick}
                  onChange={(binding) => handleStickBindingChange("rightStick", binding)}
                />
                <TriggerBindingCard
                  title="Left Trigger"
                  subtitle="Bind L2 to an Xbox trigger, key, mouse button, or disable it."
                  binding={mappingProfile.leftTrigger}
                  onChange={(binding) => handleTriggerBindingChange("leftTrigger", binding)}
                />
                <TriggerBindingCard
                  title="Right Trigger"
                  subtitle="Bind R2 to an Xbox trigger, key, mouse button, or disable it."
                  binding={mappingProfile.rightTrigger}
                  onChange={(binding) => handleTriggerBindingChange("rightTrigger", binding)}
                />
              </div>

              <div className="glass-panel p-8 rounded-3xl">
                <div className="flex items-center justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-2xl font-semibold">Button Bindings</h3>
                    <p className="text-white/45 text-sm mt-1">
                      Every digital button can target Xbox input, keyboard keys, mouse buttons, or stay disabled.
                    </p>
                  </div>
                  <div className="text-xs text-white/35 text-right">
                    Touchpad click bindings are ignored while <span className="text-white/60">Touchpad as Mouse</span> is enabled.
                  </div>
                </div>

                <div className="space-y-3">
                  {CONTROLLER_BUTTONS.map((button) => (
                    <MappingButtonRow
                      key={button.id}
                      label={button.label}
                      description={button.description}
                      binding={getButtonBinding(mappingProfile, button.id)}
                      onTypeChange={(type) => handleButtonBindingTypeChange(button.id, type)}
                      onBindingChange={(binding) => handleButtonBindingValueChange(button.id, binding)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "calibration" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Calibration</h2>
                  <p className="text-white/50 max-w-3xl">
                    Tune software calibration to reduce stick drift and adjust trigger response. This masks minor drift in-app,
                    but it does not repair worn hardware inside the controller.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={resetCalibration} className="glass-button px-5 py-2.5 rounded-xl font-medium text-white/80">
                    Reset Calibration
                  </button>
                </div>
              </div>

              <div className="glass-panel p-6 rounded-3xl mb-6">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                  <div className="max-w-3xl">
                    <div className="text-sm font-medium text-white/80 mb-2">Firmware-Level Calibration</div>
                    <p className="text-sm text-white/50 leading-relaxed mb-4">
                      {calibrationCapabilities?.firmwareCalibrationNote ?? "Firmware calibration uses undocumented DualSense USB commands and should be treated as an advanced repair workflow."}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                      <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-2">Transport</div>
                        <div className="font-medium capitalize">{firmwareStatus.transport}</div>
                      </div>
                      <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-2">Status</div>
                        <div className="font-medium">{formatFirmwareStep(firmwareStatus.step)}</div>
                      </div>
                      <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-2">Last Mode</div>
                        <div className="font-medium capitalize">{firmwareStatus.lastCompletedMode ?? "None"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="lg:max-w-md w-full">
                    <div className="bg-black/20 rounded-2xl border border-white/5 p-4 mb-4">
                      <div className="text-sm text-white/80 mb-2">Instructions</div>
                      <p className="text-sm text-white/50 leading-relaxed">
                        {firmwareStatus.lastMessage}
                      </p>
                      {firmwareStatus.lastError && (
                        <p className="text-sm text-red-400 mt-3">
                          {firmwareStatus.lastError}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      <button
                        disabled={!firmwareStatus.eligible || firmwareStatus.busy}
                        onClick={() => void runFirmwareCommand("start_firmware_center_calibration")}
                        className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Start Center Calibration
                      </button>
                      <button
                        disabled={!firmwareStatus.eligible || firmwareStatus.busy}
                        onClick={() => void runFirmwareCommand("start_firmware_range_calibration")}
                        className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Start Range Calibration
                      </button>
                      <button
                        disabled={!firmwareStatus.canSampleCenter}
                        onClick={() => void runFirmwareCommand("sample_firmware_center_calibration")}
                        className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Sample Center
                      </button>
                      <button
                        disabled={!firmwareStatus.canStoreTemporarily}
                        onClick={() => void runFirmwareCommand(
                          firmwareStatus.activeMode === "center"
                            ? "store_firmware_center_calibration"
                            : "store_firmware_range_calibration"
                        )}
                        className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Store Temporarily
                      </button>
                    </div>

                    <label className="flex items-start gap-3 text-sm text-white/55 mb-4">
                      <input
                        type="checkbox"
                        checked={firmwareRiskAccepted}
                        onChange={(e) => setFirmwareRiskAccepted(e.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        I understand permanent firmware calibration writes directly to the controller and may fail on unsupported firmware or hardware.
                      </span>
                    </label>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        disabled={!firmwareStatus.canStorePermanently || !firmwareRiskAccepted}
                        onClick={() => void runFirmwareCommand("save_firmware_calibration_permanently")}
                        className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                      >
                        Save Permanently
                      </button>
                      <button
                        disabled={!firmwareStatus.busy}
                        onClick={() => void runFirmwareCommand("cancel_firmware_calibration")}
                        className="glass-button px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Cancel Session
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                <CalibrationStickCard
                  title="Left Stick"
                  snapshot={liveInput.leftStick}
                  calibration={calibrationProfile.leftStick}
                  onCenterFromCurrent={() => setStickCenterFromCurrent("leftStick")}
                  onChange={(nextStick) => updateCalibration(profile => ({ ...profile, leftStick: nextStick }))}
                />
                <CalibrationStickCard
                  title="Right Stick"
                  snapshot={liveInput.rightStick}
                  calibration={calibrationProfile.rightStick}
                  onCenterFromCurrent={() => setStickCenterFromCurrent("rightStick")}
                  onChange={(nextStick) => updateCalibration(profile => ({ ...profile, rightStick: nextStick }))}
                />
                <CalibrationTriggerCard
                  title="Left Trigger"
                  snapshot={liveInput.leftTrigger}
                  calibration={calibrationProfile.leftTrigger}
                  onChange={(nextTrigger) => updateCalibration(profile => ({ ...profile, leftTrigger: nextTrigger }))}
                />
                <CalibrationTriggerCard
                  title="Right Trigger"
                  snapshot={liveInput.rightTrigger}
                  calibration={calibrationProfile.rightTrigger}
                  onChange={(nextTrigger) => updateCalibration(profile => ({ ...profile, rightTrigger: nextTrigger }))}
                />
              </div>

              <div className="glass-panel p-6 rounded-3xl">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-1">Live Input</h3>
                    <p className="text-white/45 text-sm">
                      Use these values to spot drift. Small movement at rest means increasing deadzone or setting center may help.
                    </p>
                  </div>
                  <div className="text-sm text-white/35">
                    Pressed buttons: {liveInput.pressedButtons.length > 0 ? liveInput.pressedButtons.join(", ") : "None"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "lighting" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex justify-between items-end mb-10">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Lighting</h2>
                  <p className="text-white/50">Customize the controller's RGB lightbar.</p>
                </div>
                <button 
                  onClick={toggleLighting}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors ${lightingEnabled ? 'bg-blue-600 text-white' : 'glass-button text-white/50'}`}
                >
                  <Power size={18} /> {lightingEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              
              <div className={`glass-panel p-8 rounded-3xl max-w-2xl transition-opacity duration-300 ${!lightingEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                {/* Preview Bar */}
                <div className="mb-10 p-1 rounded-2xl glass">
                  <div 
                    className="h-24 rounded-xl w-full transition-colors duration-300 relative overflow-hidden" 
                    style={{ backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, boxShadow: `inset 0 0 20px rgba(0,0,0,0.2), 0 0 40px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent"></div>
                  </div>
                </div>

                <div className="space-y-8">
                  {[
                    { label: 'Red', color: 'r', value: rgb.r, hex: '#ef4444' },
                    { label: 'Green', color: 'g', value: rgb.g, hex: '#22c55e' },
                    { label: 'Blue', color: 'b', value: rgb.b, hex: '#3b82f6' }
                  ].map((channel) => (
                    <div key={channel.color}>
                      <div className="flex justify-between mb-3">
                        <span className="font-medium" style={{ color: channel.hex }}>{channel.label}</span>
                        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-sm">{channel.value}</span>
                      </div>
                      <div className="relative h-2 rounded-full bg-white/10">
                        <div 
                          className="absolute top-0 left-0 h-full rounded-full" 
                          style={{ width: `${(channel.value / 255) * 100}%`, backgroundColor: channel.hex }}
                        ></div>
                        <input 
                          type="range" min="0" max="255" value={channel.value} 
                          onChange={(e) => handleColorChange(channel.color, parseInt(e.target.value))}
                          className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        {/* Custom thumb overlay */}
                        <div 
                          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
                          style={{ left: `calc(${(channel.value / 255) * 100}% - 8px)` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "triggers" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-4xl font-bold mb-2">Adaptive Triggers</h2>
              <p className="text-white/50 mb-6">Configure haptic feedback and resistance for L2 and R2.</p>

              {/* Profile selector */}
              <div className="glass-panel p-5 rounded-2xl mb-6 flex items-center gap-4 flex-wrap">
                <span className="text-sm font-medium text-white/60">Haptic Profile:</span>
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <select
                    value={activeProfileId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) { setActiveProfileId(null); return; }
                      const p = hapticProfiles.find(hp => hp.id === id);
                      if (p) applyHapticProfile(p);
                    }}
                    className="w-full glass-input rounded-xl p-3 text-white outline-none appearance-none font-medium text-sm"
                  >
                    <option value="" className="bg-neutral-900">Manual / Custom</option>
                    {hapticProfiles.map(p => (
                      <option key={p.id} value={p.id} className="bg-neutral-900">{p.name}{p.builtIn ? " (Built-in)" : ""}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                </div>
                {activeProfileId && (
                  <span className="text-xs text-white/30">Adjusting sliders below will switch to manual mode</span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {([
                  { id: 'left' as const, label: 'Left Trigger (L2)', state: leftTrigger },
                  { id: 'right' as const, label: 'Right Trigger (R2)', state: rightTrigger },
                ]).map((trigger) => (
                  <div key={trigger.id} className="glass-panel p-8 rounded-3xl">
                    <h3 className="text-2xl font-semibold mb-8 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-sm font-bold">
                        {trigger.id === 'left' ? 'L2' : 'R2'}
                      </div>
                      {trigger.label}
                    </h3>

                    <div className="space-y-6">
                      {/* Mode selector */}
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-3">Effect Mode</label>
                        <div className="relative">
                          <select
                            value={trigger.state.mode}
                            onChange={(e) => handleTriggerChange(trigger.id, 'mode', parseInt(e.target.value))}
                            className="w-full glass-input rounded-xl p-4 text-white outline-none appearance-none font-medium"
                          >
                            {Object.entries(MODE_LABELS).map(([v, l]) => (
                              <option key={v} value={v} className="bg-neutral-900">{l}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                        </div>
                      </div>

                      {trigger.state.mode !== 0 && (<>
                        {/* Force */}
                        <SliderRow label="Force / Amplitude" value={trigger.state.force} max={255} color="bg-purple-500"
                          onChange={(v) => handleTriggerChange(trigger.id, 'force', v)} />

                        {/* Start Position -- all active modes */}
                        <SliderRow label="Start Position" value={trigger.state.startPos} max={255} color="bg-blue-500"
                          onChange={(v) => handleTriggerChange(trigger.id, 'startPos', v)} />

                        {/* End Position -- section + machine gun */}
                        {(trigger.state.mode === 2 || trigger.state.mode === 39) && (
                          <SliderRow label="End Position" value={trigger.state.endPos} max={255} color="bg-cyan-500"
                            onChange={(v) => handleTriggerChange(trigger.id, 'endPos', v)} />
                        )}

                        {/* Frequency -- vibration + machine gun */}
                        {(trigger.state.mode === 6 || trigger.state.mode === 39) && (
                          <SliderRow label="Frequency (Hz)" value={trigger.state.frequency} max={255} color="bg-amber-500"
                            onChange={(v) => handleTriggerChange(trigger.id, 'frequency', v)} />
                        )}
                      </>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-4xl font-bold mb-2">Settings</h2>
              <p className="text-white/50 mb-10">Application preferences.</p>

              <div className="space-y-8 max-w-3xl">
                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mt-0.5">
                        <Power size={20} className="text-emerald-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold mb-1">Startup & Tray</h3>
                        <p className="text-white/50 text-sm leading-relaxed">
                          Control how WinSense launches with Windows and whether closing the window keeps the app running in the tray.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => void toggleLaunchOnStartup()}
                      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${launchOnStartup ? 'bg-emerald-600' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${launchOnStartup ? 'left-[calc(100%-1.625rem)]' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {launchOnStartup && (
                    <div className="mt-8 pt-6 border-t border-white/5">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <h4 className="text-sm font-semibold text-white/85">Startup launch mode</h4>
                          <p className="text-sm text-white/45 mt-1">
                            Choose whether WinSense opens normally or starts hidden in the tray when launched automatically on boot.
                          </p>
                        </div>
                        <div className="flex gap-2 rounded-2xl bg-black/20 p-1 border border-white/5">
                          <button
                            type="button"
                            onClick={() => selectStartupOpenMode("normal")}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                              startupOpenMode === "normal" ? "bg-blue-500 text-white" : "text-white/60 hover:text-white hover:bg-white/5"
                            }`}
                          >
                            Open normally
                          </button>
                          <button
                            type="button"
                            onClick={() => selectStartupOpenMode("tray")}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                              startupOpenMode === "tray" ? "bg-blue-500 text-white" : "text-white/60 hover:text-white hover:bg-white/5"
                            }`}
                          >
                            Start minimized to tray
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-8 pt-6 border-t border-white/5 flex items-start justify-between gap-6">
                    <div className="max-w-xl">
                      <h4 className="text-sm font-semibold text-white/85">Close to tray</h4>
                      <p className="text-sm text-white/45 mt-1 leading-relaxed">
                        Hide WinSense to the tray instead of exiting when you click the close button. The tray menu will include Show Application and Quit.
                      </p>
                    </div>
                    <button
                      onClick={toggleCloseToTray}
                      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${closeToTray ? 'bg-blue-600' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${closeToTray ? 'left-[calc(100%-1.625rem)]' : 'left-0.5'}`} />
                    </button>
                  </div>
                </div>

                {/* Touchpad section */}
                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 mt-0.5">
                        <MousePointer size={20} className="text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold mb-1">Touchpad as Mouse</h3>
                        <p className="text-white/50 text-sm leading-relaxed">
                          Use the DualSense touchpad to control the mouse cursor. Single-finger swipe moves the cursor, 
                          touchpad click with one finger for left click, two fingers for right click.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={toggleTouchpad}
                      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors duration-300 ${touchpadEnabled ? 'bg-blue-600' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${touchpadEnabled ? 'left-[calc(100%-1.625rem)]' : 'left-0.5'}`} />
                    </button>
                  </div>

                  <div className={`mt-8 pt-6 border-t border-white/5 transition-opacity duration-300 ${!touchpadEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                    <div className="flex justify-between mb-3">
                      <label className="text-sm font-medium text-white/70">Cursor Sensitivity</label>
                      <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-sm">{touchpadSensitivity.toFixed(1)}x</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-white/10">
                      <div
                        className="absolute top-0 left-0 h-full rounded-full bg-blue-500"
                        style={{ width: `${((touchpadSensitivity - 0.1) / 2.9) * 100}%` }}
                      ></div>
                      <input
                        type="range" min="0.1" max="3.0" step="0.1" value={touchpadSensitivity}
                        onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                        className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
                        style={{ left: `calc(${((touchpadSensitivity - 0.1) / 2.9) * 100}% - 8px)` }}
                      ></div>
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-white/30">
                      <span>Slow</span>
                      <span>Fast</span>
                    </div>
                  </div>
                </div>

                {/* Haptic Profiles section */}
                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                        <Sliders size={20} className="text-purple-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">Haptic Profiles</h3>
                        <p className="text-white/50 text-sm">Create and manage custom adaptive trigger presets.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setEditingProfile({
                        id: generateId(), name: "", builtIn: false,
                        left: { ...DEFAULT_TRIGGER }, right: { ...DEFAULT_TRIGGER },
                      })}
                      className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                    >
                      <Plus size={16} /> New Profile
                    </button>
                  </div>

                  {/* Profile list */}
                  <div className="space-y-3 mb-2">
                    {hapticProfiles.map(p => (
                      <div key={p.id} className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                        activeProfileId === p.id ? 'bg-purple-500/10 border-purple-500/20' : 'bg-white/[0.03] border-white/5'
                      }`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{p.name}</span>
                            {p.builtIn && <span className="text-[10px] uppercase tracking-wider text-white/30 bg-white/5 px-1.5 py-0.5 rounded">Built-in</span>}
                          </div>
                          <div className="text-xs text-white/40 mt-1">
                            L2: {MODE_LABELS[p.left.mode] ?? "Off"} &middot; R2: {MODE_LABELS[p.right.mode] ?? "Off"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 ml-4">
                          <button onClick={() => setEditingProfile({ ...p, left: { ...p.left }, right: { ...p.right } })}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white" title="Edit">
                            <Pencil size={14} />
                          </button>
                          {!p.builtIn && (
                            <button onClick={() => deleteHapticProfile(p.id)}
                              className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-white/40 hover:text-red-400" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {hapticProfiles.length === 0 && (
                      <div className="text-center py-8 text-white/30 text-sm">No profiles yet. Click "New Profile" to create one.</div>
                    )}
                  </div>

                  {/* Inline profile editor */}
                  {editingProfile && (
                    <div className="mt-6 pt-6 border-t border-white/10">
                      <h4 className="text-lg font-semibold mb-4">{hapticProfiles.some(p => p.id === editingProfile.id) ? "Edit Profile" : "New Profile"}</h4>
                      <div className="mb-6">
                        <label className="block text-sm font-medium text-white/70 mb-2">Profile Name</label>
                        <input
                          type="text" value={editingProfile.name} placeholder="My Custom Profile"
                          onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20"
                        />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        {(['left', 'right'] as const).map(side => {
                          const cfg = editingProfile[side];
                          const updateSide = (field: keyof TriggerConfig, value: number) => {
                            setEditingProfile({ ...editingProfile, [side]: { ...cfg, [field]: value } });
                          };
                          return (
                            <div key={side} className="bg-white/[0.03] rounded-2xl p-5 border border-white/5">
                              <div className="text-sm font-bold text-white/60 mb-4">{side === 'left' ? 'L2 -- Left Trigger' : 'R2 -- Right Trigger'}</div>
                              <div className="space-y-5">
                                <div>
                                  <label className="block text-xs font-medium text-white/50 mb-2">Mode</label>
                                  <div className="relative">
                                    <select value={cfg.mode} onChange={(e) => updateSide('mode', parseInt(e.target.value))}
                                      className="w-full glass-input rounded-lg p-3 text-white text-sm outline-none appearance-none font-medium">
                                      {Object.entries(MODE_LABELS).map(([v, l]) => (
                                        <option key={v} value={v} className="bg-neutral-900">{l}</option>
                                      ))}
                                    </select>
                                    <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                                  </div>
                                </div>
                                {cfg.mode !== 0 && (<>
                                  <SliderRow label="Force" value={cfg.force} max={255} color="bg-purple-500" onChange={(v) => updateSide('force', v)} />
                                  <SliderRow label="Start Pos" value={cfg.startPos} max={255} color="bg-blue-500" onChange={(v) => updateSide('startPos', v)} />
                                  {(cfg.mode === 2 || cfg.mode === 39) && (
                                    <SliderRow label="End Pos" value={cfg.endPos} max={255} color="bg-cyan-500" onChange={(v) => updateSide('endPos', v)} />
                                  )}
                                  {(cfg.mode === 6 || cfg.mode === 39) && (
                                    <SliderRow label="Frequency" value={cfg.frequency} max={255} color="bg-amber-500" onChange={(v) => updateSide('frequency', v)} />
                                  )}
                                </>)}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex gap-3 justify-end">
                        <button onClick={() => setEditingProfile(null)}
                          className="glass-button px-5 py-2.5 rounded-xl text-sm font-medium text-white/50">Cancel</button>
                        <button
                          disabled={!editingProfile.name.trim()}
                          onClick={() => saveHapticProfile(editingProfile)}
                          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                        >Save Profile</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                        <Keyboard size={20} className="text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">Mapping Profiles</h3>
                        <p className="text-white/50 text-sm">Save the current mapping as reusable custom profiles.</p>
                      </div>
                    </div>
                    <button
                      onClick={createMappingProfileFromCurrent}
                      className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                    >
                      <Plus size={16} /> New Profile
                    </button>
                  </div>

                  <div className="space-y-3 mb-2">
                    {customMappingProfiles.map((profile) => (
                      <div
                        key={profile.id}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                          activeMappingProfileId === profile.id
                            ? "bg-blue-500/10 border-blue-500/20"
                            : "bg-white/[0.03] border-white/5"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{profile.name}</span>
                            {activeMappingProfileId === profile.id && (
                              <span className="text-[10px] uppercase tracking-wider text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-white/40 mt-1">
                            Edit bindings from the Mapping tab after selecting this profile.
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 ml-4">
                          <button
                            onClick={() => applyMappingPreset(profile.id)}
                            className="px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-xs font-medium text-white/60 hover:text-white"
                            title="Use"
                          >
                            Use
                          </button>
                          <button
                            onClick={() => loadCustomMappingProfileForEditing(profile)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white"
                            title="Rename"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => deleteMappingLibraryProfile(profile.id)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-white/40 hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {customMappingProfiles.length === 0 && (
                      <div className="text-center py-8 text-white/30 text-sm">
                        No custom mapping profiles yet. Save one from the current mapping.
                      </div>
                    )}
                  </div>

                  {editingMappingProfile && (
                    <div className="mt-6 pt-6 border-t border-white/10">
                      <h4 className="text-lg font-semibold mb-4">
                        {customMappingProfiles.some((profile) => profile.id === editingMappingProfile.id)
                          ? "Rename Profile"
                          : "New Mapping Profile"}
                      </h4>
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-white/70 mb-2">Profile Name</label>
                        <input
                          type="text"
                          value={editingMappingProfile.name}
                          placeholder="My Keyboard Layout"
                          onChange={(e) => setEditingMappingProfile({ ...editingMappingProfile, name: e.target.value })}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20"
                        />
                      </div>
                      <p className="text-sm text-white/40 mb-6">
                        This saves the current mapping snapshot. After selecting a custom profile in the Mapping tab,
                        future edits are saved back into that profile automatically.
                      </p>
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={() => setEditingMappingProfile(null)}
                          className="glass-button px-5 py-2.5 rounded-xl text-sm font-medium text-white/50"
                        >
                          Cancel
                        </button>
                        <button
                          disabled={!editingMappingProfile.name.trim()}
                          onClick={() => saveMappingLibraryProfile(editingMappingProfile)}
                          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                        >
                          Save Profile
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SliderRow({ label, value, max, color, onChange }: { label: string; value: number; max: number; color: string; onChange: (v: number) => void }) {
  const pct = (value / max) * 100;
  return (
    <div>
      <div className="flex justify-between mb-2">
        <label className="text-sm font-medium text-white/70">{label}</label>
        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-xs">{value}</span>
      </div>
      <div className="relative h-2 rounded-full bg-white/10">
        <div className={`absolute top-0 left-0 h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        <input type="range" min="0" max={max} value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer" />
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }} />
      </div>
    </div>
  );
}

function createButtonBindingTarget(type: ButtonBindingTarget["type"], current: ButtonBindingTarget): ButtonBindingTarget {
  switch (type) {
    case "disabled":
      return { type: "disabled" };
    case "xboxButton":
      return {
        type: "xboxButton",
        button: current.type === "xboxButton" ? current.button : "a",
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

function MappingButtonRow({
  label,
  description,
  binding,
  onTypeChange,
  onBindingChange,
}: {
  label: string;
  description: string;
  binding: ButtonBindingTarget;
  onTypeChange: (type: ButtonBindingTarget["type"]) => void;
  onBindingChange: (binding: ButtonBindingTarget) => void;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.8fr_0.9fr] gap-3 items-center">
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-white/40 mt-1">{description}</div>
        </div>

        <div className="relative">
          <select
            value={binding.type}
            onChange={(e) => onTypeChange(e.target.value as ButtonBindingTarget["type"])}
            className="w-full glass-input rounded-xl p-3 pr-9 text-sm outline-none appearance-none"
          >
            <option value="disabled" className="bg-neutral-900">Disabled</option>
            <option value="xboxButton" className="bg-neutral-900">Xbox Button</option>
            <option value="keyboardKey" className="bg-neutral-900">Keyboard Key</option>
            <option value="mouseButton" className="bg-neutral-900">Mouse Button</option>
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
        </div>

        {binding.type === "disabled" ? (
          <div className="text-sm text-white/35 px-3">No output</div>
        ) : binding.type === "xboxButton" ? (
          <ValueSelect
            value={binding.button}
            options={XBOX_BUTTON_OPTIONS}
            onChange={(value) => onBindingChange({ type: "xboxButton", button: value as XboxButton })}
          />
        ) : binding.type === "keyboardKey" ? (
          <ValueSelect
            value={binding.key}
            options={KEY_OPTIONS}
            onChange={(value) => onBindingChange({ type: "keyboardKey", key: value as KeyCode })}
          />
        ) : (
          <ValueSelect
            value={binding.button}
            options={MOUSE_BUTTON_OPTIONS}
            onChange={(value) => onBindingChange({ type: "mouseButton", button: value as MouseButton })}
          />
        )}
      </div>
    </div>
  );
}

function StickBindingCard({
  title,
  subtitle,
  binding,
  onChange,
}: {
  title: string;
  subtitle: string;
  binding: StickBinding;
  onChange: (binding: StickBinding) => void;
}) {
  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-white/45 text-sm mt-1">{subtitle}</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <Gamepad2 size={20} className="text-blue-400" />
        </div>
      </div>

      <div className="space-y-5">
        <div className="relative">
          <select
            value={binding.type}
            onChange={(e) => {
              const type = e.target.value as StickBinding["type"];
              if (type === "disabled") onChange({ type: "disabled" });
              if (type === "xboxStick") onChange({ type: "xboxStick", stick: "left" });
              if (type === "keyboard4") onChange({ type: "keyboard4", up: "w", down: "s", left: "a", right: "d", threshold: 0.35 });
              if (type === "mouseMove") onChange({ type: "mouseMove", sensitivity: 18, deadzone: 0.2 });
            }}
            className="w-full glass-input rounded-xl p-3 pr-9 text-sm outline-none appearance-none"
          >
            <option value="disabled" className="bg-neutral-900">Disabled</option>
            <option value="xboxStick" className="bg-neutral-900">Xbox Stick</option>
            <option value="keyboard4" className="bg-neutral-900">Keyboard 4-Way</option>
            <option value="mouseMove" className="bg-neutral-900">Mouse Move</option>
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
        </div>

        {binding.type === "disabled" && <div className="text-sm text-white/35">This stick will not send any mapped output.</div>}

        {binding.type === "xboxStick" && (
          <ValueSelect
            value={binding.stick}
            options={XBOX_STICK_OPTIONS}
            onChange={(value) => onChange({ type: "xboxStick", stick: value as XboxStick })}
          />
        )}

        {binding.type === "keyboard4" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ValueSelect
              label="Up"
              value={binding.up}
              options={KEY_OPTIONS}
              onChange={(value) => onChange({ ...binding, up: value as KeyCode })}
            />
            <ValueSelect
              label="Down"
              value={binding.down}
              options={KEY_OPTIONS}
              onChange={(value) => onChange({ ...binding, down: value as KeyCode })}
            />
            <ValueSelect
              label="Left"
              value={binding.left}
              options={KEY_OPTIONS}
              onChange={(value) => onChange({ ...binding, left: value as KeyCode })}
            />
            <ValueSelect
              label="Right"
              value={binding.right}
              options={KEY_OPTIONS}
              onChange={(value) => onChange({ ...binding, right: value as KeyCode })}
            />
            <RangeField
              label="Threshold"
              value={binding.threshold}
              min={0.1}
              max={0.9}
              step={0.05}
              formatter={(value) => `${value.toFixed(2)}`}
              onChange={(value) => onChange({ ...binding, threshold: value })}
            />
          </div>
        )}

        {binding.type === "mouseMove" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RangeField
              label="Sensitivity"
              value={binding.sensitivity}
              min={1}
              max={40}
              step={1}
              formatter={(value) => `${value.toFixed(0)} px/tick`}
              onChange={(value) => onChange({ ...binding, sensitivity: value })}
            />
            <RangeField
              label="Deadzone"
              value={binding.deadzone}
              min={0}
              max={0.8}
              step={0.05}
              formatter={(value) => `${value.toFixed(2)}`}
              onChange={(value) => onChange({ ...binding, deadzone: value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerBindingCard({
  title,
  subtitle,
  binding,
  onChange,
}: {
  title: string;
  subtitle: string;
  binding: TriggerBinding;
  onChange: (binding: TriggerBinding) => void;
}) {
  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-white/45 text-sm mt-1">{subtitle}</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
          <Sliders size={20} className="text-purple-400" />
        </div>
      </div>

      <div className="space-y-5">
        <div className="relative">
          <select
            value={binding.type}
            onChange={(e) => {
              const type = e.target.value as TriggerBinding["type"];
              if (type === "disabled") onChange({ type: "disabled" });
              if (type === "xboxTrigger") onChange({ type: "xboxTrigger", trigger: "left" });
              if (type === "keyboardKey") onChange({ type: "keyboardKey", key: "space", threshold: 40 });
              if (type === "mouseButton") onChange({ type: "mouseButton", button: "left", threshold: 40 });
            }}
            className="w-full glass-input rounded-xl p-3 pr-9 text-sm outline-none appearance-none"
          >
            <option value="disabled" className="bg-neutral-900">Disabled</option>
            <option value="xboxTrigger" className="bg-neutral-900">Xbox Trigger</option>
            <option value="keyboardKey" className="bg-neutral-900">Keyboard Key</option>
            <option value="mouseButton" className="bg-neutral-900">Mouse Button</option>
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
        </div>

        {binding.type === "disabled" && <div className="text-sm text-white/35">This trigger will not send any mapped output.</div>}

        {binding.type === "xboxTrigger" && (
          <ValueSelect
            value={binding.trigger}
            options={XBOX_TRIGGER_OPTIONS}
            onChange={(value) => onChange({ type: "xboxTrigger", trigger: value as XboxTrigger })}
          />
        )}

        {binding.type === "keyboardKey" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ValueSelect
              label="Key"
              value={binding.key}
              options={KEY_OPTIONS}
              onChange={(value) => onChange({ ...binding, key: value as KeyCode })}
            />
            <RangeField
              label="Activation Threshold"
              value={binding.threshold}
              min={1}
              max={255}
              step={1}
              formatter={(value) => `${value.toFixed(0)}`}
              onChange={(value) => onChange({ ...binding, threshold: Math.round(value) })}
            />
          </div>
        )}

        {binding.type === "mouseButton" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ValueSelect
              label="Mouse Button"
              value={binding.button}
              options={MOUSE_BUTTON_OPTIONS}
              onChange={(value) => onChange({ ...binding, button: value as MouseButton })}
            />
            <RangeField
              label="Activation Threshold"
              value={binding.threshold}
              min={1}
              max={255}
              step={1}
              formatter={(value) => `${value.toFixed(0)}`}
              onChange={(value) => onChange({ ...binding, threshold: Math.round(value) })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ValueSelect({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      {label && <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-2">{label}</div>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full glass-input rounded-xl p-3 pr-9 text-sm outline-none appearance-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-neutral-900">
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  formatter,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between mb-2">
        <label className="text-sm font-medium text-white/70">{label}</label>
        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-xs">
          {formatter(value)}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/10">
        <div className="absolute top-0 left-0 h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
    </div>
  );
}

function CalibrationStickCard({
  title,
  snapshot,
  calibration,
  onCenterFromCurrent,
  onChange,
}: {
  title: string;
  snapshot: StickSnapshot;
  calibration: CalibrationProfile["leftStick"];
  onCenterFromCurrent: () => void;
  onChange: (next: CalibrationProfile["leftStick"]) => void;
}) {
  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-white/45 text-sm mt-1">Raw and corrected stick position with drift controls.</p>
        </div>
        <button onClick={onCenterFromCurrent} className="glass-button px-4 py-2 rounded-xl text-sm font-medium">
          Set Current as Center
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <StickVisualizer label="Raw" x={snapshot.normalizedX} y={snapshot.normalizedY} />
        <StickVisualizer label="Calibrated" x={snapshot.calibratedX} y={snapshot.calibratedY} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-3">Live Readout</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-white/50">Raw X</span><span className="font-mono">{snapshot.normalizedX.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Raw Y</span><span className="font-mono">{snapshot.normalizedY.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Calibrated X</span><span className="font-mono">{snapshot.calibratedX.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Calibrated Y</span><span className="font-mono">{snapshot.calibratedY.toFixed(3)}</span></div>
          </div>
        </div>
        <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-3">Calibration</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-white/50">Center X</span><span className="font-mono">{calibration.centerX.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Center Y</span><span className="font-mono">{calibration.centerY.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Deadzone</span><span className="font-mono">{calibration.deadzone.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Outer Scale</span><span className="font-mono">{calibration.outerScale.toFixed(2)}x</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RangeField
          label="Center X Offset"
          value={calibration.centerX}
          min={-0.5}
          max={0.5}
          step={0.01}
          formatter={(value) => value.toFixed(2)}
          onChange={(value) => onChange({ ...calibration, centerX: value })}
        />
        <RangeField
          label="Center Y Offset"
          value={calibration.centerY}
          min={-0.5}
          max={0.5}
          step={0.01}
          formatter={(value) => value.toFixed(2)}
          onChange={(value) => onChange({ ...calibration, centerY: value })}
        />
        <RangeField
          label="Deadzone"
          value={calibration.deadzone}
          min={0}
          max={0.35}
          step={0.01}
          formatter={(value) => value.toFixed(2)}
          onChange={(value) => onChange({ ...calibration, deadzone: value })}
        />
        <RangeField
          label="Outer Scale"
          value={calibration.outerScale}
          min={0.5}
          max={1.5}
          step={0.01}
          formatter={(value) => `${value.toFixed(2)}x`}
          onChange={(value) => onChange({ ...calibration, outerScale: value })}
        />
      </div>
    </div>
  );
}

function CalibrationTriggerCard({
  title,
  snapshot,
  calibration,
  onChange,
}: {
  title: string;
  snapshot: TriggerSnapshot;
  calibration: CalibrationProfile["leftTrigger"];
  onChange: (next: CalibrationProfile["leftTrigger"]) => void;
}) {
  return (
    <div className="glass-panel p-8 rounded-3xl">
      <div className="mb-6">
        <h3 className="text-2xl font-semibold">{title}</h3>
        <p className="text-white/45 text-sm mt-1">Trim initial slack and compress or extend usable trigger range.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <TriggerMeter label="Raw" value={snapshot.normalized} rawValue={snapshot.rawValue} />
        <TriggerMeter label="Calibrated" value={snapshot.calibratedNormalized} rawValue={snapshot.calibratedValue} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RangeField
          label="Deadzone"
          value={calibration.deadzone}
          min={0}
          max={100}
          step={1}
          formatter={(value) => `${value.toFixed(0)}`}
          onChange={(value) => onChange({ ...calibration, deadzone: Math.round(value) })}
        />
        <RangeField
          label="Maximum Range"
          value={calibration.maxValue}
          min={100}
          max={255}
          step={1}
          formatter={(value) => `${value.toFixed(0)}`}
          onChange={(value) => onChange({ ...calibration, maxValue: Math.round(value) })}
        />
      </div>
    </div>
  );
}

function StickVisualizer({
  label,
  x,
  y,
}: {
  label: string;
  x: number;
  y: number;
}) {
  const left = `${((x + 1) / 2) * 100}%`;
  const top = `${((y + 1) / 2) * 100}%`;

  return (
    <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.15em] text-white/35 mb-3">{label}</div>
      <div className="relative aspect-square rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.12),transparent_65%)]">
        <div className="absolute inset-x-1/2 top-0 bottom-0 w-px bg-white/10" />
        <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-white/10" />
        <div
          className="absolute w-4 h-4 rounded-full bg-blue-400 shadow-[0_0_18px_rgba(96,165,250,0.75)] -translate-x-1/2 -translate-y-1/2"
          style={{ left, top }}
        />
      </div>
    </div>
  );
}

function TriggerMeter({
  label,
  value,
  rawValue,
}: {
  label: string;
  value: number;
  rawValue: number;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="bg-black/20 rounded-2xl border border-white/5 p-4">
      <div className="flex justify-between mb-3">
        <span className="text-xs uppercase tracking-[0.15em] text-white/35">{label}</span>
        <span className="text-xs text-white/45 font-mono">{rawValue}</span>
      </div>
      <div className="relative h-3 rounded-full bg-white/10 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full bg-purple-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-sm text-white/55">{value.toFixed(3)}</div>
    </div>
  );
}

function formatFirmwareStep(step: FirmwareCalibrationStatus["step"]) {
  switch (step) {
    case "idle":
      return "Idle";
    case "centerSampling":
      return "Center Sampling";
    case "centerSampled":
      return "Center Ready";
    case "rangeSampling":
      return "Range Sampling";
    case "completedTemporary":
      return "Temporary Saved";
    case "completedPermanent":
      return "Permanent Saved";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Error";
  }
}

export default App;

