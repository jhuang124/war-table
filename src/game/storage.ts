// Persistence: risk3d.save.v1 (the GameState), risk3d.ui.v1 (UI meta next to the save + the last
// new-game setup), risk3d.settings.v1. Injectable so the controller runs in Node tests.

import type { GameState } from '../engine';
import type { Settings } from './viewModel';

export const SAVE_KEY = 'risk3d.save.v1';
export const UI_KEY = 'risk3d.ui.v1';
export const SETTINGS_KEY = 'risk3d.settings.v1';

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

export function browserKV(): KV {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return memoryKV();
    const probe = '__risk3d_probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          /* quota / private mode: saving is best-effort */
        }
      },
      remove: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return memoryKV();
  }
}

export function readJson<T>(kv: KV, key: string): T | null {
  const raw = kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(kv: KV, key: string, value: unknown): void {
  kv.set(key, JSON.stringify(value));
}

export interface SaveFile {
  v: 1;
  savedAt: number;
  state: GameState;
}

export const DEFAULT_SETTINGS: Settings = {
  animationSpeed: 1,
  aiSpeed: 'watch',
  textSize: 'laptop',
  showLabels: false,
  hideCardsBetweenTurns: false,
  sfxVolume: 0.8,
  muted: false,
  music: false,
  reduceMotion: false,
  showWinChance: true,
  autoCamera: true,
};

/** Settings file version (v3: the hand-off cover defaults on for touch devices, docs/MOBILE.md §5). */
export const SETTINGS_VERSION = 3;

/**
 * Defaults for this device. A phone or tablet is physically passed around, so the hand-off cover (which
 * hides the next player's cards) defaults on there; it only ever shows with 2+ humans.
 */
export function defaultSettings(touch = false): Settings {
  return { ...DEFAULT_SETTINGS, hideCardsBetweenTurns: touch };
}

export function sanitizeSettings(x: unknown, touch = false): Settings {
  const s = defaultSettings(touch);
  if (!x || typeof x !== 'object') return s;
  const o = x as Partial<Settings>;
  const v = (x as { v?: number }).v ?? 1;
  if (o.animationSpeed === 0 || o.animationSpeed === 1 || o.animationSpeed === 2) s.animationSpeed = o.animationSpeed;
  if (o.aiSpeed === 'watch' || o.aiSpeed === 'fast' || o.aiSpeed === 'instant') s.aiSpeed = o.aiSpeed;
  if (o.textSize === 'laptop' || o.textSize === 'couch' || o.textSize === 'tv') s.textSize = o.textSize;
  for (const k of ['hideCardsBetweenTurns', 'muted', 'music', 'reduceMotion', 'showWinChance', 'autoCamera'] as const) {
    if (typeof o[k] === 'boolean') s[k] = o[k] as boolean;
  }
  // Before v3 the cover defaulted off everywhere, so a saved `false` on a touch device was the old
  // default, not a choice: only an explicit `true` (or a v3 file) counts there.
  if (touch && v < 3 && o.hideCardsBetweenTurns === false) s.hideCardsBetweenTurns = true;
  // Territory names went off by default in the simplify pass (settings v2): a v1 file's `true` was the
  // old default, not a choice, so only a v2 file's value counts.
  if (v >= 2 && typeof o.showLabels === 'boolean') s.showLabels = o.showLabels;
  if (typeof o.sfxVolume === 'number' && Number.isFinite(o.sfxVolume)) s.sfxVolume = Math.min(1, Math.max(0, o.sfxVolume));
  return s;
}

export function isPlausibleState(s: unknown): s is GameState {
  if (!s || typeof s !== 'object') return false;
  const g = s as GameState;
  return g.version === 1 && Array.isArray(g.players) && !!g.territories && !!g.phase && !!g.config;
}

export const TEXT_SCALE: Record<Settings['textSize'], number> = { laptop: 1, couch: 1.25, tv: 1.5 };
