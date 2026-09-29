// The battle tray (docs/INK.md B §4 "Attack 2 · dice land"): a slim, translucent indigo lacquer tray that
// rises out of the southern ocean just above the bottom strip, drawn in its own pass (depth cleared, after
// the board) with a pixel-mapped camera, so it sits at a fixed CSS-px spot in the battle band. The paper shows
// through its floor; its rim is a thin matte lacquer edge with one ivory hairline. Matte dice in the seats'
// wash colours with ivory pips, keyframed (no physics) onto the engine's faces:
//   shake → tumble → settle → 250 ms of stillness → the verdict: each compared pair is joined by an
//   ivory hairline, drawn from the winner; the loser dims to half under a splash of ink.
// (The hairline is ivory, not gold: while a fight is on, the gold stroke on the board is the one gold.)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Animator, ease, type Run } from './anim';
import { inkDiceFaceTexture, inkSplashTexture } from './textures';
import { IVORY } from './util';
import type { PlayerPalette } from '../shared/palette';
import { boardTrayGeometry, inkTrayGeometry, inkTrayTop, INK_TRAY_MID_GAP, INK_TRAY_PAD, INK_TRAY_STEP } from '../shared/tray';
// The HUD's tray band (src/shared/tray.ts) is re-exported here; the tray actually drawn is the slimmer
// `inkTrayGeometry`, placed by `inkTrayTop` (shared with the HUD, so the fight header sits on its rim).
export { boardTrayGeometry, inkTrayGeometry };

/** Die spacing (in die edges): the gap between the two sides' inner dice, and die to die within a side. */
const MID_GAP = INK_TRAY_MID_GAP;
const STEP = INK_TRAY_STEP;
/** Padding from the outermost die to the tray's inner rim, in die edges. */
const PAD = INK_TRAY_PAD;

// BoxGeometry material groups: +x, −x, +y, −y, +z, −z. +z faces the viewer (felt normal).
const FACE_VALUES = [3, 4, 2, 5, 1, 6];
const TILT = -0.42; // tray pitch (top edge recedes)
/** The verdict's held stillness (B §4): after the dice settle, nothing moves, then the verdict. */
export const VERDICT_SILENCE_MS = 250;
/** How far the tray rises from (CSS px) as it appears. */
const RISE_PX = 26;

