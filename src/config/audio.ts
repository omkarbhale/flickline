export interface AudioTunables {
  /** Master gain multiplier applied on top of the user volume setting. */
  masterGain: number;
}

export const audio: AudioTunables = { masterGain: 0.5 };
