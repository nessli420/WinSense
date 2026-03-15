import type {
  AdaptiveTriggerSettings,
  NeedForSpeedHeatAdaptiveTriggerSettings,
  TriggerEffect,
} from "./mapping";
import {
  cloneAdaptiveTriggerSettings,
  DEFAULT_ADAPTIVE_TRIGGER_SETTINGS,
  normalizeAdaptiveTriggerSettings,
} from "./mapping";
import { makeTriggerEffect } from "./triggers";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const MAX_ADAPTIVE_TRIGGER_SPEED_KPH = 999;
const clampKph = (value: number) => Math.max(0, Math.min(MAX_ADAPTIVE_TRIGGER_SPEED_KPH, Math.round(value || 0)));
const lerp = (min: number, max: number, amount: number) => min + (max - min) * amount;
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export interface AdaptiveTriggerPreview {
  gameId: AdaptiveTriggerSettings["selectedGame"];
  speedKph: number;
  normalizedSpeed: number;
  left: TriggerEffect;
  right: TriggerEffect;
}

export const defaultAdaptiveTriggerSettings = (): AdaptiveTriggerSettings =>
  cloneAdaptiveTriggerSettings(DEFAULT_ADAPTIVE_TRIGGER_SETTINGS);

export const resolveAdaptiveTriggerSettings = (
  settings: Partial<AdaptiveTriggerSettings> | null | undefined,
): AdaptiveTriggerSettings => normalizeAdaptiveTriggerSettings(settings);

export const computeNeedForSpeedHeatAdaptiveTriggers = (
  settings: NeedForSpeedHeatAdaptiveTriggerSettings,
): AdaptiveTriggerPreview => computeNeedForSpeedHeatAdaptiveTriggersForSpeed(settings, settings.demoSpeedKph);

export const computeNeedForSpeedHeatAdaptiveTriggersForSpeed = (
  settings: NeedForSpeedHeatAdaptiveTriggerSettings,
  speedOverrideKph: number,
): AdaptiveTriggerPreview => {
  const minSpeed = clampKph(settings.minSpeedKph);
  const maxSpeed = Math.max(minSpeed + 1, clampKph(settings.maxSpeedKph));
  const speedKph = Math.max(minSpeed, Math.min(maxSpeed, clampKph(speedOverrideKph)));
  const normalizedSpeed = clamp01((speedKph - minSpeed) / (maxSpeed - minSpeed));
  const brakeResponse = smoothstep(normalizedSpeed);
  const throttleResponse = smoothstep(normalizedSpeed ** 1.25);

  const leftForce = Math.round(lerp(settings.brakeMinForce, settings.brakeMaxForce, brakeResponse));
  const rightForce = Math.round(lerp(settings.throttleMinForce, settings.throttleMaxForce, throttleResponse));

  return {
    gameId: "nfsHeat",
    speedKph,
    normalizedSpeed,
    left: makeTriggerEffect({
      kind: "sectionResistance",
      startPosition: settings.brakeStartPosition,
      endPosition: settings.brakeEndPosition,
      force: leftForce,
    }),
    right: makeTriggerEffect({
      kind: "continuousResistance",
      startPosition: settings.throttleStartPosition,
      force: rightForce,
    }),
  };
};

export const computeAdaptiveTriggerPreview = (
  settings: AdaptiveTriggerSettings,
): AdaptiveTriggerPreview => {
  if (settings.selectedGame === "nfsHeat") {
    return computeNeedForSpeedHeatAdaptiveTriggers(settings.nfsHeat);
  }

  return computeNeedForSpeedHeatAdaptiveTriggers(DEFAULT_ADAPTIVE_TRIGGER_SETTINGS.nfsHeat);
};
