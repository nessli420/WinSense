import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Battery,
  Bluetooth,
  ChevronDown,
  Gamepad2,
  Info,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  Minus,
  MousePointer,
  Palette,
  Pencil,
  Plus,
  Power,
  Save,
  Settings,
  Sliders,
  Speaker,
  Square,
  Trash2,
  Usb,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import winSenseMark from "../winsense-square.png";
import { DEFAULT_AUDIO } from "./audio";
import {
  computeAdaptiveTriggerPreview,
  computeNeedForSpeedHeatAdaptiveTriggersForSpeed,
  defaultAdaptiveTriggerSettings,
} from "./adaptiveTriggers";
import {
  BUILTIN_LIGHTING_PROFILES,
  DEFAULT_LIGHTING,
  clampPercent,
  cloneLightingColor,
  cloneLightingProfile,
  computeLightingColor,
  createCustomLightingProfileDraft,
  defaultLightingProfile,
  getLightingProfile,
  usesAccentColor,
} from "./lighting";
import {
  DEFAULT_TRIGGER_EFFECT,
  DEFAULT_CALIBRATION_PROFILE,
  EMPTY_LIVE_INPUT,
  EMPTY_FIRMWARE_STATUS,
  EMPTY_GAME_TELEMETRY_STATUS,
  cloneAdaptiveTriggerSettings,
  cloneCalibrationProfile,
  cloneHapticProfile,
  cloneMappingProfile,
  cloneTriggerEffect,
  convertMappingProfileEmulationTarget,
  createButtonBindingTarget,
  getButtonBinding,
  migrateLegacyTriggerEffect,
  normalizeMappingProfile,
  normalizeAdaptiveTriggerSettings,
  normalizeTriggerEffect,
  toManualProfile,
} from "./mapping";
import {
  APP_STATE_SCHEMA_VERSION,
  APP_STATE_FILE,
  HAPTIC_PROFILES_FILE,
  LEGACY_PROFILE_FILE,
  LIGHTING_PROFILES_FILE,
  MAPPING_PROFILES_FILE,
  TRIGGER_PROFILES_FILE,
  type StartupOpenMode,
  createRuntimeSettingsSnapshot,
  loadPersistedJson,
  loadVersionedAppState,
  normalizeStartupOpenMode,
  writeJsonFile,
} from "./persistence";
import { generateLightingProfileId, generateMappingProfileId } from "./profileIds";
import {
  BUILTIN_HAPTIC_PROFILES,
  TRIGGER_EFFECT_DEFINITIONS,
  createHapticProfileDraft,
  describeTriggerEffect,
  getTriggerEffectDefinition,
} from "./triggers";
import { CalibrationPanel } from "./components/calibration/CalibrationPanel";
import { MappingEditor } from "./components/mapping/MappingEditor";
import "./App.css";
import type {
  ActiveProcessOption,
  AdaptiveTriggerSettings,
  AudioSettings,
  CalibrationCapabilities,
  CalibrationProfile,
  ButtonBindingTarget,
  ConnectionTransport,
  ControllerButton,
  FirmwareCalibrationStatus,
  GameTelemetryStatus,
  HapticProfile,
  LightingColor,
  LightingEffect,
  LightingProfile,
  LightingSettings,
  LiveInputSnapshot,
  MappingProfile,
  PersistedAppState,
  OcrCalibrationRegion,
  StickBinding,
  TriggerEffect,
  TriggerEffectKind,
  TriggerBinding,
} from "./mapping";

const appWindow = getCurrentWindow();

interface ToastState {
  title: string;
  message: string;
  tone: "success" | "error";
}

interface OcrCalibrationPreviewPayload {
  imageDataUrl: string;
  width: number;
  height: number;
}

