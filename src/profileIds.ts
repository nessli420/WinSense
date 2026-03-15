export function generateMappingProfileId() {
  return "mp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function generateLightingProfileId() {
  return "lp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function generateHapticProfileId() {
  return "tp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
