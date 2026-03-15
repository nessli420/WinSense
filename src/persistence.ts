import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { PersistedAppState } from "./mapping";

export type StartupOpenMode = "normal" | "tray";

export interface PersistedRuntimeSettingsSnapshot {
  launchOnStartup: boolean;
  startupOpenMode: StartupOpenMode;
  closeToTray: boolean;
}

export interface VersionedPersistedAppState extends PersistedAppState {
  schemaVersion: number;
  runtimeSettings: PersistedRuntimeSettingsSnapshot;
}

export const APP_STATE_SCHEMA_VERSION = 5;
export const APP_STATE_FILE = "app-state.json";
export const HAPTIC_PROFILES_FILE = "haptic-profiles.json";
export const TRIGGER_PROFILES_FILE = "trigger-profiles.json";
export const MAPPING_PROFILES_FILE = "mapping-profiles.json";
export const LIGHTING_PROFILES_FILE = "lighting-profiles.json";
export const LEGACY_PROFILE_FILE = "profile.json";

export const normalizeStartupOpenMode = (value: string | null | undefined): StartupOpenMode =>
  value === "tray" ? "tray" : "normal";

export const createRuntimeSettingsSnapshot = (
  launchOnStartup: boolean,
  startupOpenMode: StartupOpenMode,
  closeToTray: boolean,
): PersistedRuntimeSettingsSnapshot => ({
  launchOnStartup: Boolean(launchOnStartup),
  startupOpenMode: normalizeStartupOpenMode(startupOpenMode),
  closeToTray: Boolean(closeToTray),
});

export async function readJsonFile<T>(fileName: string, baseDir: BaseDirectory): Promise<T | null> {
  try {
    const contents = await readTextFile(fileName, { baseDir });
    return JSON.parse(contents) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(
  fileName: string,
  value: unknown,
  baseDir: BaseDirectory = BaseDirectory.AppData,
) {
  await writeTextFile(fileName, JSON.stringify(value, null, 2), { baseDir });
}

export async function loadPersistedJson<T>(fileName: string, legacyFileName: string = fileName): Promise<T | null> {
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
}

export const migrateStoredAppState = (
  state: PersistedAppState | VersionedPersistedAppState | null,
): VersionedPersistedAppState | null => {
  if (!state) {
    return null;
  }

  const runtimeSettings = state.runtimeSettings
    ? createRuntimeSettingsSnapshot(
        state.runtimeSettings.launchOnStartup,
        state.runtimeSettings.startupOpenMode,
        state.runtimeSettings.closeToTray,
      )
    : createRuntimeSettingsSnapshot(
        state.launchOnStartup ?? false,
        state.startupOpenMode ?? "normal",
        state.closeToTray ?? false,
      );

  return {
    ...state,
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    activeTab: state.activeTab === "triggers" ? "haptics" : state.activeTab,
    runtimeSettings,
    launchOnStartup: runtimeSettings.launchOnStartup,
    startupOpenMode: runtimeSettings.startupOpenMode,
    closeToTray: runtimeSettings.closeToTray,
  };
};

export async function loadVersionedAppState(
  fileName: string = APP_STATE_FILE,
  legacyFileName: string = LEGACY_PROFILE_FILE,
) {
  const state = await loadPersistedJson<PersistedAppState | VersionedPersistedAppState>(fileName, legacyFileName);
  return migrateStoredAppState(state);
}
