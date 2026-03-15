import type { LightingColor, LightingEffect, LightingProfile, LightingSettings } from "./mapping";
import { generateLightingProfileId } from "./profileIds";

const clampU8 = (value: number) => Math.max(0, Math.min(255, Math.round(value || 0)));
export const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value || 0)));

export const DEFAULT_LIGHTING: LightingSettings = {
  enabled: true,
  profileId: "playstation-blue",
  profile: {
    id: "playstation-blue",
    name: "PlayStation Blue",
    description: "A clean default blue tuned for the DualSense lightbar.",
    builtIn: true,
    effect: "static",
    color: { r: 96, g: 126, b: 255 },
    accentColor: null,
    speed: 55,
    brightness: 100,
  },
};

export const BUILTIN_LIGHTING_PROFILES: LightingProfile[] = [
  {
    id: "playstation-blue",
    name: "PlayStation Blue",
    description: "A clean default blue tuned for the DualSense lightbar.",
    builtIn: true,
    effect: "static",
    color: { r: 96, g: 126, b: 255 },
    accentColor: null,
    speed: 55,
    brightness: 100,
  },
  {
    id: "ice-white",
    name: "Ice White",
    description: "Soft cool white for a clean desk setup.",
    builtIn: true,
    effect: "static",
    color: { r: 210, g: 225, b: 255 },
    accentColor: null,
    speed: 48,
    brightness: 100,
  },
  {
    id: "sunset-pulse",
    name: "Sunset Pulse",
    description: "Warm orange and magenta that breathe in and out.",
    builtIn: true,
    effect: "pulse",
    color: { r: 255, g: 126, b: 80 },
    accentColor: { r: 255, g: 72, b: 166 },
    speed: 52,
    brightness: 100,
  },
  {
    id: "ocean-wave",
    name: "Ocean Wave",
    description: "A rolling wave between cyan and deep blue.",
    builtIn: true,
    effect: "wave",
    color: { r: 46, g: 214, b: 255 },
    accentColor: { r: 58, g: 109, b: 255 },
    speed: 60,
    brightness: 100,
  },
  {
    id: "rgb-cycle",
    name: "RGB Cycle",
    description: "Constantly changing rainbow colors across the full spectrum.",
    builtIn: true,
    effect: "cycle",
    color: { r: 255, g: 0, b: 128 },
    accentColor: null,
    speed: 68,
    brightness: 100,
  },
];

export const cloneLightingColor = (color: LightingColor | null | undefined): LightingColor | null =>
  color ? { ...color } : null;

export const cloneLightingProfile = (profile: LightingProfile): LightingProfile => ({
  ...profile,
  color: { ...profile.color },
  accentColor: cloneLightingColor(profile.accentColor),
});

export const defaultLightingProfile = (): LightingProfile => cloneLightingProfile(DEFAULT_LIGHTING.profile);

export const createCustomLightingProfileDraft = (): LightingProfile => ({
  id: generateLightingProfileId(),
  name: "",
  description: "",
  builtIn: false,
  effect: "static",
  color: { ...DEFAULT_LIGHTING.profile.color },
  accentColor: { ...DEFAULT_LIGHTING.profile.color },
  speed: DEFAULT_LIGHTING.profile.speed,
  brightness: DEFAULT_LIGHTING.profile.brightness,
});

export const getLightingProfile = (profiles: LightingProfile[], profileId: string | null | undefined) =>
  profileId ? profiles.find((profile) => profile.id === profileId) ?? null : null;

export const usesAccentColor = (effect: LightingEffect) => effect === "pulse" || effect === "wave";

const scaleColor = (color: LightingColor, brightness: number): LightingColor => {
  const factor = clampPercent(brightness) / 100;
  return {
    r: clampU8(color.r * factor),
    g: clampU8(color.g * factor),
    b: clampU8(color.b * factor),
  };
};

const mixColors = (first: LightingColor, second: LightingColor, ratio: number): LightingColor => ({
  r: clampU8(first.r + (second.r - first.r) * ratio),
  g: clampU8(first.g + (second.g - first.g) * ratio),
  b: clampU8(first.b + (second.b - first.b) * ratio),
});

const hsvToRgb = (hue: number, saturation: number, value: number): LightingColor => {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = value * saturation;
  const segment = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const match = value - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (normalizedHue < 60) {
    red = chroma;
    green = segment;
  } else if (normalizedHue < 120) {
    red = segment;
    green = chroma;
  } else if (normalizedHue < 180) {
    green = chroma;
    blue = segment;
  } else if (normalizedHue < 240) {
    green = segment;
    blue = chroma;
  } else if (normalizedHue < 300) {
    red = segment;
    blue = chroma;
  } else {
    red = chroma;
    blue = segment;
  }

  return {
    r: clampU8((red + match) * 255),
    g: clampU8((green + match) * 255),
    b: clampU8((blue + match) * 255),
  };
};

const rgbToHue = (color: LightingColor): number => {
  const red = color.r / 255;
  const green = color.g / 255;
  const blue = color.b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  if (max === red) {
    return ((green - blue) / delta) * 60 + (green < blue ? 360 : 0);
  }

  if (max === green) {
    return ((blue - red) / delta) * 60 + 120;
  }

  return ((red - green) / delta) * 60 + 240;
};

export const computeLightingColor = (profile: LightingProfile, now = Date.now()): LightingColor => {
  const speedFactor = 0.55 + clampPercent(profile.speed) / 65;

  if (profile.effect === "static") {
    return scaleColor(profile.color, profile.brightness);
  }

  if (profile.effect === "cycle") {
    return hsvToRgb(
      rgbToHue(profile.color) + (now / 14) * speedFactor,
      0.95,
      clampPercent(profile.brightness) / 100,
    );
  }

  if (profile.effect === "pulse") {
    const pulse = (Math.sin((now / 440) * speedFactor) + 1) / 2;
    return mixColors(
      scaleColor(profile.accentColor ?? profile.color, profile.brightness * 0.3),
      scaleColor(profile.color, profile.brightness),
      pulse,
    );
  }

  const wave = (Math.sin((now / 520) * speedFactor) + 1) / 2;
  return mixColors(
    scaleColor(profile.color, profile.brightness),
    scaleColor(profile.accentColor ?? profile.color, profile.brightness),
    wave,
  );
};
