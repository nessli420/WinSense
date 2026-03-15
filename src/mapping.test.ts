import { describe, expect, it } from "vitest";

import {
  convertMappingProfileEmulationTarget,
  getButtonBinding,
  normalizeAdaptiveTriggerSettings,
  normalizeMappingProfile,
  translateKeyboardCodeToKeyCode,
  type MappingProfile,
} from "./mapping";

function makeProfile(overrides: Partial<MappingProfile> = {}): MappingProfile {
  return {
    id: "profile-1",
    name: "Test Profile",
    builtIn: false,
    emulationTarget: "xbox360",
    buttonBindings: {
      cross: { type: "xboxButton", button: "a" },
      circle: { type: "keyboardKey", key: "space" },
    },
    leftStick: { type: "xboxStick", stick: "left" },
    rightStick: { type: "mouseMove", sensitivity: 18, deadzone: 0.2 },
    leftTrigger: { type: "xboxTrigger", trigger: "left" },
    rightTrigger: { type: "mouseButton", button: "left", threshold: 40 },
    ...overrides,
  };
}

describe("mapping helpers", () => {
  it("translates supported browser keyboard codes", () => {
    expect(translateKeyboardCodeToKeyCode("KeyW")).toBe("w");
    expect(translateKeyboardCodeToKeyCode("Digit2")).toBe("digit2");
    expect(translateKeyboardCodeToKeyCode("ShiftLeft")).toBe("leftShift");
    expect(translateKeyboardCodeToKeyCode("ArrowUp")).toBe("upArrow");
  });

  it("rejects unsupported browser keyboard codes", () => {
    expect(translateKeyboardCodeToKeyCode("ShiftRight")).toBeNull();
    expect(translateKeyboardCodeToKeyCode("F5")).toBeNull();
  });

  it("normalizes legacy profiles without an emulation target", () => {
    const legacyProfile = {
      ...makeProfile(),
      emulationTarget: undefined,
    } as unknown as MappingProfile;

    const normalized = normalizeMappingProfile(legacyProfile);

    expect(normalized.emulationTarget).toBe("xbox360");
    expect(normalized.leftStick.type).toBe("xboxStick");
  });

  it("converts controller bindings when switching to DualShock 4 emulation", () => {
    const converted = convertMappingProfileEmulationTarget(makeProfile(), "dualShock4");

    expect(converted.emulationTarget).toBe("dualShock4");
    expect(getButtonBinding(converted, "cross")).toEqual({
      type: "playstationButton",
      button: "cross",
    });
    expect(converted.leftStick).toEqual({
      type: "playstationStick",
      stick: "left",
    });
    expect(converted.leftTrigger).toEqual({
      type: "playstationTrigger",
      trigger: "left",
    });
    expect(getButtonBinding(converted, "circle")).toEqual({
      type: "keyboardKey",
      key: "space",
    });
  });

  it("converts PlayStation controller bindings back to Xbox emulation", () => {
    const playstationProfile = makeProfile({
      emulationTarget: "dualShock4",
      buttonBindings: {
        cross: { type: "playstationButton", button: "cross" },
        options: { type: "playstationButton", button: "options" },
      },
      leftStick: { type: "playstationStick", stick: "left" },
      rightStick: { type: "playstationStick", stick: "right" },
      leftTrigger: { type: "playstationTrigger", trigger: "left" },
      rightTrigger: { type: "playstationTrigger", trigger: "right" },
    });

    const converted = convertMappingProfileEmulationTarget(playstationProfile, "xboxSeries");

    expect(converted.emulationTarget).toBe("xboxSeries");
    expect(getButtonBinding(converted, "cross")).toEqual({
      type: "xboxButton",
      button: "a",
    });
    expect(getButtonBinding(converted, "options")).toEqual({
      type: "xboxButton",
      button: "start",
    });
    expect(converted.leftStick).toEqual({
      type: "xboxStick",
      stick: "left",
    });
    expect(converted.rightTrigger).toEqual({
      type: "xboxTrigger",
      trigger: "right",
    });
  });

  it("defaults OCR calibration to null for adaptive triggers", () => {
    const normalized = normalizeAdaptiveTriggerSettings({
      enabled: true,
      inputSource: "live",
      selectedGame: "nfsHeat",
    });

    expect(normalized.nfsHeat.ocrCalibration).toBeNull();
    expect(normalized.nfsHeat.ocrProcessName).toBeNull();
  });

  it("clamps OCR calibration inside the reference frame", () => {
    const normalized = normalizeAdaptiveTriggerSettings({
      enabled: true,
      inputSource: "live",
      selectedGame: "nfsHeat",
      nfsHeat: {
        demoSpeedKph: 120,
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
          x: -10,
          y: 100,
          width: 9999,
          height: 9999,
          referenceWidth: 320,
          referenceHeight: 180,
        },
        ocrProcessName: "  game.exe  ",
      },
    });

    expect(normalized.nfsHeat.ocrCalibration).toEqual({
      x: 0,
      y: 100,
      width: 320,
      height: 80,
      referenceWidth: 320,
      referenceHeight: 180,
    });
    expect(normalized.nfsHeat.ocrProcessName).toBe("game.exe");
  });

  it("supports adaptive trigger speeds above 400 km/h", () => {
    const normalized = normalizeAdaptiveTriggerSettings({
      enabled: true,
      inputSource: "demo",
      selectedGame: "nfsHeat",
      nfsHeat: {
        demoSpeedKph: 950,
        minSpeedKph: 80,
        maxSpeedKph: 1200,
        brakeStartPosition: 72,
        brakeEndPosition: 188,
        brakeMinForce: 38,
        brakeMaxForce: 168,
        throttleStartPosition: 92,
        throttleMinForce: 18,
        throttleMaxForce: 92,
        ocrCalibration: null,
        ocrProcessName: null,
      },
    });

    expect(normalized.nfsHeat.demoSpeedKph).toBe(950);
    expect(normalized.nfsHeat.maxSpeedKph).toBe(999);
  });
});
