import { describe, expect, it } from "vitest";

import {
  computeNeedForSpeedHeatAdaptiveTriggers,
  defaultAdaptiveTriggerSettings,
  resolveAdaptiveTriggerSettings,
} from "./adaptiveTriggers";

describe("adaptive trigger helpers", () => {
  it("creates disabled demo settings by default", () => {
    const settings = defaultAdaptiveTriggerSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.inputSource).toBe("demo");
    expect(settings.selectedGame).toBe("nfsHeat");
    expect(settings.nfsHeat.demoSpeedKph).toBeGreaterThan(0);
  });

  it("normalizes invalid speed ranges and clamps the demo speed", () => {
    const settings = resolveAdaptiveTriggerSettings({
      enabled: true,
      inputSource: "live",
      selectedGame: "nfsHeat",
      nfsHeat: {
        demoSpeedKph: 1500,
        minSpeedKph: 320,
        maxSpeedKph: 1200,
        brakeStartPosition: 40,
        brakeEndPosition: 190,
        brakeMinForce: 70,
        brakeMaxForce: 220,
        throttleStartPosition: 55,
        throttleMinForce: 30,
        throttleMaxForce: 180,
        ocrCalibration: null,
        ocrProcessName: null,
      },
    });

    expect(settings.nfsHeat.maxSpeedKph).toBeGreaterThan(settings.nfsHeat.minSpeedKph);
    expect(settings.nfsHeat.maxSpeedKph).toBe(999);
    expect(settings.nfsHeat.demoSpeedKph).toBe(999);
    expect(settings.inputSource).toBe("live");
  });

  it("scales trigger force with Need for Speed: Heat demo speed", () => {
    const base = defaultAdaptiveTriggerSettings().nfsHeat;
    const slow = computeNeedForSpeedHeatAdaptiveTriggers({
      ...base,
      demoSpeedKph: base.minSpeedKph,
    });
    const fast = computeNeedForSpeedHeatAdaptiveTriggers({
      ...base,
      demoSpeedKph: base.maxSpeedKph,
    });

    expect(slow.normalizedSpeed).toBe(0);
    expect(fast.normalizedSpeed).toBe(1);
    expect((fast.left.force ?? 0)).toBeGreaterThan(slow.left.force ?? 0);
    expect((fast.right.force ?? 0)).toBeGreaterThan(slow.right.force ?? 0);
    expect(fast.left.kind).toBe("sectionResistance");
    expect(fast.right.kind).toBe("continuousResistance");
  });
});
