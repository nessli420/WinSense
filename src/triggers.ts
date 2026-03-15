import type { HapticProfile, TriggerEffect, TriggerEffectKind } from "./mapping";
import { DEFAULT_TRIGGER_EFFECT, normalizeTriggerEffect } from "./mapping";
import { generateHapticProfileId } from "./profileIds";

export type TriggerFieldKey = "force" | "startPosition" | "endPosition" | "frequency" | "rawMode" | "rawParams";

export interface TriggerEffectDefinition {
  kind: TriggerEffectKind;
  label: string;
  description: string;
  mode: number;
  fields: TriggerFieldKey[];
}

export const makeTriggerEffect = (effect: Partial<TriggerEffect> & Pick<TriggerEffect, "kind">): TriggerEffect =>
  normalizeTriggerEffect({
    ...DEFAULT_TRIGGER_EFFECT,
    ...effect,
  });

export const BUILTIN_HAPTIC_PROFILES: HapticProfile[] = [
  {
    id: "builtin-neutral",
    name: "Neutral",
    description: "No adaptive trigger effect. Good baseline for testing or light-touch games.",
    category: "General",
    builtIn: true,
    left: makeTriggerEffect({ kind: "off" }),
    right: makeTriggerEffect({ kind: "off" }),
  },
  {
    id: "builtin-fps-rifle",
    name: "FPS Rifle",
    description: "Firm resistance early in the pull with a short break point for shooters.",
    category: "FPS",
    builtIn: true,
    left: makeTriggerEffect({ kind: "sectionResistance", startPosition: 70, endPosition: 160, force: 170 }),
    right: makeTriggerEffect({ kind: "sectionResistance", startPosition: 38, endPosition: 182, force: 210 }),
  },
  {
    id: "builtin-hair-trigger",
    name: "Hair Trigger",
    description: "Short travel and low resistance so shots break quickly.",
    category: "FPS",
    builtIn: true,
    left: makeTriggerEffect({ kind: "continuousResistance", startPosition: 25, force: 70 }),
    right: makeTriggerEffect({ kind: "continuousResistance", startPosition: 18, force: 88 }),
  },
  {
    id: "builtin-bow-draw",
    name: "Bow Draw",
    description: "Progressive tension for drawing and releasing a bowstring.",
    category: "Action",
    builtIn: true,
    left: makeTriggerEffect({ kind: "continuousResistance", startPosition: 90, force: 150 }),
    right: makeTriggerEffect({ kind: "sectionResistance", startPosition: 84, endPosition: 188, force: 205 }),
  },
  {
    id: "builtin-racing-brake",
    name: "Racing Brake",
    description: "Heavy L2 brake pressure with a lighter throttle response on R2.",
    category: "Racing",
    builtIn: true,
    left: makeTriggerEffect({ kind: "sectionResistance", startPosition: 40, endPosition: 190, force: 220 }),
    right: makeTriggerEffect({ kind: "continuousResistance", startPosition: 54, force: 135 }),
  },
  {
    id: "builtin-racing-abs",
    name: "ABS Braking",
    description: "Vibration pulses under heavy braking with a softer throttle side.",
    category: "Racing",
    builtIn: true,
    left: makeTriggerEffect({ kind: "vibration", startPosition: 20, force: 170, frequency: 55 }),
    right: makeTriggerEffect({ kind: "continuousResistance", startPosition: 52, force: 120 }),
  },
  {
    id: "builtin-automatic-fire",
    name: "Automatic Fire",
    description: "Rapid machine-gun feedback suited to SMGs and chainguns.",
    category: "FPS",
    builtIn: true,
    left: makeTriggerEffect({ kind: "off" }),
    right: makeTriggerEffect({ kind: "machineGun", force: 210, frequency: 42 }),
  },
  {
    id: "builtin-shotgun-kick",
    name: "Shotgun Kick",
    description: "Short heavy burst for high-impact trigger pulls.",
    category: "Action",
    builtIn: true,
    left: makeTriggerEffect({ kind: "continuousResistance", startPosition: 75, force: 120 }),
    right: makeTriggerEffect({ kind: "machineGun", force: 245, frequency: 22 }),
  },
  {
    id: "builtin-immersive-rumble",
    name: "Immersive Rumble",
    description: "Low-travel vibration for ambient road, engine, or weapon feedback.",
    category: "Immersion",
    builtIn: true,
    left: makeTriggerEffect({ kind: "vibration", startPosition: 0, force: 120, frequency: 28 }),
    right: makeTriggerEffect({ kind: "vibration", startPosition: 0, force: 135, frequency: 32 }),
  },
  {
    id: "builtin-heavy-charge",
    name: "Heavy Charge",
    description: "High resistance across the pull for charged attacks and heavy tools.",
    category: "Action",
    builtIn: true,
    left: makeTriggerEffect({ kind: "continuousResistance", startPosition: 55, force: 200 }),
    right: makeTriggerEffect({ kind: "continuousResistance", startPosition: 55, force: 200 }),
  },
];

