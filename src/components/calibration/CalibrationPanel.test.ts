import { describe, expect, it } from "vitest";

import { buildFirmwareWizardSteps, getStickReadiness } from "./CalibrationPanel";
import { EMPTY_FIRMWARE_STATUS, EMPTY_LIVE_INPUT } from "../../mapping";

describe("getStickReadiness", () => {
  it("allows center capture when the stick is resting", () => {
    const readiness = getStickReadiness(EMPTY_LIVE_INPUT.leftStick);

    expect(readiness.canCaptureCenter).toBe(true);
    expect(readiness.statusLabel).toBe("Resting now");
  });

  it("blocks center capture while the stick is moving", () => {
    const readiness = getStickReadiness({
      ...EMPTY_LIVE_INPUT.leftStick,
      normalizedX: 0.22,
      calibratedX: 0.2,
    });

    expect(readiness.canCaptureCenter).toBe(false);
    expect(readiness.statusLabel).toBe("Moving");
  });
});

describe("buildFirmwareWizardSteps", () => {
  it("flags USB connection as required when the controller is not eligible", () => {
    const steps = buildFirmwareWizardSteps(EMPTY_FIRMWARE_STATUS, false);

    expect(steps[0].tone).toBe("warning");
    expect(steps[0].detail).toContain("Connect a DualSense by USB");
  });

  it("marks the workflow as active once a calibration mode has started", () => {
    const steps = buildFirmwareWizardSteps(
      {
        ...EMPTY_FIRMWARE_STATUS,
        connected: true,
        transport: "usb",
        eligible: true,
        busy: true,
        activeMode: "center",
        step: "centerSampling",
        canSampleCenter: true,
        lastMessage: "Leave both sticks centered, then click Sample Center.",
      },
      false,
    );

    expect(steps[0].tone).toBe("complete");
    expect(steps[1].tone).toBe("complete");
    expect(steps[2].tone).toBe("active");
  });
});
