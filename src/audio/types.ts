// Public audio types. `SfxName`, `AudioEngine` and `createAudio()` match docs/SPEC.md §8;
// everything marked "extra" is additive.

export type SfxName =
  | 'uiClick'
  | 'uiHover'
  | 'uiError'
  | 'place'
  | 'unplace'
  | 'diceShake'
  | 'diceLand'
  | 'hit'
  | 'conquer'
  | 'march'
  | 'cardDraw'
  | 'cardTrade'
  | 'continent'
  | 'eliminated'
  | 'victory'
  | 'turnStart'
  | 'whoosh';

export const SFX_NAMES: readonly SfxName[] = [
  'uiClick',
  'uiHover',
  'uiError',
  'place',
  'unplace',
  'diceShake',
  'diceLand',
  'hit',
  'conquer',
  'march',
  'cardDraw',
  'cardTrade',
  'continent',
  'eliminated',
  'victory',
  'turnStart',
  'whoosh',
];

export interface PlayOptions {
  /** Per-play gain, 0..2 (1 = designed level). */
  volume?: number;
  /** Stereo position, -1 (left) .. 1 (right). */
  pan?: number;
  /** Playback rate, 0.5..2: scales pitch and timing together (tape-style). */
  rate?: number;
  /** extra: start this many seconds from now (sample-accurate, cancelled by stopAll). */
  delay?: number;
  /**
   * extra: length in seconds for sounds that follow a motion, without changing pitch
   * (diceShake = the shake, march = lift-off to landing, whoosh = the camera move). Others ignore it.
   */
  duration?: number;
  /**
   * extra: 'bright' = turnStart after one or more AI turns (UX §3.1).
   * 'somber' = conquer / continent in a minor colour (your territory or continent was taken, "HELD!").
   */
  variant?: SfxVariant;
}

export type SfxVariant = 'bright' | 'somber';

export interface AudioStats {
  /** 'locked' until the first user gesture creates/resumes the context. */
  state: 'locked' | 'suspended' | 'running' | 'closed' | 'unavailable';
  voices: number;
  voicesByName: Partial<Record<SfxName, number>>;
  played: number;
  dropped: number;
  stolen: number;
  music: boolean;
  /** Keys held in the pre-rendered sound bank (warms up in the background after unlock). */
  banked: number;
}

export interface AudioEngine {
  /** Create/resume the AudioContext. Call from a user gesture (also done automatically on the first gesture). */
  unlock(): void;
  /** Fire-and-forget. Safe before unlock (no-op) and never throws. */
  play(name: SfxName, opts?: PlayOptions): void;
  /** 0..1 master for SFX (perceptual curve). */
  setVolume(v: number): void;
  /** Mutes SFX and music. */
  setMuted(m: boolean): void;
  /** Ambient bed on/off. Remembered if called before unlock. Default off. */
  setMusic(on: boolean): void;

  /** extra: 0..1 music level (default 0.7). */
  setMusicVolume(v: number): void;
  /** extra: fade out every playing/scheduled SFX voice (use with skipAnimations). Music is untouched. */
  stopAll(): void;
  /** extra: true once the AudioContext exists and has been asked to run. */
  isUnlocked(): boolean;
  /** extra: counters for debugging / tests. */
  stats(): AudioStats;
  /** extra: close the context and remove listeners. */
  dispose(): void;
}

export interface CreateAudioOptions {
  volume?: number;
  muted?: boolean;
  music?: boolean;
  musicVolume?: number;
  /** Install one-shot pointer/key listeners that call unlock(). Default true. */
  autoUnlock?: boolean;
}

// ---------------------------------------------------------------------------
// Internal: how a sound is described
// ---------------------------------------------------------------------------

export type Rand = () => number;

export interface VoiceOpts {
  /** Tape-style rate, already clamped to 0.5..2. */
  rate: number;
  /** Uniform [0,1). Seeded in offline renders, Math.random live. */
  rand: Rand;
  /** Motion length in seconds (see PlayOptions.duration), already clamped. */
  duration?: number;
  variant?: SfxVariant;
}

/**
 * Builds one sound into `dest`, starting at context time `t`.
 * Returns how long (seconds after t) until it is silent, excluding the shared room tail.
 */
export type SoundFn = (ctx: BaseAudioContext, dest: AudioNode, t: number, opts: VoiceOpts) => number;

/**
 * Loudness tiers, following the stakes ladder (UX §5.2: routine stays quiet so swings feel big).
 * Targets are short-term (200 ms window, K-weighted) peak loudness in LUFS at volume 1.
 *  micro  uiHover (−18 dB under uiClick, UX §5.4)
 *  ui     uiClick, uiError, whoosh
 *  die    one diceLand (a 5-die roll sums to about board level)
 *  board  place, unplace, march, diceShake, cardDraw
 *  cue    routine musical cues and the hit: conquer, turnStart, cardTrade, hit
 *  swing  continent
 *  drama  eliminated
 *  finale victory
 */
export type LoudnessTier = 'micro' | 'ui' | 'die' | 'board' | 'cue' | 'swing' | 'drama' | 'finale';

export const TIER_TARGET_LUFS: Record<LoudnessTier, number> = {
  micro: -45,
  ui: -27,
  die: -27,
  board: -22,
  cue: -21,
  swing: -19,
  drama: -18,
  finale: -17,
};

export interface SfxMeta {
  fn: SoundFn;
  label: string;
  group: 'UI' | 'Board' | 'Battle' | 'Cards' | 'Stingers';
  tier: LoudnessTier;
  /** Loudness-normalisation trim, measured offline (see lab "Analyze"). */
  trimDb: number;
  /** Room reverb send, linear. */
  wet: number;
  /** Upper bound on SoundFn's returned duration at rate 1 (offline render length). */
  maxDur: number;
  /** Concurrent voices of this sound before the oldest is stolen. */
  maxVoices: number;
  /** Retriggers closer than this are dropped. */
  minGapMs: number;
  /** Global voice stealing takes the lowest priority first. */
  priority: number;
  /** Duck the music bed by this many dB while the sound plays. */
  duckDb?: number;
  /** Each already-playing voice of this sound lowers a new one by this many dB (density control). */
  densityDb?: number;
  /** Cap for the density attenuation, dB. */
  densityMaxDb?: number;
  /** Clamp range for PlayOptions.duration, seconds [min, max, default]. Absent = not motion-following. */
  duration?: [number, number, number];
  /** Pitched in D with the music bed: banked playback never adds pitch jitter. */
  musical?: boolean;
}
