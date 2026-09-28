// The battle tray: a felt-lined, wood-rimmed tray drawn in its own pass (depth cleared, after the
// board) with a pixel-mapped camera, so it sits at a fixed CSS-px spot in the battle-panel band.
// Keyframed dice (no physics) that land on the engine's faces.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Animator, ease, type Run } from './anim';
import { crackTexture, diceFaceTexture, feltTexture } from './textures';
import { IVORY } from './util';
import type { PlayerPalette } from '../shared/palette';
import { trayGeometry } from '../shared/tray';

// BoxGeometry material groups: +x, −x, +y, −y, +z, −z. +z faces the viewer (felt normal).
const FACE_VALUES = [3, 4, 2, 5, 1, 6];
const TILT = -0.42; // tray pitch (top edge recedes)

function faceQuat(v: number): THREE.Quaternion {
  const q = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  switch (v) {
    case 1:
      return q;
    case 6:
      return q.setFromAxisAngle(X, Math.PI);
    case 2:
      return q.setFromAxisAngle(X, Math.PI / 2);
    case 5:
      return q.setFromAxisAngle(X, -Math.PI / 2);
    case 3:
      return q.setFromAxisAngle(Y, -Math.PI / 2);
    default:
      return q.setFromAxisAngle(Y, Math.PI / 2);
  }
}

interface Die {
  mesh: THREE.Mesh;
  mats: THREE.MeshStandardMaterial[];
  rim: THREE.Mesh;
  rimMat: THREE.MeshBasicMaterial;
  crack: THREE.Mesh;
  crackMat: THREE.MeshBasicMaterial;
  side: -1 | 1; // attacker left (−1), defender right (+1)
  // animated state (tray-local px)
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  finalQ: THREE.Quaternion;
  bright: number;
  alpha: number;
  lift: number;
  tilt: number;
  scale: number;
  active: boolean;
  rimA: number;
  crackA: number;
}

export interface RollSpec {
  attack: number[];
  defend: number[];
  attacker: PlayerPalette;
  defender: PlayerPalette;
  /** 'single' 1.2 s · 'repeat' 1.05 s · 'first' 700 ms · 'middle' (durMs) · 'final' 700 ms · 'static' */
  mode: 'single' | 'repeat' | 'first' | 'middle' | 'final' | 'static';
  durMs?: number;
  reduced: boolean;
  run: Run | null;
  onShake?: (ms: number) => void;
  /** First touch of die i (side −1 attacker / +1 defender); compressed rolls call it once. */
  onLand?: (side: -1 | 1, i: number) => void;
  onVerdict?: () => void;
}

export class DiceTray {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(20, 1, 10, 20000);
  private root = new THREE.Group();
  private tray = new THREE.Group();
  private dice: Die[] = [];
  private faceCache = new Map<string, THREE.Texture[]>();
  private felt: THREE.Mesh | null = null;
  private rimMesh: THREE.Mesh | null = null;
  private trayMats: THREE.MeshStandardMaterial[] = [];
  private feltTex = feltTexture();
  private crackTex = crackTexture();
  private walnut: THREE.Texture;
  private opacity = 0;
  private shown = false;
  private ver = 0;
  size = 64; // die size in px
  trayW = 640;
  trayH = 110;
  cx = 0;
  cy = 0;
  private W = 1;
  private H = 1;
  private light: THREE.DirectionalLight;
  materials: THREE.Material[] = [];
  lingerUntil = 0;