interface OcrCalibrationDraft {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

const AUTOSAVE_DELAY_MS = 450;
const TOAST_DURATION_MS = 2800;
const clampU8 = (value: number) => Math.max(0, Math.min(255, Math.round(value || 0)));

const getTransportLabel = (transport: ConnectionTransport) => {
  if (transport === "bluetooth") return "Bluetooth";
  if (transport === "usb") return "USB";
  return "Detecting";
};

const getTelemetryToneClasses = (stage: GameTelemetryStatus["stage"]) => {
  if (stage === "attached") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (stage === "gameDetected") return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  if (stage === "telemetryUnavailable" || stage === "telemetryStale") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  if (stage === "error") return "border-red-500/30 bg-red-500/10 text-red-200";
  return "border-white/10 bg-white/5 text-white/70";
};

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isConnected, setIsConnected] = useState(false);
  const [appInitialized, setAppInitialized] = useState(false);
  const [showStartupSplash, setShowStartupSplash] = useState(true);
  const [startupSplashExiting, setStartupSplashExiting] = useState(false);
  const [lightingEnabled, setLightingEnabled] = useState(DEFAULT_LIGHTING.enabled);
  const [customLightingProfiles, setCustomLightingProfiles] = useState<LightingProfile[]>([]);
  const [activeLightingProfileId, setActiveLightingProfileId] = useState<string | null>(DEFAULT_LIGHTING.profileId);
  const [lightingDraft, setLightingDraft] = useState<LightingProfile>(defaultLightingProfile());
  const [lightingPreviewRgb, setLightingPreviewRgb] = useState<LightingColor>({ ...DEFAULT_LIGHTING.profile.color });
  const [leftTrigger, setLeftTrigger] = useState<TriggerEffect>(cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT));
  const [rightTrigger, setRightTrigger] = useState<TriggerEffect>(cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT));
  const [customHapticProfiles, setCustomHapticProfiles] = useState<HapticProfile[]>([]);
  const [editingHapticProfile, setEditingHapticProfile] = useState<HapticProfile | null>(null);
  const [linkTriggerEditing, setLinkTriggerEditing] = useState(false);
  const [adaptiveTriggers, setAdaptiveTriggers] = useState<AdaptiveTriggerSettings>(defaultAdaptiveTriggerSettings());
  const [gameTelemetryStatus, setGameTelemetryStatus] = useState<GameTelemetryStatus>(EMPTY_GAME_TELEMETRY_STATUS);
  const [touchpadEnabled, setTouchpadEnabled] = useState(false);
  const [touchpadSensitivity, setTouchpadSensitivity] = useState(1.0);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [startupOpenMode, setStartupOpenMode] = useState<StartupOpenMode>("normal");
  const [closeToTray, setCloseToTray] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [ocrCalibrationPreview, setOcrCalibrationPreview] = useState<OcrCalibrationPreviewPayload | null>(null);
  const [ocrCalibrationDraft, setOcrCalibrationDraft] = useState<OcrCalibrationDraft | null>(null);
  const [ocrCalibrationLoading, setOcrCalibrationLoading] = useState(false);
  const [ocrCalibrationDragging, setOcrCalibrationDragging] = useState(false);
  const [ocrProcessOptions, setOcrProcessOptions] = useState<ActiveProcessOption[]>([]);
  const [ocrProcessOptionsLoading, setOcrProcessOptionsLoading] = useState(false);

  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
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
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({ ...DEFAULT_AUDIO });
  const [speakerTestActive, setSpeakerTestActive] = useState(false);
  const [speakerTestError, setSpeakerTestError] = useState<string | null>(null);
  const [micTestActive, setMicTestActive] = useState(false);
  const [micTestError, setMicTestError] = useState<string | null>(null);

  const pendingLightbarRef = useRef<{ r: number; g: number; b: number } | null>(null);
  const pendingTriggersRef = useRef<{ lt: TriggerEffect; rt: TriggerEffect } | null>(null);
  const pendingAudioRef = useRef<AudioSettings | null>(null);
  const rafIdRef = useRef(0);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const hasLoadedPersistenceRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const lightingAnimationRef = useRef<number | null>(null);
  const ocrPreviewImageRef = useRef<HTMLImageElement | null>(null);
  const ocrDragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const startupSplashStartedAtRef = useRef(0);
  const startupSplashExitTimeoutRef = useRef<number | null>(null);
  const startupSplashHideTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    startupSplashStartedAtRef.current = performance.now();
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
    const telemetryUnlisten = listen<GameTelemetryStatus>("game-telemetry-status", (event) => {
      setGameTelemetryStatus(event.payload);
    });

    return () => {
      statusUnlisten.then(f => f());
      inputUnlisten.then(f => f());
      firmwareUnlisten.then(f => f());
      telemetryUnlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    if (!appInitialized) {
      return;
    }

    const elapsedMs = performance.now() - startupSplashStartedAtRef.current;
    const exitDelayMs = Math.max(0, 1450 - elapsedMs);

    startupSplashExitTimeoutRef.current = window.setTimeout(() => {
      setStartupSplashExiting(true);
    }, exitDelayMs);

    startupSplashHideTimeoutRef.current = window.setTimeout(() => {
      setShowStartupSplash(false);
    }, exitDelayMs + 650);

    return () => {
      if (startupSplashExitTimeoutRef.current) {
        window.clearTimeout(startupSplashExitTimeoutRef.current);
        startupSplashExitTimeoutRef.current = null;
      }
      if (startupSplashHideTimeoutRef.current) {
        window.clearTimeout(startupSplashHideTimeoutRef.current);
        startupSplashHideTimeoutRef.current = null;
      }
    };
  }, [appInitialized]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (lightingAnimationRef.current) {
        window.clearInterval(lightingAnimationRef.current);
        lightingAnimationRef.current = null;
      }
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
      if (startupSplashExitTimeoutRef.current) {
        window.clearTimeout(startupSplashExitTimeoutRef.current);
        startupSplashExitTimeoutRef.current = null;
      }
      if (startupSplashHideTimeoutRef.current) {
        window.clearTimeout(startupSplashHideTimeoutRef.current);
        startupSplashHideTimeoutRef.current = null;
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
    activeLightingProfileId,
    activeProfileId,
    activeTab,
    adaptiveTriggers,
    audioSettings,
    calibrationProfile,
    closeToTray,
    firmwareRiskAccepted,
    launchOnStartup,
    leftTrigger,
    lightingEnabled,
    lightingDraft,
    mappingProfile,
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

  useEffect(() => {
    const previewColor = computeLightingColor(lightingDraft);
    setLightingPreviewRgb(previewColor);

    if (lightingAnimationRef.current) {
      window.clearInterval(lightingAnimationRef.current);
      lightingAnimationRef.current = null;
    }

    if (!hasLoadedPersistenceRef.current) {
      return;
    }

    if (!lightingEnabled) {
      pendingLightbarRef.current = { r: 0, g: 0, b: 0 };
      scheduleIpcFlush();
      return;
    }

    pendingLightbarRef.current = previewColor;
    scheduleIpcFlush();

    if (lightingDraft.effect === "static") {
      return;
    }

    const intervalMs = Math.max(45, 180 - clampPercent(lightingDraft.speed));
    lightingAnimationRef.current = window.setInterval(() => {
      const nextColor = computeLightingColor(lightingDraft);
      setLightingPreviewRgb(nextColor);
      pendingLightbarRef.current = nextColor;
      scheduleIpcFlush();
    }, intervalMs);

    return () => {
      if (lightingAnimationRef.current) {
        window.clearInterval(lightingAnimationRef.current);
        lightingAnimationRef.current = null;
      }
    };
  }, [
    lightingEnabled,
    lightingDraft,
    isConnected,
  ]);

  const initializeApp = async () => {
    try {
      const [presets, backendProfile, backendCalibration, liveSnapshot, capabilities, fwStatus, status, telemetryStatus] = await Promise.all([
        invoke<MappingProfile[]>("get_mapping_presets"),
        invoke<MappingProfile>("get_mapping_profile"),
        invoke<CalibrationProfile>("get_calibration_profile"),
        invoke<LiveInputSnapshot>("get_live_input_snapshot"),
        invoke<CalibrationCapabilities>("get_calibration_capabilities"),
        invoke<FirmwareCalibrationStatus>("get_firmware_calibration_status"),
        invoke<boolean>("get_controller_status"),
        invoke<GameTelemetryStatus>("get_game_telemetry_status"),
      ]);

      setMappingPresets(presets);
      setCalibrationCapabilities(capabilities);
      setLiveInput(liveSnapshot);
      setFirmwareStatus(fwStatus);
      setIsConnected(status);
      setGameTelemetryStatus(telemetryStatus);

      const [loadedHaptics, loadedCustomMappings, loadedLightingProfiles] = await Promise.all([
        loadHapticProfiles(),
        loadMappingProfiles(),
        loadLightingProfiles(),
      ]);

      await loadAppState(
        backendProfile,
        backendCalibration,
        presets,
        loadedCustomMappings,
        loadedHaptics,
        loadedLightingProfiles,
      );
      try {
        setLaunchOnStartup(await isAutostartEnabled());
      } catch (error) {
        console.error("Failed to read autostart state:", error);
      }
      hasLoadedPersistenceRef.current = true;
    } catch (e) {
      console.error("Failed to initialize app state:", e);
    } finally {
      setAppInitialized(true);
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
        left: normalizeTriggerEffect(tg.lt),
        right: normalizeTriggerEffect(tg.rt),
      }).catch(console.error);
      pendingTriggersRef.current = null;
    }
    const au = pendingAudioRef.current;
    if (au) {
      invoke("set_audio", { ...au }).catch(console.error);
      pendingAudioRef.current = null;
    }
  };

  const scheduleIpcFlush = () => {
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(flushIpc);
    }
  };

  const sendTriggers = (lt: TriggerEffect, rt: TriggerEffect) => {
    invoke("set_triggers", {
      left: normalizeTriggerEffect(lt),
      right: normalizeTriggerEffect(rt),
    }).catch(console.error);
  };

  useEffect(() => {
    const preview = computeAdaptiveTriggerPreview(adaptiveTriggers);
    const usingLiveTelemetry =
      adaptiveTriggers.enabled
      && adaptiveTriggers.inputSource === "live"
      && gameTelemetryStatus.stage === "attached"
      && gameTelemetryStatus.speedKph !== null;

    invoke("sync_adaptive_trigger_settings", {
      settings: normalizeAdaptiveTriggerSettings(adaptiveTriggers),
    }).catch(console.error);

    if (!adaptiveTriggers.enabled) {
      invoke("clear_adaptive_triggers").catch(console.error);
      return;
    }

    if (!usingLiveTelemetry) {
      invoke("set_adaptive_triggers", {
        left: normalizeTriggerEffect(preview.left),
        right: normalizeTriggerEffect(preview.right),
      }).catch(console.error);
      return;
    }
  }, [adaptiveTriggers, gameTelemetryStatus.speedKph, gameTelemetryStatus.stage]);

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
    lighting: {
      enabled: lightingEnabled,
      profileId: activeLightingProfileId,
      profile: cloneLightingProfile(lightingDraft),
    },
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
    audioSettings,
    adaptiveTriggers: cloneAdaptiveTriggerSettings(adaptiveTriggers),
  });

  const saveAppState = async (notify = false) => {
    try {
      await writeJsonFile(APP_STATE_FILE, {
        ...buildPersistedAppState(),
        schemaVersion: APP_STATE_SCHEMA_VERSION,
        runtimeSettings: createRuntimeSettingsSnapshot(launchOnStartup, startupOpenMode, closeToTray),
      });
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
    const parsed = await loadPersistedJson<HapticProfile[]>(TRIGGER_PROFILES_FILE, HAPTIC_PROFILES_FILE);
    if (Array.isArray(parsed)) {
      const customOnly = parsed
        .filter((profile) => !profile.builtIn)
        .map((profile) => ({
          ...cloneHapticProfile(profile),
          description: profile.description ?? "",
          category: profile.category ?? "Custom",
          left: migrateLegacyTriggerEffect(profile.left as TriggerEffect),
          right: migrateLegacyTriggerEffect(profile.right as TriggerEffect),
        }));
      setCustomHapticProfiles(customOnly);
      return customOnly;
    }

    setCustomHapticProfiles([]);
    return [] as HapticProfile[];
  };

  const saveHapticProfilesList = async (profiles: HapticProfile[]) => {
    try {
      await writeJsonFile(
        TRIGGER_PROFILES_FILE,
        profiles.map((profile) => ({ ...cloneHapticProfile(profile), builtIn: false })),
      );
    } catch (e) {
      console.error("Failed to save haptic profiles:", e);
    }
  };

  const loadMappingProfiles = async () => {
    const parsed = await loadPersistedJson<MappingProfile[]>(MAPPING_PROFILES_FILE);
    if (Array.isArray(parsed)) {
      const customOnly = parsed
        .map((profile) => normalizeMappingProfile(profile))
        .filter((profile) => !profile.builtIn);
      setCustomMappingProfiles(customOnly);
      return customOnly;
    }

    setCustomMappingProfiles([]);
    return [] as MappingProfile[];
  };

  const saveMappingProfilesList = async (profiles: MappingProfile[]) => {
    try {
      await writeJsonFile(
        MAPPING_PROFILES_FILE,
        profiles.map((profile) => ({
          ...normalizeMappingProfile(profile),
          builtIn: false,
        })),
      );
    } catch (e) {
      console.error("Failed to save mapping profiles:", e);
    }
  };

  const loadLightingProfiles = async () => {
    const parsed = await loadPersistedJson<LightingProfile[]>(LIGHTING_PROFILES_FILE);
    if (Array.isArray(parsed)) {
      const customOnly = parsed.filter((profile) => !profile.builtIn).map(cloneLightingProfile);
      setCustomLightingProfiles(customOnly);
      return customOnly;
    }

    setCustomLightingProfiles([]);
    return [] as LightingProfile[];
  };

  const saveLightingProfilesList = async (profiles: LightingProfile[]) => {
    try {
      await writeJsonFile(
        LIGHTING_PROFILES_FILE,
        profiles.map((profile) => ({ ...cloneLightingProfile(profile), builtIn: false })),
      );
    } catch (e) {
      console.error("Failed to save lighting profiles:", e);
    }
  };

  const commitMappingProfile = (profile: MappingProfile, profileId: string | null = null) => {
    const next = normalizeMappingProfile(cloneMappingProfile(profile));
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
    loadedLightingProfiles: LightingProfile[],
  ) => {
    const data = await loadVersionedAppState(APP_STATE_FILE, LEGACY_PROFILE_FILE);
    const resolvedState: PersistedAppState = data ?? {};
    const nextStartupOpenMode = normalizeStartupOpenMode(
      data?.runtimeSettings?.startupOpenMode ?? resolvedState.startupOpenMode,
    );
    const nextCloseToTray = Boolean(data?.runtimeSettings?.closeToTray ?? resolvedState.closeToTray);
    const nextLaunchOnStartup = Boolean(data?.runtimeSettings?.launchOnStartup ?? resolvedState.launchOnStartup);
    const lightingProfiles = [...BUILTIN_LIGHTING_PROFILES, ...loadedLightingProfiles];
    const legacyLightingProfileId = (
      resolvedState.lighting as (Partial<LightingSettings> & { presetId?: string }) | undefined
    )?.presetId ?? null;
    const legacyLightingProfile: LightingProfile = {
      id: "legacy-manual",
      name: "Manual Lighting",
      description: "Recovered from an older saved lighting configuration.",
      builtIn: false,
      effect: "static",
      color: {
        ...DEFAULT_LIGHTING.profile.color,
        ...(resolvedState.lighting?.profile?.color ?? resolvedState.rgb ?? {}),
      },
      accentColor: cloneLightingColor(resolvedState.lighting?.profile?.accentColor) ?? {
        ...DEFAULT_LIGHTING.profile.color,
        ...(resolvedState.lighting?.profile?.color ?? resolvedState.rgb ?? {}),
      },
      speed: clampPercent(
        resolvedState.lighting?.profile?.speed ?? DEFAULT_LIGHTING.profile.speed,
      ),
      brightness: clampPercent(
        resolvedState.lighting?.profile?.brightness ?? DEFAULT_LIGHTING.profile.brightness,
      ),
    };
    const persistedLighting = resolvedState.lighting;
    const matchedLightingProfile = getLightingProfile(
      lightingProfiles,
      persistedLighting?.profileId ?? legacyLightingProfileId,
    );
    const nextLightingProfile = persistedLighting?.profile
      ? cloneLightingProfile({ ...persistedLighting.profile, builtIn: Boolean(persistedLighting.profile.builtIn) })
      : matchedLightingProfile
        ? cloneLightingProfile(matchedLightingProfile)
        : cloneLightingProfile(legacyLightingProfile);
    const nextLighting: LightingSettings = {
      enabled: persistedLighting?.enabled ?? resolvedState.lightingEnabled ?? DEFAULT_LIGHTING.enabled,
      profileId: matchedLightingProfile?.id ?? null,
      profile: {
        ...nextLightingProfile,
        speed: clampPercent(nextLightingProfile.speed),
        brightness: clampPercent(nextLightingProfile.brightness),
        accentColor: usesAccentColor(nextLightingProfile.effect)
          ? cloneLightingColor(nextLightingProfile.accentColor) ?? { ...nextLightingProfile.color }
          : null,
      },
    };

    if (resolvedState.activeTab) {
      setActiveTab(resolvedState.activeTab === "triggers" ? "haptics" : resolvedState.activeTab);
    }

    if (resolvedState.firmwareRiskAccepted !== undefined) {
      setFirmwareRiskAccepted(Boolean(resolvedState.firmwareRiskAccepted));
    }

    setLightingEnabled(nextLighting.enabled);
    setActiveLightingProfileId(nextLighting.profileId);
    setLightingDraft(cloneLightingProfile(nextLighting.profile));
    const initialLightingColor = computeLightingColor(nextLighting.profile);
    setLightingPreviewRgb(initialLightingColor);
    const nextLightbarColor = nextLighting.enabled ? initialLightingColor : { r: 0, g: 0, b: 0 };
    invoke("set_lightbar", { ...nextLightbarColor }).catch(console.error);
    const lt = migrateLegacyTriggerEffect(resolvedState.leftTrigger as TriggerEffect | undefined);
    const rt = migrateLegacyTriggerEffect(resolvedState.rightTrigger as TriggerEffect | undefined);
    setLeftTrigger(lt);
    setRightTrigger(rt);
    sendTriggers(lt, rt);

    if (resolvedState.activeProfileId !== undefined) {
      setActiveProfileId(resolvedState.activeProfileId ?? null);
      const selectedHaptic = [...BUILTIN_HAPTIC_PROFILES, ...loadedHaptics].find((profile) => profile.id === resolvedState.activeProfileId);
      if (selectedHaptic) {
        setLeftTrigger(cloneTriggerEffect(selectedHaptic.left));
        setRightTrigger(cloneTriggerEffect(selectedHaptic.right));
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

    if (resolvedState.audioSettings && typeof resolvedState.audioSettings === "object") {
      const audio: AudioSettings = { ...DEFAULT_AUDIO, ...resolvedState.audioSettings };
      setAudioSettings(audio);
      invoke("set_audio", { ...audio }).catch(console.error);
    }

    setAdaptiveTriggers(normalizeAdaptiveTriggerSettings(resolvedState.adaptiveTriggers));

    setLaunchOnStartup(nextLaunchOnStartup);
    setStartupOpenMode(nextStartupOpenMode);
    setCloseToTray(nextCloseToTray);

    const allMappingProfiles = [...builtInMappingPresets, ...loadedCustomMappings];
    if (resolvedState.activeMappingProfileId) {
      const activeProfile = allMappingProfiles.find((profile) => profile.id === resolvedState.activeMappingProfileId);
      if (activeProfile) {
        commitMappingProfile(activeProfile, activeProfile.id);
      } else if (resolvedState.manualMappingProfile) {
        commitMappingProfile(toManualProfile(normalizeMappingProfile(resolvedState.manualMappingProfile)), null);
      } else {
        commitMappingProfile(defaultMappingProfile, defaultMappingProfile.builtIn ? defaultMappingProfile.id : null);
      }
    } else if (resolvedState.manualMappingProfile && typeof resolvedState.manualMappingProfile === "object") {
      commitMappingProfile(toManualProfile(normalizeMappingProfile(resolvedState.manualMappingProfile)), null);
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

  const updateAdaptiveTriggerSettings = (
    updater: (current: AdaptiveTriggerSettings) => AdaptiveTriggerSettings,
  ) => {
    setAdaptiveTriggers((current) => normalizeAdaptiveTriggerSettings(updater(cloneAdaptiveTriggerSettings(current))));
  };

  const updateNfsHeatAdaptiveSettings = (
    patch: Partial<AdaptiveTriggerSettings["nfsHeat"]>,
  ) => {
    updateAdaptiveTriggerSettings((current) => ({
      ...current,
      nfsHeat: {
        ...current.nfsHeat,
        ...patch,
      },
    }));
  };

  const closeOcrCalibrationModal = () => {
    setOcrCalibrationDragging(false);
    setOcrCalibrationPreview(null);
    setOcrCalibrationDraft(null);
    ocrDragOriginRef.current = null;
  };

  const loadOcrCalibrationPreview = async () => {
    setOcrCalibrationLoading(true);
    try {
      const preview = await invoke<OcrCalibrationPreviewPayload>("capture_live_ocr_calibration_preview", {
        settings: normalizeAdaptiveTriggerSettings(adaptiveTriggers),
      });
      setOcrCalibrationPreview(preview);
      setOcrCalibrationDraft(adaptiveTriggers.nfsHeat.ocrCalibration
        ? {
            originX: adaptiveTriggers.nfsHeat.ocrCalibration.x,
            originY: adaptiveTriggers.nfsHeat.ocrCalibration.y,
            width: adaptiveTriggers.nfsHeat.ocrCalibration.width,
            height: adaptiveTriggers.nfsHeat.ocrCalibration.height,
          }
        : null);
    } catch (error) {
      console.error("Failed to capture OCR calibration preview:", error);
      showToast({
        title: "Calibration capture failed",
        message: error instanceof Error ? error.message : "WinSense could not capture the selected OCR target window.",
        tone: "error",
      });
    } finally {
      setOcrCalibrationLoading(false);
    }
  };

  const loadOcrProcessOptions = async () => {
    setOcrProcessOptionsLoading(true);
    try {
      const options = await invoke<ActiveProcessOption[]>("list_live_ocr_process_options");
      setOcrProcessOptions(options);
    } catch (error) {
      console.error("Failed to list OCR process options:", error);
      setOcrProcessOptions([]);
    } finally {
      setOcrProcessOptionsLoading(false);
    }
  };

  const resetOcrCalibration = () => {
    updateNfsHeatAdaptiveSettings({ ocrCalibration: null });
    showToast({
      title: "OCR calibration cleared",
      message: "WinSense will wait for a new speedometer region before reading live speed again.",
      tone: "success",
    });
  };

  const saveOcrCalibration = () => {
    if (!ocrCalibrationPreview || !ocrCalibrationDraft || ocrCalibrationDraft.width < 8 || ocrCalibrationDraft.height < 8) {
      showToast({
        title: "Selection too small",
        message: "Draw a rectangle around the speed digits before saving the OCR calibration.",
        tone: "error",
      });
      return;
    }

    const region: OcrCalibrationRegion = {
      x: ocrCalibrationDraft.originX,
      y: ocrCalibrationDraft.originY,
      width: ocrCalibrationDraft.width,
      height: ocrCalibrationDraft.height,
      referenceWidth: ocrCalibrationPreview.width,
      referenceHeight: ocrCalibrationPreview.height,
    };
    updateNfsHeatAdaptiveSettings({ ocrCalibration: region });
    closeOcrCalibrationModal();
    showToast({
      title: "OCR calibration saved",
      message: "WinSense will use the selected speedometer region for live OCR reads.",
      tone: "success",
    });
  };

  const getPreviewRelativePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ocrCalibrationPreview || !ocrPreviewImageRef.current) {
      return null;
    }

    const bounds = ocrPreviewImageRef.current.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }

    const scaleX = ocrCalibrationPreview.width / bounds.width;
    const scaleY = ocrCalibrationPreview.height / bounds.height;
    const x = Math.max(0, Math.min(ocrCalibrationPreview.width, Math.round((event.clientX - bounds.left) * scaleX)));
    const y = Math.max(0, Math.min(ocrCalibrationPreview.height, Math.round((event.clientY - bounds.top) * scaleY)));
    return { x, y };
  };

  const beginOcrCalibrationDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = getPreviewRelativePoint(event);
    if (!point) {
      return;
    }

    ocrDragOriginRef.current = point;
    setOcrCalibrationDragging(true);
    setOcrCalibrationDraft({
      originX: point.x,
      originY: point.y,
      width: 1,
      height: 1,
    });
  };

  const updateOcrCalibrationDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ocrCalibrationDragging || !ocrCalibrationPreview || !ocrDragOriginRef.current) {
      return;
    }

    const point = getPreviewRelativePoint(event);
    if (!point) {
      return;
    }

    const start = ocrDragOriginRef.current;
    const originX = Math.max(0, Math.min(start.x, point.x));
    const originY = Math.max(0, Math.min(start.y, point.y));
    const width = Math.max(1, Math.abs(point.x - start.x));
    const height = Math.max(1, Math.abs(point.y - start.y));

    setOcrCalibrationDraft({
      originX,
      originY,
      width: Math.min(width, ocrCalibrationPreview.width - originX),
      height: Math.min(height, ocrCalibrationPreview.height - originY),
    });
  };

  const finishOcrCalibrationDrag = () => {
    setOcrCalibrationDragging(false);
    ocrDragOriginRef.current = null;
  };

  useEffect(() => {
    if (activeTab !== "adaptiveTriggers" || adaptiveTriggers.inputSource !== "live") {
      return;
    }

    void loadOcrProcessOptions();
  }, [activeTab, adaptiveTriggers.inputSource]);

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

  const persistCustomLightingProfiles = (profiles: LightingProfile[]) => {
    const normalized = profiles.map((profile) => ({ ...cloneLightingProfile(profile), builtIn: false }));
    setCustomLightingProfiles(normalized);
    void saveLightingProfilesList(normalized);
  };

  const commitLightingProfile = (profile: LightingProfile, profileId: string | null = null) => {
    setLightingDraft(cloneLightingProfile(profile));
    setActiveLightingProfileId(profileId);
  };

  const updateLightingDraft = (updater: (profile: LightingProfile) => LightingProfile) => {
    setLightingDraft((current) => {
      const next = cloneLightingProfile(updater(cloneLightingProfile(current)));
      if (!usesAccentColor(next.effect)) {
        next.accentColor = null;
      } else if (!next.accentColor) {
        next.accentColor = { ...next.color };
      }
      next.speed = clampPercent(next.speed);
      next.brightness = clampPercent(next.brightness);
      return next;
    });
    setActiveLightingProfileId(null);
  };

  const handleColorChange = (color: keyof LightingColor, value: number) => {
    updateLightingDraft((profile) => ({
      ...profile,
      color: { ...profile.color, [color]: value },
      accentColor: usesAccentColor(profile.effect)
        ? profile.accentColor ?? { ...profile.color, [color]: value }
        : null,
    }));
  };

  const handleAccentColorChange = (color: keyof LightingColor, value: number) => {
    updateLightingDraft((profile) => ({
      ...profile,
      accentColor: {
        ...(profile.accentColor ?? profile.color),
        [color]: value,
      },
    }));
  };

  const handleLightingEffectChange = (effect: LightingEffect) => {
    updateLightingDraft((profile) => ({
      ...profile,
      effect,
      accentColor: usesAccentColor(effect)
        ? cloneLightingColor(profile.accentColor) ?? { ...profile.color }
        : null,
    }));
  };

  const applyLightingProfile = (profile: LightingProfile) => {
    commitLightingProfile(profile, profile.id);
  };

  const startNewLightingProfile = () => {
    setActiveLightingProfileId(null);
    setLightingDraft(createCustomLightingProfileDraft());
  };

  const saveLightingProfile = () => {
    const trimmedName = lightingDraft.name.trim();
    if (!trimmedName) {
      return;
    }

    const shouldCreateNewProfile = lightingDraft.builtIn
      || BUILTIN_LIGHTING_PROFILES.some((profile) => profile.id === lightingDraft.id);
    const nextProfile: LightingProfile = {
      ...cloneLightingProfile(lightingDraft),
      id: shouldCreateNewProfile ? generateLightingProfileId() : lightingDraft.id,
      name: trimmedName,
      description: lightingDraft.description.trim(),
      builtIn: false,
    };
    const exists = customLightingProfiles.some((profile) => profile.id === nextProfile.id);
    const updatedProfiles = exists
      ? customLightingProfiles.map((profile) => profile.id === nextProfile.id ? nextProfile : profile)
      : [...customLightingProfiles, nextProfile];

    persistCustomLightingProfiles(updatedProfiles);
    commitLightingProfile(nextProfile, nextProfile.id);
    showToast({
      title: exists ? "Lighting profile updated" : "Lighting profile saved",
      message: exists
        ? `${nextProfile.name} was updated in your lighting library.`
        : `${nextProfile.name} was added to your lighting library.`,
      tone: "success",
    });
  };

  const deleteLightingProfile = (profileId: string) => {
    const profile = customLightingProfiles.find((item) => item.id === profileId);
    const updatedProfiles = customLightingProfiles.filter((item) => item.id !== profileId);
    persistCustomLightingProfiles(updatedProfiles);

    if (activeLightingProfileId === profileId) {
      const fallback = BUILTIN_LIGHTING_PROFILES[0];
      commitLightingProfile(fallback, fallback.id);
    }

    if (lightingDraft.id === profileId) {
      startNewLightingProfile();
    }

    showToast({
      title: "Lighting profile deleted",
      message: `${profile?.name ?? "Custom profile"} was removed from your lighting library.`,
      tone: "success",
    });
  };

  const toggleLighting = () => {
    setLightingEnabled((current) => !current);
  };

  const handleAudioChange = <K extends keyof AudioSettings>(field: K, value: AudioSettings[K]) => {
    const next = { ...audioSettings, [field]: value };
    setAudioSettings(next);
    pendingAudioRef.current = next;
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(flushIpc);
    }
  };

  const handleTestSpeaker = async () => {
    if (speakerTestActive) return;
    setSpeakerTestError(null);
    setSpeakerTestActive(true);
    try {
      await invoke("test_speaker");
    } catch (error) {
      const message = typeof error === "string" ? error : "Speaker test failed to start.";
      setSpeakerTestActive(false);
      setSpeakerTestError(message);
      showToast({
        title: "Speaker test unavailable",
        message,
        tone: "error",
      });
      return;
    }
    const poll = setInterval(async () => {
      try {
        const [spk] = await invoke<[boolean, boolean]>("get_audio_test_status");
        if (!spk) {
          setSpeakerTestActive(false);
          clearInterval(poll);
        }
      } catch {
        setSpeakerTestActive(false);
        clearInterval(poll);
      }
    }, 200);
  };

  const handleMicTest = async () => {
    setMicTestError(null);
    if (micTestActive) {
      invoke("stop_mic_test").catch(console.error);
      setMicTestActive(false);
    } else {
      try {
        await invoke("start_mic_test");
        setMicTestActive(true);
      } catch (e: unknown) {
        setMicTestError(typeof e === "string" ? e : "Failed to start mic test.");
      }
    }
  };

  const updateTriggerEffect = (
    side: "left" | "right",
    updater: (effect: TriggerEffect) => TriggerEffect,
    options?: { preserveProfile?: boolean },
  ) => {
    const preserveProfile = options?.preserveProfile ?? false;
    const nextLeft = side === "left" ? normalizeTriggerEffect(updater(cloneTriggerEffect(leftTrigger))) : cloneTriggerEffect(leftTrigger);
    const nextRight = side === "right" ? normalizeTriggerEffect(updater(cloneTriggerEffect(rightTrigger))) : cloneTriggerEffect(rightTrigger);
    const finalLeft = linkTriggerEditing && side === "left" ? cloneTriggerEffect(nextLeft) : nextLeft;
    const finalRight = linkTriggerEditing && side === "left" ? cloneTriggerEffect(nextLeft) : nextRight;
    const mirroredLeft = linkTriggerEditing && side === "right" ? cloneTriggerEffect(nextRight) : finalLeft;
    const mirroredRight = linkTriggerEditing && side === "right" ? cloneTriggerEffect(nextRight) : finalRight;

    if (!preserveProfile) {
      setActiveProfileId(null);
    }
    setLeftTrigger(mirroredLeft);
    setRightTrigger(mirroredRight);
    pendingTriggersRef.current = { lt: mirroredLeft, rt: mirroredRight };
    scheduleIpcFlush();
  };

  const applyTriggerEffectKind = (side: "left" | "right", kind: TriggerEffectKind) => {
    updateTriggerEffect(side, (effect) => {
      const next = cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT);
      next.kind = kind;
      next.startPosition = effect.startPosition ?? next.startPosition;
      next.endPosition = effect.endPosition ?? next.endPosition;
      next.force = effect.force ?? next.force;
      next.frequency = effect.frequency ?? next.frequency;
      next.rawMode = kind === "raw" ? effect.rawMode ?? 0 : getTriggerEffectDefinition(kind).mode;
      next.rawParams = effect.rawParams ? [...effect.rawParams] : [...(next.rawParams ?? [])];
      return next;
    });
  };

  const updateTriggerNumericField = (
    side: "left" | "right",
    field: "startPosition" | "endPosition" | "force" | "frequency" | "rawMode",
    value: number,
  ) => {
    updateTriggerEffect(side, (effect) => ({ ...effect, [field]: value }));
  };

  const updateTriggerRawParam = (side: "left" | "right", index: number, value: number) => {
    updateTriggerEffect(side, (effect) => {
      const rawParams = [...(effect.rawParams ?? Array(10).fill(0))];
      rawParams[index] = clampU8(value);
      return { ...effect, rawParams };
    });
  };

  const resetTriggerSide = (side: "left" | "right") => {
    updateTriggerEffect(side, () => cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT));
  };

  const copyTriggerSide = (from: "left" | "right", to: "left" | "right") => {
    const source = from === "left" ? leftTrigger : rightTrigger;
    const next = cloneTriggerEffect(source);
    if (to === "left") {
      setActiveProfileId(null);
      setLeftTrigger(next);
      pendingTriggersRef.current = { lt: next, rt: cloneTriggerEffect(rightTrigger) };
    } else {
      setActiveProfileId(null);
      setRightTrigger(next);
      pendingTriggersRef.current = { lt: cloneTriggerEffect(leftTrigger), rt: next };
    }
    scheduleIpcFlush();
  };

  const startNewHapticProfile = () => {
    setEditingHapticProfile(createHapticProfileDraft(leftTrigger, rightTrigger));
  };

  const loadHapticProfileForEditing = (profile: HapticProfile) => {
    setLeftTrigger(cloneTriggerEffect(profile.left));
    setRightTrigger(cloneTriggerEffect(profile.right));
    pendingTriggersRef.current = { lt: cloneTriggerEffect(profile.left), rt: cloneTriggerEffect(profile.right) };
    scheduleIpcFlush();
    setEditingHapticProfile(cloneHapticProfile({
      ...profile,
      builtIn: false,
      id: profile.builtIn ? createHapticProfileDraft(profile.left, profile.right).id : profile.id,
    }));
    setActiveProfileId(profile.builtIn ? null : profile.id);
  };

  const persistCustomHapticProfiles = (profiles: HapticProfile[]) => {
    const normalized = profiles.map((profile) => ({ ...cloneHapticProfile(profile), builtIn: false }));
    setCustomHapticProfiles(normalized);
    void saveHapticProfilesList(normalized);
  };

  const allHapticProfiles = [...BUILTIN_HAPTIC_PROFILES, ...customHapticProfiles];

  const applyHapticProfile = (profile: HapticProfile) => {
    setActiveProfileId(profile.id);
    setLeftTrigger(cloneTriggerEffect(profile.left));
    setRightTrigger(cloneTriggerEffect(profile.right));
    sendTriggers(profile.left, profile.right);
  };

  const saveHapticProfile = (profile: HapticProfile) => {
    const trimmedName = profile.name.trim();
    if (!trimmedName) return;

    const nextProfile: HapticProfile = {
      ...cloneHapticProfile(profile),
      name: trimmedName,
      description: profile.description.trim(),
      category: profile.category.trim() || "Custom",
      builtIn: false,
    };
    const exists = customHapticProfiles.some((item) => item.id === nextProfile.id);
    const updatedProfiles = exists
      ? customHapticProfiles.map((item) => item.id === nextProfile.id ? nextProfile : item)
      : [...customHapticProfiles, nextProfile];
    persistCustomHapticProfiles(updatedProfiles);
    setEditingHapticProfile(nextProfile);
    setActiveProfileId(nextProfile.id);
    showToast({
      title: exists ? "Haptic profile updated" : "Haptic profile saved",
      message: exists
        ? `${nextProfile.name} was updated in your haptic library.`
        : `${nextProfile.name} was added to your haptic library.`,
      tone: "success",
    });
  };

  const deleteHapticProfile = (id: string) => {
    const profile = customHapticProfiles.find((item) => item.id === id);
    const updated = customHapticProfiles.filter((item) => item.id !== id);
    persistCustomHapticProfiles(updated);
    if (activeProfileId === id) setActiveProfileId(null);
    if (editingHapticProfile?.id === id) setEditingHapticProfile(null);
    showToast({
      title: "Haptic profile deleted",
      message: `${profile?.name ?? "Custom profile"} was removed from your haptic library.`,
      tone: "success",
    });
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
    const normalized = profiles.map((profile) => ({
      ...normalizeMappingProfile(cloneMappingProfile(profile)),
      builtIn: false,
    }));
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
      ...normalizeMappingProfile(cloneMappingProfile(mappingProfile)),
      id: generateMappingProfileId(),
      name: "",
      builtIn: false,
    });
  };

  const saveMappingLibraryProfile = (profile: MappingProfile) => {
    const nextProfile = {
      ...normalizeMappingProfile(cloneMappingProfile(profile)),
      builtIn: false,
    };
    const exists = customMappingProfiles.some((item) => item.id === nextProfile.id);
    const updatedProfiles = exists
      ? customMappingProfiles.map((item) => item.id === nextProfile.id ? nextProfile : item)
      : [...customMappingProfiles, nextProfile];

    persistCustomMappingProfiles(updatedProfiles);
    setEditingMappingProfile(null);
    commitMappingProfile(nextProfile, nextProfile.id);
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
    setEditingMappingProfile(normalizeMappingProfile(cloneMappingProfile(profile)));
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

  const handleMappingEmulationTargetChange = (target: MappingProfile["emulationTarget"]) => {
    updateCurrentMappingProfile((profile) => convertMappingProfileEmulationTarget(profile, target));
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

  const resetStickCalibration = (side: "leftStick" | "rightStick") => {
    updateCalibration(profile => ({
      ...profile,
      [side]: { ...DEFAULT_CALIBRATION_PROFILE[side] },
    }));
  };

  const resetTriggerCalibration = (side: "leftTrigger" | "rightTrigger") => {
    updateCalibration(profile => ({
      ...profile,
      [side]: { ...DEFAULT_CALIBRATION_PROFILE[side] },
    }));
  };

  const runFirmwareCommand = async (command: string) => {
    try {
      const status = await invoke<FirmwareCalibrationStatus>(command);
      setFirmwareStatus(status);
    } catch (e) {
      console.error(`Failed to run firmware calibration command "${command}":`, e);
      const message = e instanceof Error ? e.message : String(e);
      setFirmwareStatus((current) => ({
        ...current,
        busy: false,
        step: "error",
        canSampleCenter: false,
        canStoreTemporarily: false,
        canStorePermanently: false,
        requiresStickRotation: false,
        lastError: message,
        lastMessage: `Firmware calibration command failed: ${message}`,
      }));
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

  const allLightingProfiles = [...BUILTIN_LIGHTING_PROFILES, ...customLightingProfiles];
  const activeLightingProfile = getLightingProfile(allLightingProfiles, activeLightingProfileId);
  const isSavedLightingProfile = Boolean(activeLightingProfileId);
  const isEditingCustomLightingProfile = customLightingProfiles.some((profile) => profile.id === lightingDraft.id);
  const activeHapticProfile = allHapticProfiles.find((profile) => profile.id === activeProfileId) ?? null;
  const ocrCalibrationReady = adaptiveTriggers.nfsHeat.ocrCalibration !== null;
  const manualOcrProcessName = adaptiveTriggers.nfsHeat.ocrProcessName;
  const liveTelemetryAttached = adaptiveTriggers.inputSource === "live" && gameTelemetryStatus.stage === "attached";
  const adaptivePreview = liveTelemetryAttached
    ? computeNeedForSpeedHeatAdaptiveTriggersForSpeed(
      adaptiveTriggers.nfsHeat,
      gameTelemetryStatus.speedKph ?? adaptiveTriggers.nfsHeat.demoSpeedKph,
    )
    : computeAdaptiveTriggerPreview(adaptiveTriggers);
  const adaptiveStrengthPercent = Math.round(adaptivePreview.normalizedSpeed * 100);
  const adaptiveActiveSpeedKph = adaptivePreview.speedKph;
  const adaptiveStatusTone = getTelemetryToneClasses(gameTelemetryStatus.stage);
  const calibrationDraftStyle = ocrCalibrationPreview && ocrCalibrationDraft
    ? {
        left: `${(ocrCalibrationDraft.originX / ocrCalibrationPreview.width) * 100}%`,
        top: `${(ocrCalibrationDraft.originY / ocrCalibrationPreview.height) * 100}%`,
        width: `${(ocrCalibrationDraft.width / ocrCalibrationPreview.width) * 100}%`,
        height: `${(ocrCalibrationDraft.height / ocrCalibrationPreview.height) * 100}%`,
      }
    : null;
  const speakerTestSupported = isConnected && firmwareStatus.transport !== "unknown";
  const micTestSupported = isConnected && firmwareStatus.transport !== "unknown";
  const bluetoothAudioExperimental = firmwareStatus.transport === "bluetooth";
  const transportLabel = getTransportLabel(firmwareStatus.transport);
  const transportIcon = firmwareStatus.transport === "bluetooth" ? Bluetooth : Usb;
  const previewGlow = `rgba(${lightingPreviewRgb.r}, ${lightingPreviewRgb.g}, ${lightingPreviewRgb.b}, 0.45)`;
  const TransportIcon = transportIcon;

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
      {ocrCalibrationPreview && (
        <div className="absolute inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-[#101010] shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
              <div>
                <h3 className="text-xl font-semibold">Calibrate Racing Game OCR Region</h3>
                <p className="text-sm text-white/45 mt-1">
                  Drag a tight rectangle around the in-game speed digits. WinSense will crop and OCR only this region during Live mode.
                </p>
              </div>
              <button
                type="button"
                onClick={closeOcrCalibrationModal}
                className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/5"
              >
                Close
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div
                className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 select-none"
                onPointerDown={beginOcrCalibrationDrag}
                onPointerMove={updateOcrCalibrationDrag}
                onPointerUp={finishOcrCalibrationDrag}
                onPointerLeave={finishOcrCalibrationDrag}
              >
                <img
                  ref={ocrPreviewImageRef}
                  src={ocrCalibrationPreview.imageDataUrl}
                  alt="Racing game OCR preview"
                  className="block w-full h-auto max-h-[65vh] object-contain"
                  draggable={false}
                />
                {calibrationDraftStyle && (
                  <div
                    className="absolute border-2 border-cyan-400 bg-cyan-400/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] pointer-events-none"
                    style={calibrationDraftStyle}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-white/45">
                  {ocrCalibrationDraft
                    ? `Selection: ${ocrCalibrationDraft.width} x ${ocrCalibrationDraft.height} at ${ocrCalibrationDraft.originX}, ${ocrCalibrationDraft.originY}`
                    : "Click and drag over the screenshot to define the speedometer crop."}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void loadOcrCalibrationPreview()}
                    disabled={ocrCalibrationLoading}
                    className="px-4 py-2 rounded-xl text-sm font-medium glass-button disabled:opacity-60"
                  >
                    Refresh Preview
                  </button>
                  <button
                    type="button"
                    onClick={saveOcrCalibration}
                    className="px-4 py-2 rounded-xl text-sm font-medium bg-cyan-500 text-slate-950"
                  >
                    Save Calibration
                  </button>
                </div>
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

      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Background ambient glow */}
        <div
          className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full opacity-20 blur-[80px] pointer-events-none"
          style={{
            background: lightingEnabled
              ? `radial-gradient(circle, rgb(${lightingPreviewRgb.r}, ${lightingPreviewRgb.g}, ${lightingPreviewRgb.b}) 0%, transparent 70%)`
              : "transparent",
          }}
        />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full opacity-10 blur-[120px] pointer-events-none bg-blue-600"></div>

        {isConnected ? (
          <>
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
                  { id: "haptics", icon: Zap, label: "Haptics" },
                  { id: "adaptiveTriggers", icon: Sliders, label: "Adaptive Triggers" },
                  { id: "audio", icon: Volume2, label: "Audio" },
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
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors duration-300 bg-green-500/10 border-green-500/20">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>
                  <span className="text-sm font-medium text-green-400">Connected</span>
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
                    style={{ filter: (isConnected && lightingEnabled) ? `drop-shadow(0 10px 20px ${previewGlow})` : "none" }}
                  />
                  
                  {isConnected ? (
                    <div className="flex gap-6 z-10">
                      <div className="flex items-center gap-2 glass px-4 py-2 rounded-full">
                        <Battery size={16} className="text-green-400" />
                        <span className="text-sm font-medium">85%</span>
                      </div>
                      <div className="flex items-center gap-2 glass px-4 py-2 rounded-full">
                        <TransportIcon
                          size={16}
                          className={firmwareStatus.transport === "bluetooth" ? "text-cyan-400" : "text-blue-400"}
                        />
                        <span className="text-sm font-medium">{transportLabel}</span>
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
                          const reset = cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT);
                          setLeftTrigger(reset);
                          setRightTrigger(cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT));
                          setActiveProfileId(null);
                          sendTriggers(reset, cloneTriggerEffect(DEFAULT_TRIGGER_EFFECT));
                        }}
                        className="w-full glass-button py-3 rounded-xl font-medium flex justify-center items-center gap-2 text-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Reset Haptics
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
            <MappingEditor
              mappingProfile={mappingProfile}
              activeMappingProfileId={activeMappingProfileId}
              mappingPresets={mappingPresets}
              customMappingProfiles={customMappingProfiles}
              editingMappingProfile={editingMappingProfile}
              onSelectProfile={(profileId) => {
                if (profileId) {
                  applyMappingPreset(profileId);
                  return;
                }
                commitMappingProfile(toManualProfile(mappingProfile), null);
              }}
              onCreateProfile={createMappingProfileFromCurrent}
              onSaveEditingProfile={saveMappingLibraryProfile}
              onEditingProfileChange={setEditingMappingProfile}
              onDeleteProfile={deleteMappingLibraryProfile}
              onLoadProfileForEditing={loadCustomMappingProfileForEditing}
              onEmulationTargetChange={handleMappingEmulationTargetChange}
              onButtonBindingTypeChange={handleButtonBindingTypeChange}
              onButtonBindingChange={handleButtonBindingValueChange}
              onStickBindingChange={handleStickBindingChange}
              onTriggerBindingChange={handleTriggerBindingChange}
            />
          )}

          {activeTab === "calibration" && (
            <CalibrationPanel
              calibrationProfile={calibrationProfile}
              liveInput={liveInput}
              calibrationCapabilities={calibrationCapabilities}
              firmwareStatus={firmwareStatus}
              firmwareRiskAccepted={firmwareRiskAccepted}
              onFirmwareRiskAcceptedChange={setFirmwareRiskAccepted}
              onResetCalibration={resetCalibration}
              onSetStickCenterFromCurrent={setStickCenterFromCurrent}
              onResetStick={resetStickCalibration}
              onUpdateStick={(side, nextStick) => updateCalibration(profile => ({ ...profile, [side]: nextStick }))}
              onResetTrigger={resetTriggerCalibration}
              onUpdateTrigger={(side, nextTrigger) => updateCalibration(profile => ({ ...profile, [side]: nextTrigger }))}
              onRunFirmwareCommand={(command) => void runFirmwareCommand(command)}
            />
          )}

          {activeTab === "lighting" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex justify-between items-end mb-10">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Lighting</h2>
                  <p className="text-white/50">Build your own lighting library with saved static, cycle, pulse, and wave profiles.</p>
                </div>
                <button
                  onClick={toggleLighting}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors ${lightingEnabled ? 'bg-blue-600 text-white' : 'glass-button text-white/50'}`}
                >
                  <Power size={18} /> {lightingEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.95fr)] gap-6">
                <div className="space-y-6">
                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-semibold">Lighting Library</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Built-ins are ready to use, and custom profiles can be saved, updated, and deleted.
                        </p>
                      </div>
                      <button
                        onClick={startNewLightingProfile}
                        className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                      >
                        <Plus size={16} /> New Profile
                      </button>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/30 mb-3">Built-in</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {BUILTIN_LIGHTING_PROFILES.map((profile) => {
                            const swatch = computeLightingColor(profile);
                            const isActive = activeLightingProfileId === profile.id;

                            return (
                              <button
                                key={profile.id}
                                type="button"
                                onClick={() => applyLightingProfile(profile)}
                                className={`text-left rounded-2xl border p-4 transition-all duration-200 ${
                                  isActive
                                    ? "border-blue-400/40 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.2)]"
                                    : "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-4 mb-4">
                                  <div>
                                    <div className="font-semibold text-white">{profile.name}</div>
                                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/35">{profile.effect}</div>
                                  </div>
                                  <div
                                    className="h-11 w-11 rounded-xl border border-white/10 shrink-0"
                                    style={{
                                      background: `linear-gradient(135deg, rgb(${swatch.r}, ${swatch.g}, ${swatch.b}) 0%, rgba(${swatch.r}, ${swatch.g}, ${swatch.b}, 0.55) 100%)`,
                                      boxShadow: `0 0 22px rgba(${swatch.r}, ${swatch.g}, ${swatch.b}, 0.28)`,
                                    }}
                                  />
                                </div>
                                <p className="text-sm leading-relaxed text-white/55">{profile.description}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/30 mb-3">Custom</div>
                        <div className="space-y-3">
                          {customLightingProfiles.map((profile) => {
                            const swatch = computeLightingColor(profile);
                            const isActive = activeLightingProfileId === profile.id;

                            return (
                              <div
                                key={profile.id}
                                className={`rounded-2xl border p-4 transition-colors ${
                                  isActive
                                    ? "border-fuchsia-400/40 bg-fuchsia-500/10"
                                    : "border-white/8 bg-white/[0.03]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <button type="button" onClick={() => applyLightingProfile(profile)} className="flex-1 text-left">
                                    <div className="flex items-start justify-between gap-4">
                                      <div>
                                        <div className="font-semibold text-white">{profile.name}</div>
                                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/35">{profile.effect}</div>
                                        <p className="mt-2 text-sm text-white/50">{profile.description || "Custom lighting profile"}</p>
                                      </div>
                                      <div
                                        className="h-11 w-11 rounded-xl border border-white/10 shrink-0"
                                        style={{
                                          background: `linear-gradient(135deg, rgb(${swatch.r}, ${swatch.g}, ${swatch.b}) 0%, rgba(${swatch.r}, ${swatch.g}, ${swatch.b}, 0.55) 100%)`,
                                          boxShadow: `0 0 22px rgba(${swatch.r}, ${swatch.g}, ${swatch.b}, 0.28)`,
                                        }}
                                      />
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteLightingProfile(profile.id)}
                                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-white/40 hover:text-red-400"
                                    title="Delete profile"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {customLightingProfiles.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-white/35">
                              No custom lighting profiles yet. Start from a built-in effect or create one from scratch.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="mb-8 p-1 rounded-2xl glass">
                      <div
                        className="h-28 rounded-xl w-full transition-colors duration-300 relative overflow-hidden"
                        style={{
                          background: `linear-gradient(90deg, rgba(${lightingPreviewRgb.r}, ${lightingPreviewRgb.g}, ${lightingPreviewRgb.b}, 0.7) 0%, rgb(${lightingPreviewRgb.r}, ${lightingPreviewRgb.g}, ${lightingPreviewRgb.b}) 50%, rgba(${lightingPreviewRgb.r}, ${lightingPreviewRgb.g}, ${lightingPreviewRgb.b}, 0.7) 100%)`,
                          boxShadow: `inset 0 0 20px rgba(0,0,0,0.2), 0 0 40px ${previewGlow}`,
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/70">
                        Live preview: <span className="text-white font-medium">{lightingDraft.name.trim() || "Untitled Draft"}</span>
                      </span>
                      <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/50">
                        Effect: <span className="text-white/80 capitalize">{lightingDraft.effect}</span>
                      </span>
                      <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/50">
                        {isSavedLightingProfile ? "Applied saved profile" : "Unsaved draft"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-lg font-semibold">Profile Editor</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Changes update the live preview immediately. Save when you want to reuse the profile later.
                        </p>
                      </div>
                      {!lightingEnabled && (
                        <span className="text-xs uppercase tracking-[0.18em] text-amber-300/70">Output off</span>
                      )}
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">Profile Name</label>
                        <input
                          type="text"
                          value={lightingDraft.name}
                          placeholder="My Neon Wave"
                          onChange={(e) => updateLightingDraft((profile) => ({ ...profile, name: e.target.value, builtIn: false }))}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">Description</label>
                        <textarea
                          value={lightingDraft.description}
                          placeholder="Describe when you like to use this lighting profile."
                          onChange={(e) => updateLightingDraft((profile) => ({ ...profile, description: e.target.value, builtIn: false }))}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20 min-h-[88px] resize-y"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-3">Effect Type</label>
                        <div className="relative">
                          <select
                            value={lightingDraft.effect}
                            onChange={(e) => handleLightingEffectChange(e.target.value as LightingEffect)}
                            className="w-full glass-input rounded-xl p-4 text-white outline-none appearance-none font-medium"
                          >
                            <option value="static" className="bg-neutral-900">Static</option>
                            <option value="cycle" className="bg-neutral-900">Cycle</option>
                            <option value="pulse" className="bg-neutral-900">Pulse</option>
                            <option value="wave" className="bg-neutral-900">Wave</option>
                          </select>
                          <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                        </div>
                      </div>

                      <SliderRow
                        label="Brightness"
                        value={lightingDraft.brightness}
                        max={100}
                        color="bg-blue-500"
                        onChange={(value) => updateLightingDraft((profile) => ({ ...profile, brightness: value }))}
                      />

                      <SliderRow
                        label="Animation Speed"
                        value={lightingDraft.speed}
                        max={100}
                        color="bg-fuchsia-500"
                        onChange={(value) => updateLightingDraft((profile) => ({ ...profile, speed: value }))}
                      />
                    </div>
                  </div>

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold">Primary Color</h3>
                      <p className="text-sm text-white/45 mt-1">
                        Static profiles use this color directly. Animated profiles use it as the main tone.
                      </p>
                    </div>

                    <div className="space-y-6">
                      {[
                        { label: "Red", color: "r" as const, value: lightingDraft.color.r, hex: "#ef4444" },
                        { label: "Green", color: "g" as const, value: lightingDraft.color.g, hex: "#22c55e" },
                        { label: "Blue", color: "b" as const, value: lightingDraft.color.b, hex: "#3b82f6" },
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
                            />
                            <input
                              type="range"
                              min="0"
                              max="255"
                              value={channel.value}
                              onChange={(e) => handleColorChange(channel.color, parseInt(e.target.value))}
                              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <div
                              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
                              style={{ left: `calc(${(channel.value / 255) * 100}% - 8px)` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {usesAccentColor(lightingDraft.effect) && (
                    <div className="glass-panel p-8 rounded-3xl">
                      <div className="mb-6">
                        <h3 className="text-lg font-semibold">Accent Color</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Pulse and wave profiles blend between the primary and accent colors.
                        </p>
                      </div>

                      <div className="space-y-6">
                        {[
                          { label: "Red", color: "r" as const, value: lightingDraft.accentColor?.r ?? 0, hex: "#ef4444" },
                          { label: "Green", color: "g" as const, value: lightingDraft.accentColor?.g ?? 0, hex: "#22c55e" },
                          { label: "Blue", color: "b" as const, value: lightingDraft.accentColor?.b ?? 0, hex: "#3b82f6" },
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
                              />
                              <input
                                type="range"
                                min="0"
                                max="255"
                                value={channel.value}
                                onChange={(e) => handleAccentColorChange(channel.color, parseInt(e.target.value))}
                                className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
                                style={{ left: `calc(${(channel.value / 255) * 100}% - 8px)` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-lg font-semibold">Save And Apply</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Saved profiles can be re-applied from your library at any time.
                        </p>
                      </div>
                      {activeLightingProfile && (
                        <span className="text-xs uppercase tracking-[0.18em] text-emerald-300/70">
                          Active: {activeLightingProfile.name}
                        </span>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 mb-6">
                      <div className="text-sm font-medium text-white/80 mb-2">Draft status</div>
                      <p className="text-sm text-white/50 leading-relaxed">
                        {isSavedLightingProfile
                          ? "You are previewing a saved profile from your library."
                          : isEditingCustomLightingProfile
                            ? "You are editing a saved custom profile. Save to update it."
                            : "You are working on an unsaved draft. Save it to add it to your custom lighting library."}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={saveLightingProfile}
                        disabled={!lightingDraft.name.trim()}
                        className="glass-button flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save size={18} />
                        {isEditingCustomLightingProfile ? "Update Profile" : "Save Profile"}
                      </button>
                      <button
                        onClick={startNewLightingProfile}
                        className="glass-button flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-white/70"
                      >
                        <Plus size={18} /> Start Fresh
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "haptics" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Haptics</h2>
                  <p className="text-white/50 max-w-3xl">
                    Browse built-in haptic presets, tune each trigger live, and save your own custom haptic setups.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setLinkTriggerEditing((current) => !current)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      linkTriggerEditing ? "bg-purple-600 text-white" : "glass-button text-white/60"
                    }`}
                  >
                    {linkTriggerEditing ? "Linked Editing" : "Edit Separately"}
                  </button>
                  <button onClick={startNewHapticProfile} className="glass-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium">
                    <Plus size={16} /> New Haptic Profile
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.95fr)] gap-6">
                <div className="space-y-6">
                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-semibold">Haptic Library</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Built-ins cover the supported trigger effect families, and custom profiles let you save your own feel.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/30 mb-3">Built-in</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {BUILTIN_HAPTIC_PROFILES.map((profile) => (
                            <div
                              key={profile.id}
                              className={`text-left rounded-2xl border p-4 transition-all duration-200 ${
                                activeProfileId === profile.id
                                  ? "border-purple-400/40 bg-purple-500/10 shadow-[0_0_0_1px_rgba(192,132,252,0.2)]"
                                  : "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-4 mb-3">
                                <div>
                                  <div className="font-semibold text-white">{profile.name}</div>
                                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/35">{profile.category}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => loadHapticProfileForEditing(profile)}
                                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white"
                                  title="Duplicate into custom"
                                >
                                  <Pencil size={14} />
                                </button>
                              </div>
                              <button type="button" onClick={() => applyHapticProfile(profile)} className="w-full text-left">
                              <p className="text-sm text-white/55 leading-relaxed mb-3">{profile.description}</p>
                              <div className="text-xs text-white/35">
                                L2: {describeTriggerEffect(profile.left)}<br />
                                R2: {describeTriggerEffect(profile.right)}
                              </div>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/30 mb-3">Custom</div>
                        <div className="space-y-3">
                          {customHapticProfiles.map((profile) => (
                            <div
                              key={profile.id}
                              className={`rounded-2xl border p-4 transition-colors ${
                                activeProfileId === profile.id
                                  ? "border-fuchsia-400/40 bg-fuchsia-500/10"
                                  : "border-white/8 bg-white/[0.03]"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <button type="button" onClick={() => applyHapticProfile(profile)} className="flex-1 text-left">
                                  <div className="font-semibold text-white">{profile.name}</div>
                                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/35">{profile.category}</div>
                                  <p className="mt-2 text-sm text-white/50">{profile.description || "Custom haptic profile"}</p>
                                </button>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => loadHapticProfileForEditing(profile)}
                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white"
                                    title="Edit"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteHapticProfile(profile.id)}
                                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-white/40 hover:text-red-400"
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                          {customHapticProfiles.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-white/35">
                              No custom haptic profiles yet. Duplicate a built-in or create a new setup from the live editor.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex flex-wrap items-center gap-3 mb-6">
                      <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/70">
                        Active: <span className="text-white font-medium">{activeHapticProfile?.name ?? "Manual / Unsaved"}</span>
                      </span>
                      {adaptiveTriggers.enabled && (
                        <span className="px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-sm text-cyan-200">
                          Adaptive Triggers are currently overriding live output
                        </span>
                      )}
                      <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/50">
                        L2: <span className="text-white/80">{getTriggerEffectDefinition(leftTrigger.kind).label}</span>
                      </span>
                      <span className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/50">
                        R2: <span className="text-white/80">{getTriggerEffectDefinition(rightTrigger.kind).label}</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {([
                        { id: "left" as const, title: "L2", effect: leftTrigger },
                        { id: "right" as const, title: "R2", effect: rightTrigger },
                      ]).map((trigger) => (
                        <div key={trigger.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
                          <div className="text-sm font-semibold text-white/80 mb-2">{trigger.title}</div>
                          <div className="text-xs text-white/40">{describeTriggerEffect(trigger.effect)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  {([
                    { id: "left" as const, label: "Left Trigger (L2)", effect: leftTrigger },
                    { id: "right" as const, label: "Right Trigger (R2)", effect: rightTrigger },
                  ]).map((trigger) => {
                    const definition = getTriggerEffectDefinition(trigger.effect.kind);
                    return (
                      <div key={trigger.id} className="glass-panel p-8 rounded-3xl">
                        <div className="flex items-start justify-between gap-4 mb-6">
                          <div>
                            <h3 className="text-2xl font-semibold mb-2">{trigger.label}</h3>
                            <p className="text-sm text-white/45">{definition.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => resetTriggerSide(trigger.id)}
                              className="glass-button px-3 py-2 rounded-xl text-xs font-medium text-white/60"
                            >
                              Reset
                            </button>
                            <button
                              type="button"
                              onClick={() => copyTriggerSide(trigger.id, trigger.id === "left" ? "right" : "left")}
                              className="glass-button px-3 py-2 rounded-xl text-xs font-medium text-white/60"
                            >
                              Copy To {trigger.id === "left" ? "R2" : "L2"}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <div>
                            <label className="block text-sm font-medium text-white/70 mb-3">Effect Type</label>
                            <div className="relative">
                              <select
                                value={trigger.effect.kind}
                                onChange={(e) => applyTriggerEffectKind(trigger.id, e.target.value as TriggerEffectKind)}
                                className="w-full glass-input rounded-xl p-4 text-white outline-none appearance-none font-medium"
                              >
                                {TRIGGER_EFFECT_DEFINITIONS.map((effectDefinition) => (
                                  <option key={effectDefinition.kind} value={effectDefinition.kind} className="bg-neutral-900">
                                    {effectDefinition.label}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                            </div>
                          </div>

                          {definition.fields.includes("force") && (
                            <SliderRow
                              label="Force / Amplitude"
                              value={trigger.effect.force ?? 0}
                              max={255}
                              color="bg-purple-500"
                              onChange={(value) => updateTriggerNumericField(trigger.id, "force", value)}
                            />
                          )}
                          {definition.fields.includes("startPosition") && (
                            <SliderRow
                              label="Start Position"
                              value={trigger.effect.startPosition ?? 0}
                              max={255}
                              color="bg-blue-500"
                              onChange={(value) => updateTriggerNumericField(trigger.id, "startPosition", value)}
                            />
                          )}
                          {definition.fields.includes("endPosition") && (
                            <SliderRow
                              label="End Position"
                              value={trigger.effect.endPosition ?? 180}
                              max={255}
                              color="bg-cyan-500"
                              onChange={(value) => updateTriggerNumericField(trigger.id, "endPosition", value)}
                            />
                          )}
                          {definition.fields.includes("frequency") && (
                            <SliderRow
                              label="Frequency"
                              value={trigger.effect.frequency ?? 30}
                              max={255}
                              color="bg-amber-500"
                              onChange={(value) => updateTriggerNumericField(trigger.id, "frequency", value)}
                            />
                          )}
                          {definition.fields.includes("rawMode") && (
                            <SliderRow
                              label="Raw Mode"
                              value={trigger.effect.rawMode ?? 0}
                              max={255}
                              color="bg-rose-500"
                              onChange={(value) => updateTriggerNumericField(trigger.id, "rawMode", value)}
                            />
                          )}
                          {definition.fields.includes("rawParams") && (
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                              <div className="text-sm font-medium text-white/80 mb-4">Expert Payload Bytes</div>
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                {(trigger.effect.rawParams ?? Array(10).fill(0)).map((value, index) => (
                                  <div key={index}>
                                    <label className="block text-xs text-white/40 mb-2">P{index}</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="255"
                                      value={value}
                                      onChange={(event) => updateTriggerRawParam(trigger.id, index, parseInt(event.target.value || "0"))}
                                      className="w-full glass-input rounded-lg p-3 text-white text-sm outline-none font-medium"
                                    />
                                  </div>
                                ))}
                              </div>
                              <p className="text-xs text-amber-200/70 mt-4">
                                Expert Raw writes the payload bytes directly and skips the validated effect encoder for this trigger.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-lg font-semibold">Save Current Setup</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Save the current trigger setup as a reusable custom profile, or update an existing custom profile.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">Profile Name</label>
                        <input
                          type="text"
                          value={editingHapticProfile?.name ?? ""}
                          placeholder="My Trigger Profile"
                          onChange={(e) => setEditingHapticProfile((current) => ({
                            ...(current ?? createHapticProfileDraft(leftTrigger, rightTrigger)),
                            name: e.target.value,
                          }))}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">Category</label>
                        <input
                          type="text"
                          value={editingHapticProfile?.category ?? "Custom"}
                          placeholder="FPS, Racing, Action..."
                          onChange={(e) => setEditingHapticProfile((current) => ({
                            ...(current ?? createHapticProfileDraft(leftTrigger, rightTrigger)),
                            category: e.target.value,
                          }))}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">Description</label>
                        <textarea
                          value={editingHapticProfile?.description ?? ""}
                          placeholder="Describe how this haptic profile feels in-game."
                          onChange={(e) => setEditingHapticProfile((current) => ({
                            ...(current ?? createHapticProfileDraft(leftTrigger, rightTrigger)),
                            description: e.target.value,
                          }))}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none font-medium placeholder:text-white/20 min-h-[92px] resize-y"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-6">
                      <button
                        onClick={() => editingHapticProfile && saveHapticProfile({
                          ...editingHapticProfile,
                          left: cloneTriggerEffect(leftTrigger),
                          right: cloneTriggerEffect(rightTrigger),
                        })}
                        disabled={!editingHapticProfile?.name.trim()}
                        className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                      >
                        {editingHapticProfile && customHapticProfiles.some((profile) => profile.id === editingHapticProfile.id)
                          ? "Update Profile"
                          : "Save Profile"}
                      </button>
                      <button
                        onClick={() => setEditingHapticProfile(null)}
                        className="glass-button px-5 py-2.5 rounded-xl text-sm font-medium text-white/50"
                      >
                        Clear Draft
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "adaptiveTriggers" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Adaptive Triggers</h2>
                  <p className="text-white/50 max-w-3xl">
                    Build game-specific trigger behavior driven by a demo slider or live OCR telemetry from racing games.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateAdaptiveTriggerSettings((current) => ({ ...current, enabled: !current.enabled }))}
                  className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    adaptiveTriggers.enabled ? "bg-cyan-500 text-slate-950" : "glass-button text-white/70"
                  }`}
                >
                  {adaptiveTriggers.enabled ? "Adaptive Output Enabled" : "Adaptive Output Disabled"}
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)] gap-6">
                <div className="space-y-6">
                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-semibold">Game Profile</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Switch between demo and live OCR input while keeping the same high-speed trigger policy for racing games.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                        <button
                          type="button"
                          onClick={() => updateAdaptiveTriggerSettings((current) => ({ ...current, inputSource: "demo" }))}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            adaptiveTriggers.inputSource === "demo" ? "bg-white text-black" : "text-white/60"
                          }`}
                        >
                          Demo
                        </button>
                        <button
                          type="button"
                          onClick={() => updateAdaptiveTriggerSettings((current) => ({ ...current, inputSource: "live" }))}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            adaptiveTriggers.inputSource === "live" ? "bg-cyan-500 text-slate-950" : "text-white/60"
                          }`}
                        >
                          Live
                        </button>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-white/70 mb-3">Target Game</label>
                        <div className="relative">
                          <select
                            value={adaptiveTriggers.selectedGame}
                            onChange={(e) => updateAdaptiveTriggerSettings((current) => ({
                              ...current,
                              selectedGame: e.target.value === "nfsHeat" ? "nfsHeat" : current.selectedGame,
                            }))}
                            className="w-full glass-input rounded-xl p-4 text-white outline-none appearance-none font-medium"
                          >
                            <option value="nfsHeat" className="bg-neutral-900">Racing Games</option>
                          </select>
                          <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                        </div>
                      </div>

                      {adaptiveTriggers.inputSource === "live" && (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium text-white/80">OCR Process Monitoring</div>
                              <p className="text-sm text-white/45 mt-1">
                                WinSense will first try to auto-detect a likely racing game. If none is active, choose any visible process window to monitor with OCR.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void loadOcrProcessOptions()}
                              disabled={ocrProcessOptionsLoading}
                              className="px-3 py-2 rounded-xl text-xs font-medium glass-button disabled:opacity-60"
                            >
                              {ocrProcessOptionsLoading ? "Refreshing..." : "Refresh Processes"}
                            </button>
                          </div>
                          <div className="relative">
                            <select
                              value={manualOcrProcessName ?? ""}
                              onChange={(event) => updateNfsHeatAdaptiveSettings({
                                ocrProcessName: event.target.value.trim() ? event.target.value : null,
                              })}
                              className="w-full glass-input rounded-xl p-4 text-white outline-none appearance-none font-medium"
                            >
                              <option value="" className="bg-neutral-900">Automatic racing-game detection</option>
                              {ocrProcessOptions.map((process) => (
                                <option
                                  key={`${process.processId}-${process.processName}`}
                                  value={process.processName}
                                  className="bg-neutral-900"
                                >
                                  {process.processName}
                                  {process.windowTitle ? ` - ${process.windowTitle}` : ""}
                                  {process.likelyRacing ? " [Likely Racing]" : ""}
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/50" />
                          </div>
                          <p className="text-xs text-white/45">
                            {manualOcrProcessName
                              ? `Manual fallback selected: ${manualOcrProcessName}. Auto-detect still takes priority if a likely racing game is already visible.`
                              : "No manual process selected. WinSense will wait for auto-detected racing games only."}
                          </p>
                        </div>
                      )}

                      <div className={`rounded-2xl border p-5 ${adaptiveStatusTone}`}>
                        <div className="flex flex-wrap items-center gap-3 mb-3">
                          <span className="px-3 py-1.5 rounded-full bg-black/10 border border-white/10 text-sm">
                            Source: <span className="font-medium">{adaptiveTriggers.inputSource === "live" ? "Live OCR" : "Demo Slider"}</span>
                          </span>
                          <span className="px-3 py-1.5 rounded-full bg-black/10 border border-white/10 text-sm">
                            Status: <span className="font-medium">{gameTelemetryStatus.stage}</span>
                          </span>
                          <span className="px-3 py-1.5 rounded-full bg-black/10 border border-white/10 text-sm">
                            OCR Calibration: <span className="font-medium">{ocrCalibrationReady ? "Ready" : "Missing"}</span>
                          </span>
                          <span className="px-3 py-1.5 rounded-full bg-black/10 border border-white/10 text-sm">
                            Active Speed: <span className="font-medium">{adaptiveActiveSpeedKph ?? 0} km/h</span>
                          </span>
                          <span className="px-3 py-1.5 rounded-full bg-black/10 border border-white/10 text-sm">
                            Speed Strength: <span className="font-medium">{adaptiveStrengthPercent}%</span>
                          </span>
                        </div>
                        <p className="text-sm text-white/50 leading-relaxed">
                          {gameTelemetryStatus.message}
                        </p>
                        {gameTelemetryStatus.processId && (
                          <p className="text-xs text-white/45 mt-3">Detected process ID: {gameTelemetryStatus.processId}</p>
                        )}
                        {gameTelemetryStatus.lastSpeedAtUnixMs && (
                          <p className="text-xs text-white/45 mt-1">
                            Last live update: {new Date(gameTelemetryStatus.lastSpeedAtUnixMs).toLocaleTimeString()}
                          </p>
                        )}
                      </div>

                      <SliderRow
                        label={adaptiveTriggers.inputSource === "live" ? "Fallback Demo Speed (km/h)" : "Demo Speed (km/h)"}
                        value={adaptiveTriggers.nfsHeat.demoSpeedKph}
                        max={999}
                        color="bg-cyan-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ demoSpeedKph: value })}
                      />
                      {adaptiveTriggers.inputSource === "live" && (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 -mt-2 space-y-3">
                          <p className="text-sm text-white/45">
                            Demo speed remains available as a fallback while WinSense is waiting for a live OCR read from the selected racing-game HUD.
                          </p>
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={() => void loadOcrCalibrationPreview()}
                              disabled={ocrCalibrationLoading}
                              className="px-4 py-2 rounded-xl text-sm font-medium bg-cyan-500 text-slate-950 disabled:opacity-60"
                            >
                              {ocrCalibrationLoading ? "Capturing Preview..." : ocrCalibrationReady ? "Recalibrate OCR Region" : "Calibrate OCR Region"}
                            </button>
                            <button
                              type="button"
                              onClick={resetOcrCalibration}
                              disabled={!ocrCalibrationReady}
                              className="px-4 py-2 rounded-xl text-sm font-medium glass-button disabled:opacity-50"
                            >
                              Reset Calibration
                            </button>
                          </div>
                          {ocrCalibrationReady && adaptiveTriggers.nfsHeat.ocrCalibration && (
                            <p className="text-xs text-white/45">
                              Saved crop: {adaptiveTriggers.nfsHeat.ocrCalibration.width} x {adaptiveTriggers.nfsHeat.ocrCalibration.height} inside a
                              {" "}
                              {adaptiveTriggers.nfsHeat.ocrCalibration.referenceWidth} x {adaptiveTriggers.nfsHeat.ocrCalibration.referenceHeight}
                              {" "}
                              game-window preview.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-semibold">Live Preview</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Preview the exact trigger effects currently being generated for the active speed source.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
                        <div className="text-sm font-semibold text-white/80 mb-2">L2 Brake</div>
                        <div className="text-xs text-white/35 mb-3">High-speed braking gets firmer and spans a wider resistance band.</div>
                        <div className="text-sm text-white/70">{describeTriggerEffect(adaptivePreview.left)}</div>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
                        <div className="text-sm font-semibold text-white/80 mb-2">R2 Throttle</div>
                        <div className="text-xs text-white/35 mb-3">Throttle tension increases as vehicle speed rises.</div>
                        <div className="text-sm text-white/70">{describeTriggerEffect(adaptivePreview.right)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-semibold">Speed Range</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Define how quickly the haptics ramp from cruising to top-speed resistance.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <SliderRow
                        label="Minimum Speed (km/h)"
                        value={adaptiveTriggers.nfsHeat.minSpeedKph}
                        max={998}
                        color="bg-blue-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ minSpeedKph: value })}
                      />
                      <SliderRow
                        label="Maximum Speed (km/h)"
                        value={adaptiveTriggers.nfsHeat.maxSpeedKph}
                        max={999}
                        color="bg-fuchsia-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ maxSpeedKph: value })}
                      />
                    </div>
                  </div>

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-semibold">Brake Tuning</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Tune the L2 resistance band used to mimic heavier braking at higher speed.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <SliderRow
                        label="Brake Start Position"
                        value={adaptiveTriggers.nfsHeat.brakeStartPosition}
                        max={255}
                        color="bg-amber-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ brakeStartPosition: value })}
                      />
                      <SliderRow
                        label="Brake End Position"
                        value={adaptiveTriggers.nfsHeat.brakeEndPosition}
                        max={255}
                        color="bg-orange-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ brakeEndPosition: value })}
                      />
                      <SliderRow
                        label="Brake Minimum Force"
                        value={adaptiveTriggers.nfsHeat.brakeMinForce}
                        max={255}
                        color="bg-red-400"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ brakeMinForce: value })}
                      />
                      <SliderRow
                        label="Brake Maximum Force"
                        value={adaptiveTriggers.nfsHeat.brakeMaxForce}
                        max={255}
                        color="bg-red-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ brakeMaxForce: value })}
                      />
                    </div>
                  </div>

                  <div className="glass-panel p-8 rounded-3xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-semibold">Throttle Tuning</h3>
                        <p className="text-sm text-white/45 mt-1">
                          Tune the R2 resistance curve used to make throttle feel firmer as speed builds.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <SliderRow
                        label="Throttle Start Position"
                        value={adaptiveTriggers.nfsHeat.throttleStartPosition}
                        max={255}
                        color="bg-emerald-400"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ throttleStartPosition: value })}
                      />
                      <SliderRow
                        label="Throttle Minimum Force"
                        value={adaptiveTriggers.nfsHeat.throttleMinForce}
                        max={255}
                        color="bg-emerald-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ throttleMinForce: value })}
                      />
                      <SliderRow
                        label="Throttle Maximum Force"
                        value={adaptiveTriggers.nfsHeat.throttleMaxForce}
                        max={255}
                        color="bg-teal-500"
                        onChange={(value) => updateNfsHeatAdaptiveSettings({ throttleMaxForce: value })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "audio" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex justify-between items-end mb-10">
                <div>
                  <h2 className="text-4xl font-bold mb-2">Audio</h2>
                  <p className="text-white/50">Control and test the controller's speaker and microphone.</p>
                </div>
                <button
                  onClick={() => handleAudioChange("audioMute", !audioSettings.audioMute)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors ${audioSettings.audioMute ? 'bg-red-600/80 text-white' : 'glass-button text-white/50'}`}
                >
                  {audioSettings.audioMute ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  {audioSettings.audioMute ? 'Muted' : 'Audio On'}
                </button>
              </div>

              <div className={`space-y-6 max-w-2xl transition-opacity duration-300 ${audioSettings.audioMute ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-center gap-3 mb-6">
                    <Speaker size={20} className="text-blue-400" />
                    <h3 className="text-lg font-semibold">Speaker</h3>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between mb-3">
                        <span className="font-medium text-white/80">Speaker Volume</span>
                        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-sm">{audioSettings.speakerVolume}%</span>
                      </div>
                      <div className="relative h-2 rounded-full bg-white/10">
                        <div className="absolute top-0 left-0 h-full rounded-full bg-blue-500" style={{ width: `${audioSettings.speakerVolume}%` }}></div>
                        <input type="range" min="0" max="100" value={audioSettings.speakerVolume} onChange={(e) => handleAudioChange("speakerVolume", parseInt(e.target.value))} className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer" />
                        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none" style={{ left: `calc(${audioSettings.speakerVolume}% - 8px)` }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-3">
                        <span className="font-medium text-white/80">Headphone Volume</span>
                        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-sm">{audioSettings.headphoneVolume}%</span>
                      </div>
                      <div className="relative h-2 rounded-full bg-white/10">
                        <div className="absolute top-0 left-0 h-full rounded-full bg-purple-500" style={{ width: `${audioSettings.headphoneVolume}%` }}></div>
                        <input type="range" min="0" max="100" value={audioSettings.headphoneVolume} onChange={(e) => handleAudioChange("headphoneVolume", parseInt(e.target.value))} className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer" />
                        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none" style={{ left: `calc(${audioSettings.headphoneVolume}% - 8px)` }}></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div>
                        <span className="font-medium text-white/80">Enable Internal Speaker</span>
                        <p className="text-sm text-white/40 mt-0.5">Route audio to the built-in speaker alongside a connected headset.</p>
                      </div>
                      <button
                        onClick={() => handleAudioChange("forceInternalSpeaker", !audioSettings.forceInternalSpeaker)}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${audioSettings.forceInternalSpeaker ? 'bg-blue-600' : 'bg-white/20'}`}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${audioSettings.forceInternalSpeaker ? 'translate-x-5' : ''}`}></div>
                      </button>
                    </div>

                    <div className="pt-2">
                      {bluetoothAudioExperimental && (
                        <div className="flex items-start gap-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 mb-4">
                          <Info size={18} className="text-cyan-300 mt-0.5 shrink-0" />
                          <p className="text-sm text-cyan-100/80">
                            Bluetooth speaker playback is experimental and streams an in-app test tone over the controller HID link rather than a Windows audio device.
                          </p>
                        </div>
                      )}
                      <p className="text-sm text-white/40 mb-3">
                        Plays a boosted test tone through the controller speaker and temporarily enables internal speaker routing if needed.
                      </p>
                      <button
                        onClick={() => void handleTestSpeaker()}
                        disabled={!speakerTestSupported || speakerTestActive}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors ${
                          !speakerTestSupported
                            ? 'glass-button opacity-50 cursor-not-allowed'
                            : speakerTestActive
                              ? 'bg-blue-600/60 text-white cursor-not-allowed'
                              : 'glass-button'
                        }`}
                      >
                        {speakerTestActive ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                        {speakerTestActive
                          ? 'Playing...'
                          : speakerTestSupported
                            ? bluetoothAudioExperimental
                              ? 'Run Bluetooth Speaker Test'
                              : 'Test Speaker'
                            : `Unavailable (${transportLabel})`}
                      </button>
                      {speakerTestError && (
                        <p className="mt-3 text-sm text-red-400">{speakerTestError}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-center gap-3 mb-6">
                    <Mic size={20} className="text-green-400" />
                    <h3 className="text-lg font-semibold">Microphone</h3>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between mb-3">
                        <span className="font-medium text-white/80">Microphone Volume</span>
                        <span className="text-white/50 font-mono bg-black/30 px-2 py-0.5 rounded-md text-sm">{audioSettings.micVolume}%</span>
                      </div>
                      <div className="relative h-2 rounded-full bg-white/10">
                        <div className="absolute top-0 left-0 h-full rounded-full bg-green-500" style={{ width: `${audioSettings.micVolume}%` }}></div>
                        <input type="range" min="0" max="100" value={audioSettings.micVolume} onChange={(e) => handleAudioChange("micVolume", parseInt(e.target.value))} className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer" />
                        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none" style={{ left: `calc(${audioSettings.micVolume}% - 8px)` }}></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div>
                        <span className="font-medium text-white/80">Mute Microphone</span>
                        <p className="text-sm text-white/40 mt-0.5">Hardware-mute the controller microphone.</p>
                      </div>
                      <button
                        onClick={() => handleAudioChange("micMute", !audioSettings.micMute)}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${audioSettings.micMute ? 'bg-red-600' : 'bg-white/20'}`}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${audioSettings.micMute ? 'translate-x-5' : ''}`}></div>
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-white/80">Mute Button LED</span>
                        <p className="text-sm text-white/40 mt-0.5">Control the mute indicator light on the controller.</p>
                      </div>
                      <div className="relative min-w-[140px]">
                        <select
                          value={audioSettings.micMuteLed}
                          onChange={(e) => handleAudioChange("micMuteLed", parseInt(e.target.value))}
                          className="w-full glass-input rounded-xl p-3 text-white outline-none appearance-none font-medium text-sm"
                        >
                          <option value={0} className="bg-neutral-900">Off</option>
                          <option value={1} className="bg-neutral-900">On</option>
                          <option value={2} className="bg-neutral-900">Breathing</option>
                        </select>
                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-white/80">Force Internal Mic</span>
                        <p className="text-sm text-white/40 mt-0.5">Always use the controller's built-in microphone, even when a headset is connected.</p>
                      </div>
                      <button
                        onClick={() => handleAudioChange("forceInternalMic", !audioSettings.forceInternalMic)}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${audioSettings.forceInternalMic ? 'bg-green-600' : 'bg-white/20'}`}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${audioSettings.forceInternalMic ? 'translate-x-5' : ''}`}></div>
                      </button>
                    </div>

                    <div className="pt-2 space-y-3">
                      {bluetoothAudioExperimental && (
                        <div className="flex items-start gap-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4">
                          <Info size={18} className="text-cyan-300 mt-0.5 shrink-0" />
                          <p className="text-sm text-cyan-100/80">
                            Bluetooth mic monitoring is experimental. WinSense probes Bluetooth HID traffic first, then uses the controller mic if Windows exposes it.
                          </p>
                        </div>
                      )}
                      <p className="text-sm text-white/40">Routes the controller's mic audio to your default speakers so you can hear yourself in real time.</p>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleMicTest}
                          disabled={!micTestSupported}
                          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors ${
                            !micTestSupported
                              ? 'glass-button opacity-50 cursor-not-allowed'
                              : micTestActive
                                ? 'bg-red-600/80 text-white'
                                : 'glass-button'
                          }`}
                        >
                          {micTestActive ? <MicOff size={18} /> : <Mic size={18} />}
                          {micTestActive ? 'Stop Listening' : 'Start Listening'}
                        </button>
                        {micTestActive && (
                          <span className="flex items-center gap-2 text-sm text-green-400">
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                            Mic active
                          </span>
                        )}
                      </div>
                      {micTestError && (
                        <p className="text-sm text-red-400">{micTestError}</p>
                      )}
                    </div>
                  </div>
                </div>
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
                          two-finger swipe scrolls, and touchpad click with one finger for left click, two fingers for right click.
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

                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 mt-0.5">
                      <Sliders size={20} className="text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold mb-1">Haptic Library</h3>
                      <p className="text-white/50 text-sm leading-relaxed">
                        Trigger profiles are now managed from the dedicated <span className="text-white/70 font-medium">Haptics</span> tab,
                        where you can browse built-ins, edit both triggers live, and save custom setups with advanced controls.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="glass-panel p-8 rounded-3xl">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 mt-0.5">
                      <Keyboard size={20} className="text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold mb-1">Mapping Profiles</h3>
                      <p className="text-white/50 text-sm leading-relaxed">
                        Mapping profiles now live in the dedicated <span className="text-white/70 font-medium">Mapping</span> tab,
                        where profile selection, saving, renaming, key capture, and output target changes all happen in one place.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
            </div>
          </>
        ) : (
          <DisconnectedPlaceholder />
        )}

        {showStartupSplash && (
          <StartupSplash
            exiting={startupSplashExiting}
            previewGlow={previewGlow}
          />
        )}
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

function StartupSplash({
  exiting,
  previewGlow,
}: {
  exiting: boolean;
  previewGlow: string;
}) {
  return (
    <div
      className={`absolute inset-0 z-[110] flex items-center justify-center overflow-hidden bg-[#060606] transition-all duration-700 ${
        exiting ? "pointer-events-none scale-[1.02] opacity-0" : "opacity-100"
      }`}
    >
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: `radial-gradient(circle at 50% 38%, ${previewGlow} 0%, rgba(10, 10, 10, 0) 35%), radial-gradient(circle at 50% 70%, rgba(37, 99, 235, 0.18) 0%, rgba(10, 10, 10, 0) 42%)`,
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_28%,transparent_72%,rgba(255,255,255,0.03))]" />

      <div className="relative z-10 flex flex-col items-center px-8 text-center">
        <div className="relative mb-8">
          <div className="absolute -inset-14 rounded-full border border-white/8 animate-pulse" />
          <div className="absolute -inset-20 rounded-full border border-blue-400/10 animate-spin" style={{ animationDuration: "14s" }} />
          <div className="absolute -inset-8 rounded-[2rem] bg-white/5 blur-2xl" />
          <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-[0_0_50px_rgba(37,99,235,0.18)] backdrop-blur-xl">
            <img
              src={winSenseMark}
              alt=""
              className="h-20 w-20 object-cover object-top drop-shadow-[0_14px_34px_rgba(59,130,246,0.35)]"
              draggable={false}
            />
          </div>
        </div>

        <div className="max-w-xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.45em] text-blue-300/80">WinSense</p>
          <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Preparing your DualSense workspace</h2>
          <p className="mt-4 text-sm leading-relaxed text-white/55 sm:text-base">
            Initializing controller services, profiles, lighting, calibration, and live telemetry.
          </p>
        </div>

        <div className="mt-8 flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 backdrop-blur-xl">
          <Loader2 size={16} className="animate-spin text-blue-300" />
          <span>Loading WinSense</span>
        </div>
      </div>
    </div>
  );
}

function DisconnectedPlaceholder() {
  return (
    <div className="relative z-10 flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-12">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] border border-blue-400/15 bg-blue-500/10 shadow-[0_0_50px_rgba(37,99,235,0.18)]">
            <Gamepad2 size={44} className="text-blue-300" />
          </div>

          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            <Usb size={16} />
            <span>Connect a DualSense controller to continue</span>
          </div>

          <h2 className="text-4xl font-black tracking-tight text-white">Waiting for your controller</h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/55">
            WinSense unlocks calibration, mapping, lighting, haptics, audio, and telemetry once a DualSense is detected.
            Plug one in and the full app will appear automatically.
          </p>

          <div className="mt-8 grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
            <PlaceholderStep
              title="1. Connect a DualSense"
              body="Use USB for the most reliable setup and for firmware calibration."
            />
            <PlaceholderStep
              title="2. Wait for detection"
              body="The app listens for controller changes live, so no restart is needed."
            />
            <PlaceholderStep
              title="3. Start customizing"
              body="As soon as the controller is ready, the full WinSense dashboard returns."
            />
          </div>

          <div className="mt-8 flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60">
            <Loader2 size={16} className="animate-spin text-blue-300" />
            <span>Listening for a DualSense connection</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderStep({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
      <div className="mb-2 text-sm font-semibold text-white/85">{title}</div>
      <p className="text-sm leading-relaxed text-white/50">{body}</p>
    </div>
  );
}

export default App;

