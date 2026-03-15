import type { AudioSettings } from "./mapping";

export const DEFAULT_AUDIO: AudioSettings = {
  speakerVolume: 70,
  headphoneVolume: 80,
  micVolume: 40,
  micMute: false,
  audioMute: false,
  micMuteLed: 0,
  forceInternalMic: false,
  forceInternalSpeaker: false,
};
