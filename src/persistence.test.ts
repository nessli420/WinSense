import { describe, expect, it } from "vitest";

import { migrateStoredAppState } from "./persistence";

describe("migrateStoredAppState", () => {
  it("hydrates runtime settings from legacy top-level fields", () => {
    const migrated = migrateStoredAppState({
      closeToTray: true,
      startupOpenMode: "tray",
      launchOnStartup: true,
    });

    expect(migrated?.schemaVersion).toBe(5);
    expect(migrated?.runtimeSettings).toEqual({
      closeToTray: true,
      startupOpenMode: "tray",
      launchOnStartup: true,
    });
  });

  it("prefers nested runtime settings when present", () => {
    const migrated = migrateStoredAppState({
      closeToTray: false,
      startupOpenMode: "normal",
      launchOnStartup: false,
      runtimeSettings: {
        closeToTray: true,
        startupOpenMode: "tray",
        launchOnStartup: true,
      },
    });

    expect(migrated?.runtimeSettings.closeToTray).toBe(true);
    expect(migrated?.runtimeSettings.startupOpenMode).toBe("tray");
    expect(migrated?.runtimeSettings.launchOnStartup).toBe(true);
  });

  it("renames the legacy triggers tab to haptics", () => {
    const migrated = migrateStoredAppState({
      activeTab: "triggers",
    });

    expect(migrated?.activeTab).toBe("haptics");
  });

  it("preserves adaptive trigger OCR calibration settings during migration", () => {
    const migrated = migrateStoredAppState({
      adaptiveTriggers: {
        enabled: true,
        inputSource: "live",
        selectedGame: "nfsHeat",
        nfsHeat: {
          demoSpeedKph: 80,
          minSpeedKph: 0,
          maxSpeedKph: 320,
          brakeStartPosition: 36,
          brakeEndPosition: 196,
          brakeMinForce: 70,
          brakeMaxForce: 220,
          throttleStartPosition: 56,
          throttleMinForce: 40,
          throttleMaxForce: 165,
          ocrCalibration: {
            x: 120,
            y: 48,
            width: 84,
            height: 40,
            referenceWidth: 1920,
            referenceHeight: 1080,
          },
          ocrProcessName: "ForzaHorizon5.exe",
        },
      },
    });

    expect(migrated?.adaptiveTriggers?.nfsHeat.ocrCalibration).toEqual({
      x: 120,
      y: 48,
      width: 84,
      height: 40,
      referenceWidth: 1920,
      referenceHeight: 1080,
    });
    expect(migrated?.adaptiveTriggers?.nfsHeat.ocrProcessName).toBe("ForzaHorizon5.exe");
  });
});