const HAIR_VERT = /* glsl */ `
attribute float aU;
varying float vU;
void main() {
  vU = aU;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const HAIR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
uniform float uOpacity;
uniform float uFromEnd;
varying float vU;
void main() {
  float u = uFromEnd > 0.5 ? 1.0 - vU : vU;
  float a = 1.0 - smoothstep(uProgress - 0.04, uProgress, u);
  a *= uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

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
  splash: THREE.Mesh;
  splashMat: THREE.MeshBasicMaterial;
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
  splashA: number;
}

export interface RollSpec {
  attack: number[];
  defend: number[];
  attacker: PlayerPalette;
  defender: PlayerPalette;
  /**
   * 'single' 1.11 s · 'repeat' 0.99 s (both with the 250 ms silence) · 'first' 660 ms · 'middle' (durMs) ·
   * 'final' 850 ms (keeps the silence) · 'static'
   */
  mode: 'single' | 'repeat' | 'first' | 'middle' | 'final' | 'static';
  durMs?: number;
  reduced: boolean;
  run: Run | null;
  onShake?: (ms: number) => void;
  /** First touch of die i (side −1 attacker / +1 defender); compressed rolls call it once. */
  onLand?: (side: -1 | 1, i: number) => void;
  /** The held breath begins (ms at 1×): the caller hushes the sound for it (INK B4 "silence"). */
  onSilence?: (ms: number) => void;
  onVerdict?: () => void;
}



export class DiceTray {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(20, 1, 10, 20000);
  private root = new THREE.Group();
  private tray = new THREE.Group();
  private dice: Die[] = [];
  private faceCache = new Map<string, THREE.Texture[]>();
  private floor: THREE.Mesh | null = null;
  private rimMesh: THREE.Mesh | null = null;
  private hairMesh: THREE.Mesh | null = null;
  private trayMats: THREE.Material[] = [];
  private splashTex = inkSplashTexture();
  private hairs: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private opacity = 0;
  /** 0 = sunk (below its spot, as it rises / sinks), 1 = in place. */
  private rise = 0;
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
    walnut?: THREE.Texture,
  ) {
    void walnut;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.12;
    // A soft, low key from the top left: the dice are lit about as the washes are (matte bone and pigment,
    // not bright plastic), the rim takes one soft highlight.
    const key = new THREE.DirectionalLight('#e8e4dc', 0.95);
    key.position.set(-300, 480, 900);
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
    key.shadow.radius = 5;
    this.light = key;
    const fill = new THREE.DirectionalLight('#9fb2d6', 0.2);
    fill.position.set(400, -100, 600);
    const hemi = new THREE.HemisphereLight('#c9d0de', '#0b1224', 0.34);
    this.root.add(key, key.target, fill, hemi);
    this.scene.add(this.root);
    this.root.add(this.tray);
    this.tray.rotation.x = TILT;

    const geo = new RoundedBoxGeometry(1, 1, 1, 4, 0.12);
    const splashGeo = new THREE.PlaneGeometry(0.9, 0.9);
    for (let i = 0; i < 5; i++) {
      const mats = FACE_VALUES.map(() => new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0.0, transparent: true, envMapIntensity: 0.04 }));
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      const rimMat = new THREE.MeshBasicMaterial({ color: IVORY, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const rim = new THREE.Mesh(new THREE.BufferGeometry(), rimMat);
      rim.visible = false;
      const splashMat = new THREE.MeshBasicMaterial({ map: this.splashTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const splash = new THREE.Mesh(splashGeo, splashMat);
      splash.position.z = 0.504;
      mesh.add(splash);
      mesh.visible = false;
      this.tray.add(mesh);
      this.materials.push(...mats, rimMat, splashMat);
      this.dice.push({
        mesh,
        mats,
        rim,
        rimMat,
        splash,
        splashMat,
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
        splashA: 0,
      });
    }
    // the verdict's hairlines (one per compared pair)
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(IVORY) },
          uProgress: { value: 0 },
          uOpacity: { value: 0 },
          uFromEnd: { value: 0 },
        },
        vertexShader: HAIR_VERT,
        fragmentShader: HAIR_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.tray.add(mesh);
      this.hairs.push({ mesh, mat });
      this.materials.push(mat);
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
    const { trayW, die: s, trayH } = inkTrayGeometry(W, H, bandH, uiScale);
    const changed = Math.abs(trayW - this.trayW) > 0.5 || Math.abs(trayH - this.trayH) > 0.5 || Math.abs(s - this.size) > 0.5;
    this.size = s;
    this.trayW = trayW;
    this.trayH = trayH;
    this.cx = W / 2;
    // Placed by the shared rule (the HUD's header sits just above this top), so the header rests on the rim.
    this.cy = bandTop + bandH - inkTrayTop(W, H, bandH, uiScale) + trayH / 2;
    const fov = 20;
    this.camera.fov = fov;
    this.camera.aspect = W / H;
    const D = H / 2 / Math.tan((fov * Math.PI) / 360);
    this.camera.near = D * 0.2;
    this.camera.far = D * 3;
    this.camera.position.set(0, 0, D);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.place();
    if (changed || !this.floor) this.buildTray();
    for (const d of this.dice) if (d.active) this.applyDie(d);
  }

  /** Tray centre in world = pixel-mapped at z = 0, sunk by the rise. */
  private place(): void {
    const sink = (1 - this.rise) * RISE_PX;
    this.root.position.set(this.cx - this.W / 2, this.H / 2 - this.cy - sink, 0);
  }

  private buildTray(): void {
    if (this.floor) {
      this.tray.remove(this.floor, this.rimMesh!, this.hairMesh!);
      this.floor.geometry.dispose();
      this.rimMesh!.geometry.dispose();
      this.hairMesh!.geometry.dispose();
    }
    const w = this.trayW;
    const h = this.trayH / Math.cos(TILT);
    // A thin lacquer tray, not a slab: a narrow, low rim and softly rounded corners.
    const rim = Math.max(3, this.size * 0.085);
    const r = Math.min(h * 0.28, 16);
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
      // Floor: a pale veil of the deep paper colour (Lambert, so the dice still cast soft shadows on it);
      // the ocean's paper and fibres show through, so the tray reads as part of the painting.
      // Its mean luminance sits within ~15 % of the open ocean's (a pale wash band, not a dark slab).
      const floorMat = new THREE.MeshLambertMaterial({ color: '#223052', transparent: true, depthWrite: false });
      floorMat.userData.base = 0.5;
      // Rim: matte indigo lacquer (one soft highlight at most), and a single ivory hairline on its top.
      const rimMat = new THREE.MeshStandardMaterial({ color: '#1c2745', roughness: 0.62, metalness: 0, envMapIntensity: 0.08, transparent: true });
      rimMat.userData.base = 0.9;
      const hairMat = new THREE.MeshBasicMaterial({ color: IVORY, transparent: true, depthWrite: false, toneMapped: false });
      hairMat.userData.base = 0.4;
      this.trayMats.push(floorMat, rimMat, hairMat);
      this.materials.push(floorMat, rimMat, hairMat);
    }
    const floorGeo = new THREE.ShapeGeometry(rr(w - rim, h - rim, Math.max(2, r - rim * 0.5)), 8);
    this.floor = new THREE.Mesh(floorGeo, this.trayMats[0]);
    this.floor.receiveShadow = true;
    const outer = rr(w, h, r);
    outer.holes.push(rr(w - rim * 2, h - rim * 2, Math.max(2, r - rim)) as unknown as THREE.Path);
    const depth = rim * 0.9;
    const rimGeo = new THREE.ExtrudeGeometry(outer, {
      depth,
      bevelEnabled: true,
      bevelThickness: rim * 0.22,
      bevelSize: rim * 0.22,
      bevelOffset: -rim * 0.22,
      bevelSegments: 2,
      curveSegments: 10,
    });
    this.rimMesh = new THREE.Mesh(rimGeo, this.trayMats[1]);
    this.rimMesh.receiveShadow = true;
    // the hairline: ~1.2 px of ivory along the middle of the rim's top
    const hw = 0.6;
    const ring = rr(w - rim + hw * 2, h - rim + hw * 2, Math.max(2, r - rim * 0.5 + hw));
    ring.holes.push(rr(w - rim - hw * 2, h - rim - hw * 2, Math.max(2, r - rim * 0.5 - hw)) as unknown as THREE.Path);
    this.hairMesh = new THREE.Mesh(new THREE.ShapeGeometry(ring, 10), this.trayMats[2]);
    this.hairMesh.position.z = depth + rim * 0.22 + 0.2;
    this.hairMesh.renderOrder = 2;
    this.tray.add(this.floor, this.rimMesh, this.hairMesh);
  }

  private faces(p: PlayerPalette): THREE.Texture[] {
    let f = this.faceCache.get(p.id);
    if (!f) {
      f = FACE_VALUES.map((v) => inkDiceFaceTexture(v, p.base, p.ink));
      this.faceCache.set(p.id, f);
    }
    return f;
  }

  private slotX(side: -1 | 1, i: number): number {
    const s = this.size;
    return side * (MID_GAP * s + s / 2 + i * s * STEP);
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
    d.splashMat.opacity = d.splashA * 0.6 * this.opacity;
    d.splash.visible = d.splashA > 0.01;
  }

  private setFade(v: number): void {
    this.opacity = v;
    for (const m of this.trayMats) m.opacity = v * ((m.userData.base as number | undefined) ?? 1);
    for (const d of this.dice) this.applyDie(d);
    for (const h of this.hairs) h.mat.uniforms.uOpacity.value = Math.min(h.mat.uniforms.uOpacity.value, v * 0.8);
    this.root.visible = v > 0.002;
  }

  /** The tray rises out of the sea into its spot (220 ms), fading in as it comes. */
  show(): void {
    this.lingerUntil = 0;
    if (this.shown && this.opacity >= 1) return;
    this.shown = true;
    const ver = ++this.ver;
    const from = this.opacity;
    const r0 = this.rise;
    this.root.visible = true;
    if (this.anim.instant) {
      this.rise = 1;
      this.place();
      this.setFade(1);
      return;
    }
    this.anim.tween({
      ms: 220,
      unscaled: true,
      ease: ease.outCubic,
      update: (v) => {
        if (ver !== this.ver) return;
        this.rise = r0 + (1 - r0) * v;
        this.place();
        this.setFade(from + (1 - from) * Math.min(1, v * 1.6));
      },
    });
  }

  /** It sinks back into the sea as it fades. */
  hide(ms = 200): void {
    this.lingerUntil = 0;
    if (!this.shown && this.opacity <= 0) return;
    this.shown = false;
    const ver = ++this.ver;
    const from = this.opacity;
    const r0 = this.rise;
    this.anim.tween({
      ms,
      unscaled: true,
      ease: ease.inQuad,
      update: (v) => {
        if (ver !== this.ver) return;
        this.rise = r0 * (1 - 0.5 * v);
        this.place();
        this.setFade(from * (1 - v));
      },
      done: () => {
        if (ver === this.ver) {
          this.setFade(0);
          this.rise = 0;
          this.place();
          for (const d of this.dice) d.active = false;
          for (const h of this.hairs) h.mesh.visible = false;
        }
      },
    });
  }

  /** Warm-up: show a static roll so shaders/textures are uploaded. */
  warm(p: PlayerPalette, q: PlayerPalette): void {
    this.prepare({ attack: [6, 5, 4], defend: [3, 2], attacker: p, defender: q, mode: 'static', reduced: false, run: null });
    this.opacity = 1;
    this.rise = 1;
    this.place();
    this.root.visible = true;
    for (const d of this.dice) this.applyDie(d);
    for (let i = 0; i < 2; i++) this.layHair(i, this.dice[i], this.dice[3 + i], true);
  }

  resetWarm(): void {
    this.setFade(0);
    this.shown = false;
    this.rise = 0;
    this.place();
    for (const d of this.dice) d.active = false;
    for (const h of this.hairs) h.mesh.visible = false;
  }

  /**
   * Lay pair `i`'s hairline: an arc over the dice from one to the other (tray-local, on the floor plane),
   * drawn from the winner. Pairs nest: the outer pairs arc higher.
   */
  private layHair(i: number, a: Die, b: Die, aWins: boolean): void {
    const h = this.hairs[i];
    const s = this.size;
    const x0 = a.pos.x;
    const x1 = b.pos.x;
    const y0 = a.pos.y + s * 0.62;
    const apex = a.pos.y + s * (0.86 + 0.2 * i);
    const N = 40;
    const w = Math.max(1.1, s * 0.022);
    const pos: number[] = [];
    const us: number[] = [];
    const idx: number[] = [];
    const pt = (t: number): [number, number] => {
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (apex - y0) * Math.sin(t * Math.PI);
      return [x, y];
    };
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const [x, y] = pt(t);
      const [xa, ya] = pt(Math.max(0, t - 0.01));
      const [xb, yb] = pt(Math.min(1, t + 0.01));
      let nx = -(yb - ya);
      let ny = xb - xa;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      // a brush hairline: a hair thicker in the middle
      const ww = w * (0.7 + 0.3 * Math.sin(t * Math.PI));
      pos.push(x + nx * ww, y + ny * ww, s * 0.02, x - nx * ww, y - ny * ww, s * 0.02);
      us.push(t, t);
      if (k < N) {
        const o = k * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    h.mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
    g.setIndex(idx);
    h.mesh.geometry = g;
    h.mat.uniforms.uFromEnd.value = aWins ? 0 : 1;
    h.mat.uniforms.uProgress.value = 1.05;
    h.mat.uniforms.uOpacity.value = 0.8;
    h.mesh.visible = true;
  }

  private prepare(spec: RollSpec): { atk: Die[]; def: Die[] } {
    const atk = this.dice.slice(0, 3);
    const def = this.dice.slice(3, 5);
    for (const h of this.hairs) {
      h.mesh.visible = false;
      h.mat.uniforms.uOpacity.value = 0;
    }
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
        // The ink splash sits on whichever local face ends up facing the viewer, turned its own way.
        const inv = d.finalQ.clone().invert();
        d.splash.quaternion.copy(inv).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (vals[i] * 1.7 + i) % 6.28));
        d.splash.position.set(0, 0, 0.504).applyQuaternion(inv);
        // Seat the dice slightly below center: the tilt and die height lift them on screen.
        d.pos.set(this.slotX(side, i), -this.size * 0.2, 0);
        d.bright = 1;
        d.alpha = 1;
        d.lift = 0;
        d.tilt = 0;
        d.scale = 1;
        d.rimA = 0;
        d.splashA = 0;
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

    /** The verdict: hairlines join the pairs (from the winner), losers dim to half under an ink splash. */
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
        if (full) this.layHair(i, atk[i], def[i], aw);
      }
      const hair = this.hairs.slice(0, full ? pairs : 0);
      for (const h of hair) h.mat.uniforms.uProgress.value = 0;
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
              if (full) r.d.lift = 3 * v;
            } else {
              r.d.bright = 1 - 0.5 * v;
              r.d.splashA = full ? Math.min(1, v * 1.6) : 0.6 * v;
            }
          }
          for (const h of hair) h.mat.uniforms.uProgress.value = Math.min(1.05, v * 1.3);
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
      // Fade in on the final faces, hold, then pair and compare.
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
      if (spec.mode !== 'middle' && spec.mode !== 'first') spec.onSilence?.(this.anim.scale(VERDICT_SILENCE_MS));
      await this.anim.wait(spec.mode === 'middle' ? 0 : spec.mode === 'first' ? 150 : VERDICT_SILENCE_MS + 100, run);
      await verdict(spec.mode !== 'middle' && spec.mode !== 'first', spec.mode === 'middle' ? 80 : 260);
      return;
    }

    if (spec.mode === 'middle') {
      // Snap to the new faces with a small drop; one land per roll; no silence (the blitz cap rules).
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
      // The losers dim while the next roll is already coming: the verdict isn't awaited (one frame-
      // quantised await per middle roll keeps a long blitz inside its cap).
      const vms = Math.min(90, dur * 0.3);
      void verdict(false, vms);
      const rest = dur - pop;
      if (rest > 20) await this.anim.wait(rest, run);
      return;
    }

    // Timings (1×). Single roll 120 + 380 + 100 + 250 + 260 = 1110 ms (≤ 1.25 s with the silence).
    const T =
      spec.mode === 'single'
        ? { shake: 120, tumble: 380, settle: 100, silence: VERDICT_SILENCE_MS, verdict: 260, full: true }
        : spec.mode === 'repeat'
          ? { shake: 0, tumble: 380, settle: 100, silence: VERDICT_SILENCE_MS, verdict: 260, full: true }
          : spec.mode === 'first'
            ? { shake: 80, tumble: 320, settle: 60, silence: 0, verdict: 200, full: false }
            : { shake: 0, tumble: 320, settle: 60, silence: VERDICT_SILENCE_MS, verdict: 220, full: true }; // final

    // Start positions: from outside each side, raised toward the viewer (shaken in a cup, off the tray).
    const starts = all.map((d, i) => new THREE.Vector3(d.pos.x + d.side * s * (1.5 + 0.25 * i), s * (0.25 - 0.18 * (i % 3)), s * 1.6));
    const axes = all.map((_, i) => new THREE.Vector3(Math.sin(i * 2.1 + 0.3), Math.cos(i * 1.7 + 0.9), Math.sin(i * 0.7 + 2.0)).normalize());
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
          all.forEach((d) => (d.pos.z = Math.sin(v * Math.PI) * s * 0.05));
          upd();
        },
      });
      all.forEach((d) => (d.pos.z = 0));
      upd();
    }
    // The held breath: nothing moves, nothing sounds.
    if (T.silence) {
      spec.onSilence?.(this.anim.scale(T.silence));
      await this.anim.wait(T.silence, run);
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
    this.splashTex.dispose();
    this.floor?.geometry.dispose();
    this.rimMesh?.geometry.dispose();
    this.hairMesh?.geometry.dispose();
    this.dice[0]?.mesh.geometry.dispose();
    this.dice[0]?.splash.geometry.dispose();
    for (const h of this.hairs) h.mesh.geometry.dispose();
    void this.light;
  }
}
