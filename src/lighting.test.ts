import { describe, expect, it } from "vitest";

import {
  BUILTIN_LIGHTING_PROFILES,
  computeLightingColor,
  createCustomLightingProfileDraft,
  usesAccentColor,
} from "./lighting";

describe("lighting helpers", () => {
  it("creates editable custom drafts", () => {
    const draft = createCustomLightingProfileDraft();

    expect(draft.builtIn).toBe(false);
    expect(draft.effect).toBe("static");
    expect(draft.name).toBe("");
    expect(draft.id.startsWith("lp-")).toBe(true);
  });

  it("keeps computed colors within RGB bounds", () => {
    const color = computeLightingColor(BUILTIN_LIGHTING_PROFILES[2], 12345);

    expect(color.r).toBeGreaterThanOrEqual(0);
    expect(color.r).toBeLessThanOrEqual(255);
    expect(color.g).toBeGreaterThanOrEqual(0);
    expect(color.g).toBeLessThanOrEqual(255);
    expect(color.b).toBeGreaterThanOrEqual(0);
    expect(color.b).toBeLessThanOrEqual(255);
  });

  it("flags accent-driven effects correctly", () => {
    expect(usesAccentColor("pulse")).toBe(true);
    expect(usesAccentColor("wave")).toBe(true);
    expect(usesAccentColor("cycle")).toBe(false);
  });
});