  constructor(
    private anim: Animator,
    env: THREE.Texture,
    walnut: THREE.Texture,
  ) {
    this.walnut = walnut.clone();
    this.walnut.wrapS = this.walnut.wrapT = THREE.RepeatWrapping;
    this.walnut.needsUpdate = true;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;
    const key = new THREE.DirectionalLight('#ffe0b8', 2.4);
    key.position.set(-260, 420, 900);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -500;
    sc.right = 500;
    sc.top = 300;
    sc.bottom = -300;
    sc.near = 10;
    sc.far = 3000;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 4;
    this.light = key;
    const fill = new THREE.DirectionalLight('#a9c4e4', 0.5);
    fill.position.set(400, -100, 600);
    const hemi = new THREE.HemisphereLight('#d6dde6', '#2a1c12', 0.6);
    this.root.add(key, key.target, fill, hemi);
    this.scene.add(this.root);
    this.root.add(this.tray);
    this.tray.rotation.x = TILT;

    const geo = new RoundedBoxGeometry(1, 1, 1, 4, 0.17);
    const rimGeo = new RoundedBoxGeometry(1.16, 1.16, 1.16, 3, 0.22);
    const crackGeo = new THREE.PlaneGeometry(0.86, 0.86);
    for (let i = 0; i < 5; i++) {
      const mats = FACE_VALUES.map(
        () => new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.0, transparent: true }),
      );
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      const rimMat = new THREE.MeshBasicMaterial({
        color: IVORY,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      mesh.add(rim);
      const crackMat = new THREE.MeshBasicMaterial({
        map: this.crackTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const crack = new THREE.Mesh(crackGeo, crackMat);
      crack.position.z = 0.503;
      mesh.add(crack);
      mesh.visible = false;
      this.tray.add(mesh);
      this.materials.push(...mats, rimMat, crackMat);
      this.dice.push({
        mesh,
        mats,
        rim,
        rimMat,
        crack,
        crackMat,
        side: i < 3 ? -1 : 1,
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        finalQ: new THREE.Quaternion(),
        bright: 1,
        alpha: 1,
        lift: 0,
        tilt: 0,
        scale: 1,
        active: false,
        rimA: 0,
        crackA: 0,
      });
    }
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }
  /** Shown and not fading out. */
  get showing(): boolean {
    return this.shown;
  }

  /** Place the tray: band top y, band height, viewport, die size. All CSS px. */
  layout(W: number, H: number, bandTop: number, bandH: number, uiScale: number): void {
    this.W = W;
    this.H = H;
    // Shared with the HUD's battle band (src/shared/tray.ts), so the text strips always clear the tray.
    const { trayW, die: s, trayH } = trayGeometry(W, H, bandH, uiScale);
    const changed = Math.abs(trayW - this.trayW) > 0.5 || Math.abs(trayH - this.trayH) > 0.5 || Math.abs(s - this.size) > 0.5;
    this.size = s;
    this.trayW = trayW;
    this.trayH = trayH;
    this.cx = W / 2;
    this.cy = bandTop + bandH / 2;
    const fov = 20;
    this.camera.fov = fov;
    this.camera.aspect = W / H;
    const D = H / 2 / Math.tan((fov * Math.PI) / 360);
    this.camera.near = D * 0.2;
    this.camera.far = D * 3;
    this.camera.position.set(0, 0, D);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    // tray center in world = pixel-mapped at z = 0
    this.root.position.set(this.cx - W / 2, H / 2 - this.cy, 0);
    // counter the tilt's foreshortening so the felt spans the intended height
    if (changed || !this.felt) this.buildTray();
    for (const d of this.dice) if (d.active) this.applyDie(d);
  }

  private buildTray(): void {
    if (this.felt) {
      this.tray.remove(this.felt, this.rimMesh!);
      this.felt.geometry.dispose();
      this.rimMesh!.geometry.dispose();
    }
    const w = this.trayW;
    const h = this.trayH / Math.cos(TILT);
    const rim = Math.max(11, this.size * 0.24);
    const r = Math.min(22, h * 0.25);
    const rr = (W: number, H: number, R: number) => {
      const s = new THREE.Shape();
      s.moveTo(-W / 2 + R, -H / 2);
      s.lineTo(W / 2 - R, -H / 2);
      s.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + R);
      s.lineTo(W / 2, H / 2 - R);
      s.quadraticCurveTo(W / 2, H / 2, W / 2 - R, H / 2);
      s.lineTo(-W / 2 + R, H / 2);
      s.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - R);
      s.lineTo(-W / 2, -H / 2 + R);
      s.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + R, -H / 2);
      return s;
    };
    if (!this.trayMats.length) {
      const feltMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: this.feltTex, roughness: 1, transparent: true });
      this.feltTex.repeat.set(1 / 180, 1 / 180);
      this.walnut.repeat.set(1 / 260, 1 / 260);
      const rimMat = new THREE.MeshStandardMaterial({
        color: '#c2926e',
        map: this.walnut,
        roughness: 0.36,
        transparent: true,
      });
      this.trayMats.push(feltMat, rimMat);
      this.materials.push(feltMat, rimMat);
    }
    const feltGeo = new THREE.ShapeGeometry(rr(w - rim * 1.2, h - rim * 1.2, r * 0.7), 6);
    this.felt = new THREE.Mesh(feltGeo, this.trayMats[0]);
    this.felt.receiveShadow = true;
    const outer = rr(w, h, r);
    outer.holes.push(rr(w - rim * 2, h - rim * 2, r * 0.6) as unknown as THREE.Path);
    const rimGeo = new THREE.ExtrudeGeometry(outer, {
      depth: rim * 0.9,
      bevelEnabled: true,
      bevelThickness: rim * 0.3,
      bevelSize: rim * 0.3,
      bevelOffset: -rim * 0.3,
      bevelSegments: 3,
      curveSegments: 6,
    });
    rimGeo.translate(0, 0, -rim * 0.3);
    this.rimMesh = new THREE.Mesh(rimGeo, this.trayMats[1]);
    this.rimMesh.castShadow = true;
    this.rimMesh.receiveShadow = true;
    this.tray.add(this.felt, this.rimMesh);
  }

  private faces(p: PlayerPalette): THREE.Texture[] {
    let f = this.faceCache.get(p.id);
    if (!f) {
      f = FACE_VALUES.map((v) => diceFaceTexture(v, p.base, p.ink));
      this.faceCache.set(p.id, f);
    }
    return f;
  }

  private slotX(side: -1 | 1, i: number): number {
    const s = this.size;
    return side * (0.72 * s + s / 2 + i * s * 1.28);
  }

  private applyDie(d: Die): void {
    const s = this.size * d.scale;
    d.mesh.visible = d.active && d.alpha > 0.005;
    d.mesh.position.set(d.pos.x, d.pos.y + d.lift, d.pos.z + this.size / 2);
    d.mesh.quaternion.copy(d.quat);
    if (d.tilt) {
      const tq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.tilt);
      d.mesh.quaternion.premultiply(tq);
    }
    d.mesh.scale.setScalar(s);
    const b = d.bright;
    for (const m of d.mats) {
      m.color.setRGB(b, b, b, THREE.SRGBColorSpace);
      m.opacity = d.alpha * this.opacity;
    }
    d.crackMat.opacity = d.crackA * this.opacity;
    d.rimMat.opacity = d.rimA * 0.9 * this.opacity;
    d.rim.visible = d.rimA > 0.01;
  }

  private setFade(v: number): void {
    this.opacity = v;
    for (const m of this.trayMats) m.opacity = v;
    for (const d of this.dice) this.applyDie(d);
    this.root.visible = v > 0.002;
  }

  show(): void {
    this.lingerUntil = 0;
    if (this.shown && this.opacity >= 1) return;
    this.shown = true;
    const ver = ++this.ver;
    const from = this.opacity;
    this.root.visible = true;
    this.anim.tween({
      ms: 120,
      unscaled: true,
      ease: ease.outQuad,
      update: (v) => {
        if (ver === this.ver) this.setFade(from + (1 - from) * v);
      },
    });
  }

  hide(ms = 200): void {
    this.lingerUntil = 0;
    if (!this.shown && this.opacity <= 0) return;
    this.shown = false;
    const ver = ++this.ver;
    const from = this.opacity;
    this.anim.tween({
      ms,
      unscaled: true,
      ease: ease.inQuad,
      update: (v) => {
        if (ver === this.ver) this.setFade(from * (1 - v));
      },
      done: () => {
        if (ver === this.ver) {
          this.setFade(0);
          for (const d of this.dice) d.active = false;
        }
      },
    });
  }

  /** Warm-up: show a static roll so shaders/textures are uploaded. */
  warm(p: PlayerPalette, q: PlayerPalette): void {
    this.prepare({ attack: [6, 5, 4], defend: [3, 2], attacker: p, defender: q, mode: 'static', reduced: false, run: null });
    this.opacity = 1;
    this.root.visible = true;
    for (const d of this.dice) this.applyDie(d);
  }

  resetWarm(): void {
    this.setFade(0);
    this.shown = false;
    for (const d of this.dice) d.active = false;
  }

  private prepare(spec: RollSpec): { atk: Die[]; def: Die[] } {
    const atk = this.dice.slice(0, 3);
    const def = this.dice.slice(3, 5);
    const setup = (list: Die[], vals: number[], pal: PlayerPalette, side: -1 | 1) => {
      const tex = this.faces(pal);
      list.forEach((d, i) => {
        d.active = i < vals.length;
        if (!d.active) {
          d.mesh.visible = false;
          return;
        }
        d.mats.forEach((m, k) => {
          if (m.map !== tex[k]) {
            m.map = tex[k];
            m.needsUpdate = true;
          }
        });
        d.side = side;
        d.finalQ.copy(faceQuat(vals[i]));
        d.quat.copy(d.finalQ);
        // The crack sits on whichever local face ends up facing the viewer.
        const inv = d.finalQ.clone().invert();
        d.crack.quaternion.copy(inv);
        d.crack.position.set(0, 0, 0.503).applyQuaternion(inv);
        // Seat the dice slightly below center: the tilt and die height lift them on screen.
        d.pos.set(this.slotX(side, i), -this.size * 0.2, 0);
        d.bright = 1;
        d.alpha = 1;
        d.lift = 0;
        d.tilt = 0;
        d.scale = 1;
        d.rimA = 0;
        d.crackA = 0;
      });
    };
    setup(atk, spec.attack, spec.attacker, -1);
    setup(def, spec.defend, spec.defender, 1);
    return { atk: atk.filter((d) => d.active), def: def.filter((d) => d.active) };
  }

  /** Play one roll. Always resolves. */
  async roll(spec: RollSpec): Promise<void> {
    this.show();
    const { atk, def } = this.prepare(spec);
    const all = [...atk, ...def];
    const run = spec.run;
    const s = this.size;
    const pairs = Math.min(atk.length, def.length);
    const upd = () => all.forEach((d) => this.applyDie(d));

    const verdict = async (full: boolean, ms: number) => {
      spec.onVerdict?.();
      const res: { d: Die; win: boolean | null }[] = [];
      for (let i = 0; i < atk.length; i++) {
        if (i >= pairs) {
          res.push({ d: atk[i], win: null });
          continue;
        }
        const aw = spec.attack[i] > spec.defend[i];
        res.push({ d: atk[i], win: aw });
        res.push({ d: def[i], win: !aw });
      }
      await this.anim.tween({
        ms,
        ease: ease.outCubic,
        run,
        update: (v) => {
          for (const r of res) {
            if (r.win === null) {
              r.d.bright = 1 - 0.3 * v;
              continue;
            }
            if (r.win) {
              if (full) {
                r.d.lift = 4 * v;
                r.d.rimA = v;
              }
            } else {
              r.d.bright = 1 - 0.45 * v;
              if (full) {
                r.d.tilt = r.d.side * -8 * (Math.PI / 180) * v;
                r.d.crackA = v;
              }
            }
          }
          upd();
        },
      });
    };

    // Static / instant: final faces, verdict applied at once.
    if (spec.mode === 'static' || this.anim.instant || (run && run.skipped)) {
      spec.onLand?.(-1, 0);
      await verdict(true, 0);
      upd();
      return;
    }

    if (spec.reduced) {
      // Fade in on the final faces, then pair and compare.
      all.forEach((d) => (d.alpha = 0));
      await this.anim.tween({
        ms: 150,
        ease: ease.outQuad,
        run,
        update: (v) => {
          all.forEach((d) => (d.alpha = v));
          upd();
        },
      });
      spec.onLand?.(-1, 0);
      await this.anim.wait(spec.mode === 'middle' ? 0 : 200, run);
      await verdict(spec.mode !== 'middle' && spec.mode !== 'first', spec.mode === 'middle' ? 80 : 300);
      return;
    }

    if (spec.mode === 'middle') {
      // Snap to the new faces with a small pop; one land per roll.
      const dur = spec.durMs ?? 300;
      const pop = Math.min(110, dur * 0.4);
      all.forEach((d, i) => {
        d.quat.copy(d.finalQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0.4, 0).normalize(), 0.5 * (i % 2 ? 1 : -1)));
      });
      const startQ = all.map((d) => d.quat.clone());
      await this.anim.tween({
        ms: pop,
        ease: ease.outCubic,
        run,
        update: (v) => {
          all.forEach((d, i) => {
            d.quat.slerpQuaternions(startQ[i], d.finalQ, v);
            d.lift = Math.sin(v * Math.PI) * s * 0.18;
            d.scale = 0.9 + 0.1 * v;
          });
          upd();
        },
      });
      spec.onLand?.(-1, 0);
      await verdict(false, Math.min(90, dur * 0.3));
      await this.anim.wait(Math.max(0, dur - pop - Math.min(90, dur * 0.3)), run);
      return;
    }

    // Timings (1×)
    const T =
      spec.mode === 'single'
        ? { shake: 150, tumble: 450, settle: 100, pair: 200, verdict: 300, full: true }
        : spec.mode === 'repeat'
          ? { shake: 0, tumble: 450, settle: 100, pair: 200, verdict: 300, full: true }
          : spec.mode === 'first'
            ? { shake: 80, tumble: 320, settle: 60, pair: 0, verdict: 240, full: false }
            : { shake: 0, tumble: 320, settle: 60, pair: 80, verdict: 240, full: true }; // final

    // Start positions: from outside each side, raised toward the viewer.
    const starts = all.map((d, i) =>
      new THREE.Vector3(d.pos.x + d.side * s * (1.5 + 0.25 * i), s * (0.25 - 0.18 * (i % 3)), s * 1.6),
    );
    const axes = all.map((_, i) =>
      new THREE.Vector3(Math.sin(i * 2.1 + 0.3), Math.cos(i * 1.7 + 0.9), Math.sin(i * 0.7 + 2.0)).normalize(),
    );
    const turns = all.map((_, i) => (2 + (i % 3) * 0.4) * Math.PI * 2);
    const finals = all.map((d) => d.pos.clone());

    if (T.shake > 0) {
      spec.onShake?.(this.anim.scale(T.shake));
      await this.anim.tween({
        ms: T.shake,
        ease: ease.linear,
        run,
        update: (v, raw) => {
          all.forEach((d, i) => {
            const j = Math.sin((raw * 9 + i * 0.37) * Math.PI * 2);
            d.pos.copy(starts[i]).add(new THREE.Vector3(j * s * 0.08, Math.cos(raw * 40 + i) * s * 0.05, 0));
            d.quat.setFromAxisAngle(axes[i], j * 0.35 + turns[i]).multiply(d.finalQ);
            d.alpha = Math.min(1, v * 3);
          });
          upd();
        },
      });
    } else {
      all.forEach((d, i) => {
        d.pos.copy(starts[i]);
        d.alpha = 1;
      });
    }

    // Tumble: arc in, 2–3 rotations easing out, 40 ms stagger; each die touches down at its end.
    const n = all.length;
    const stagger = 40;
    const each = Math.max(120, T.tumble - stagger * (n - 1));
    const landed = new Set<number>();
    await this.anim.tween({
      ms: T.tumble,
      ease: ease.linear,
      run,
      update: (_v, raw) => {
        const tms = raw * T.tumble;
        all.forEach((d, i) => {
          const u = Math.min(1, Math.max(0, (tms - i * stagger) / each));
          const e = ease.outCubic(u);
          d.pos.lerpVectors(starts[i], finals[i], e);
          d.pos.z = starts[i].z * (1 - ease.inQuad(u)) + Math.sin(u * Math.PI) * s * 0.35 * (1 - u);
          d.quat.setFromAxisAngle(axes[i], (1 - e) * turns[i]).multiply(d.finalQ);
          d.alpha = 1;
          if (u >= 1 && !landed.has(i)) {
            landed.add(i);
            d.pos.copy(finals[i]);
            spec.onLand?.(d.side, i);
          }
        });
        upd();
      },
    });
    all.forEach((d, i) => {
      if (!landed.has(i)) spec.onLand?.(d.side, i);
      d.pos.copy(finals[i]);
      d.quat.copy(d.finalQ);
    });
    // Settle: a micro-bounce.
    if (T.settle) {
      await this.anim.tween({
        ms: T.settle,
        ease: ease.linear,
        run,
        update: (v) => {
          all.forEach((d) => (d.pos.z = Math.sin(v * Math.PI) * s * 0.06));
          upd();
        },
      });
    }
    // Pair / align: the paired dice nudge toward each other; unpaired ones drift out.
    if (T.pair) {
      await this.anim.tween({
        ms: T.pair,
        ease: ease.inOutCubic,
        run,
        update: (v) => {
          all.forEach((d, i) => {
            const idx = d.side < 0 ? atk.indexOf(d) : def.indexOf(d);
            const paired = idx < pairs;
            d.pos.x = finals[i].x + (paired ? -d.side * s * 0.08 : d.side * s * 0.1) * v;
            d.pos.z = 0;
          });
          upd();
        },
      });
    }
    await verdict(T.full, T.verdict);
  }

  /** Linger bookkeeping: hide after `ms` of real time unless another roll starts. */
  linger(ms: number, now: number): void {
    this.lingerUntil = now + ms;
  }

  tick(now: number): void {
    if (this.lingerUntil && now >= this.lingerUntil) {
      this.lingerUntil = 0;
      this.hide(300);
    }
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const f of this.faceCache.values()) f.forEach((t) => t.dispose());
    this.feltTex.dispose();
    this.crackTex.dispose();
    this.walnut.dispose();
    this.felt?.geometry.dispose();
    this.rimMesh?.geometry.dispose();
    this.dice[0]?.mesh.geometry.dispose();
    this.dice[0]?.rim.geometry.dispose();
    this.dice[0]?.crack.geometry.dispose();
    void this.light;
  }
}
