// createAudio(): the live engine the game uses.
//
// - The AudioContext is created lazily inside the first user gesture (no autoplay warnings), via
//   one-shot pointer/key listeners or an explicit unlock().
// - play() before unlock is a silent no-op; nothing is queued, nothing throws.
// - Settings made before unlock (volume, mute, music) are remembered and applied on unlock.

import { clamp } from './dsp';
import { LOOKAHEAD, Mixer } from './mixer';
import type { AudioEngine, AudioStats, CreateAudioOptions, PlayOptions, SfxName } from './types';

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

const GESTURES = ['pointerdown', 'mousedown', 'touchend', 'keydown'] as const;

export function createAudio(options: CreateAudioOptions = {}): AudioEngine {
  const w = typeof window !== 'undefined' ? (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }) : null;
  const AC: AudioContextCtor | undefined = w ? w.AudioContext ?? w.webkitAudioContext : undefined;

  let ctx: AudioContext | null = null;
  let mixer: Mixer | null = null;
  let volume = clamp(options.volume ?? 0.8, 0, 1);
  let musicVolume = clamp(options.musicVolume ?? 0.7, 0, 1);
  let muted = !!options.muted;
  let musicWanted = !!options.music;
  let resumeAskedAt = -Infinity;
  let disposed = false;
  let listening = false;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const onGesture = () => {
    unlock();
  };
  const listen = (on: boolean) => {
    if (!w || listening === on) return;
    listening = on;
    for (const e of GESTURES) {
      if (on) window.addEventListener(e, onGesture, { capture: true, passive: true });
      else window.removeEventListener(e, onGesture, { capture: true });
    }
  };
  if (AC && options.autoUnlock !== false) listen(true);

  const syncMusic = () => {
    if (!ctx || !mixer || ctx.state !== 'running') return;
    if (musicWanted && !mixer.musicOn) mixer.startMusic(ctx.currentTime + 0.05);
    else if (!musicWanted && mixer.musicOn) mixer.stopMusic();
  };

  function unlock(): void {
    if (disposed || !AC) return;
    try {
      if (!ctx) {
        ctx = new AC({ latencyHint: 'interactive' });
        mixer = new Mixer(ctx, ctx.destination, { limiter: true, live: true });
        mixer.sfxBus.gain.value = volume * volume;
        mixer.musicVol.gain.value = musicVolume * musicVolume;
        mixer.muteGain.gain.value = muted ? 0 : 1;
        mixer.bank?.warmAll();
        ctx.onstatechange = () => syncMusic();
      }
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
        resumeAskedAt = now();
        ctx.resume().then(syncMusic, () => {});
      }
      syncMusic();
    } catch (err) {
      console.warn('[audio] unlock failed', err);
    }
  }

  function play(name: SfxName, o: PlayOptions = {}): void {
    try {
      if (disposed || !ctx || !mixer) return;
      if (ctx.state !== 'running') {
        // Sounds requested in the same gesture that unlocked us play the moment resume() lands.
        // Anything later while suspended is dropped (never a late burst of queued sounds).
        if (!(ctx.state === 'suspended' && now() - resumeAskedAt < 500)) return;
      }
      const delay = clamp(Number.isFinite(o.delay) ? (o.delay as number) : 0, 0, 30);
      mixer.trigger(name, ctx.currentTime + LOOKAHEAD + delay, {
        volume: Number.isFinite(o.volume) ? o.volume : undefined,
        pan: Number.isFinite(o.pan) ? o.pan : undefined,
        rate: Number.isFinite(o.rate) ? o.rate : undefined,
        duration: Number.isFinite(o.duration) ? o.duration : undefined,
        variant: o.variant,
      });
    } catch (err) {
      console.warn(`[audio] play(${String(name)}) failed`, err);
    }
  }

  return {
    unlock,
    play,
    setVolume(v: number) {
      if (!Number.isFinite(v)) return;
      volume = clamp(v, 0, 1);
      if (mixer) mixer.setVolume(volume);
    },
    setMuted(m: boolean) {
      muted = !!m;
      if (mixer) mixer.setMuted(muted);
    },
    setMusic(on: boolean) {
      musicWanted = !!on;
      try {
        syncMusic();
      } catch (err) {
        console.warn('[audio] music failed', err);
      }
    },
    setMusicVolume(v: number) {
      if (!Number.isFinite(v)) return;
      musicVolume = clamp(v, 0, 1);
      if (mixer) mixer.setMusicVolume(musicVolume);
    },
    stopAll() {
      try {
        mixer?.stopAll();
      } catch {
        /* never throw */
      }
    },
    isUnlocked() {
      return !!ctx && ctx.state !== 'closed';
    },
    stats(): AudioStats {
      const state: AudioStats['state'] = !AC ? 'unavailable' : !ctx ? 'locked' : (ctx.state as AudioStats['state']);
      return {
        state,
        voices: mixer ? mixer.voiceCount() : 0,
        voicesByName: mixer ? mixer.voicesByName() : {},
        played: mixer?.played ?? 0,
        dropped: mixer?.dropped ?? 0,
        stolen: mixer?.stolen ?? 0,
        music: mixer?.musicOn ?? false,
        banked: mixer?.bank?.size ?? 0,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listen(false);
      try {
        mixer?.stopMusic();
        mixer?.bank?.dispose();
        void ctx?.close();
      } catch {
        /* ignore */
      }
      ctx = null;
      mixer = null;
    },
  };
}