export const TRIGGER_EFFECT_DEFINITIONS: TriggerEffectDefinition[] = [
  {
    kind: "off",
    label: "Off",
    description: "Disable adaptive trigger output for a normal trigger feel.",
    mode: 0,
    fields: [],
  },
  {
    kind: "continuousResistance",
    label: "Continuous Resistance",
    description: "Add resistance from a chosen point onward through the trigger pull.",
    mode: 1,
    fields: ["startPosition", "force"],
  },
  {
    kind: "sectionResistance",
    label: "Section Resistance",
    description: "Create a resistance band between start and end positions.",
    mode: 2,
    fields: ["startPosition", "endPosition", "force"],
  },
  {
    kind: "vibration",
    label: "Vibration",
    description: "Introduce repeating vibration once the trigger passes the start point.",
    mode: 6,
    fields: ["startPosition", "force", "frequency"],
  },
  {
    kind: "machineGun",
    label: "Machine Gun",
    description: "Fast repeating bursts intended for automatic fire or staccato recoil.",
    mode: 39,
    fields: ["force", "frequency"],
  },
  {
    kind: "raw",
    label: "Expert Raw",
    description: "Directly send a trigger mode and payload bytes for advanced experimentation.",
    mode: 0,
    fields: ["rawMode", "rawParams"],
  },
];

export const getTriggerEffectDefinition = (kind: TriggerEffectKind) =>
  TRIGGER_EFFECT_DEFINITIONS.find((definition) => definition.kind === kind) ?? TRIGGER_EFFECT_DEFINITIONS[0];

export const describeTriggerEffect = (effect: TriggerEffect) => {
  const definition = getTriggerEffectDefinition(effect.kind);
  if (effect.kind === "off") return "No adaptive effect";
  if (effect.kind === "continuousResistance") {
    return `Start ${effect.startPosition ?? 0}, force ${effect.force ?? 0}`;
  }
  if (effect.kind === "sectionResistance") {
    return `Zone ${effect.startPosition ?? 0}-${effect.endPosition ?? 180}, force ${effect.force ?? 0}`;
  }
  if (effect.kind === "vibration") {
    return `Start ${effect.startPosition ?? 0}, force ${effect.force ?? 0}, freq ${effect.frequency ?? 30}`;
  }
  if (effect.kind === "machineGun") {
    return `Force ${effect.force ?? 0}, freq ${effect.frequency ?? 30}`;
  }
  return `${definition.label} mode ${effect.rawMode ?? 0}`;
};

export const createHapticProfileDraft = (left: TriggerEffect, right: TriggerEffect): HapticProfile => ({
  id: generateHapticProfileId(),
  name: "",
  description: "",
  category: "Custom",
  builtIn: false,
  left: normalizeTriggerEffect(left),
  right: normalizeTriggerEffect(right),
});
