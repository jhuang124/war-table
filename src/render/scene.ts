// The table, the board slab and frame, the ocean chart, and the lamp.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BoardGeometry } from '../map/types';
import { oceanChartTexture, walnutTexture } from './textures';

export interface SceneParts {
  scene: THREE.Scene;
  ocean: THREE.Mesh;
  oceanUniforms: { uTime: { value: number } };
  /** The open ocean beyond the chart (play view): it runs past every viewport edge. */
  outerOcean: THREE.Mesh;
  /** Table, slab, wooden frame and brass trim: shown only for the title / attract view. */
  furniture: THREE.Group;
  /**
   * 0 = play view (open ocean to every edge, no furniture), 1 = the table view (frame on the table).
   * In between: the ocean beyond the chart dissolves while the frame rises out of it.
   */
  setTableView(v: number): void;
  key: THREE.SpotLight;
  envTexture: THREE.Texture;
  walnut: THREE.Texture;
  materials: THREE.Material[];
}

export const FRAME_W = 2.3;
export const FRAME_H = 0.75;

/**
 * The ocean colour as a function of board position, shared by the chart's edge and the open ocean past it,
 * so the two meet without a seam: the chart's radial wash and vignette (textures.ts) continued outward,
 * clamped, plus the engraved graticule at the chart's spacing. sRGB math, converted at the end.
 */
function oceanGlsl(W: number, H: number): string {
  const f = (v: number) => v.toFixed(4);
  return `
  vec3 oc_srgb(vec3 c) { return pow(c, vec3(2.2)); }
  float oc_bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float oc_bayer4(vec2 a) { return oc_bayer2(0.5 * a) * 0.25 + oc_bayer2(a); }
  float oc_line(float c, float sp, float w, float off) {
    float d = abs(fract((c - off) / sp + 0.5) - 0.5) * sp;
    float fw = max(fwidth(c), 1e-4);
    return clamp((0.5 * max(w, fw) - d) / fw + 0.5, 0.0, 1.0) * min(1.0, w / fw);
  }
  // p = board coords (origin bottom-left, +y north)
  vec3 oceanAt(vec2 p) {
    float d = distance(p, vec2(${f(W * 0.5)}, ${f(H * 0.51)}));
    float t = clamp((d - ${f(H * 0.1)}) / ${f(W * 0.62 - H * 0.1)}, 0.0, 1.0);
    vec3 c0 = vec3(0.0824, 0.2706, 0.2941);
    vec3 c1 = vec3(0.0627, 0.2157, 0.2392);
    vec3 c2 = vec3(0.0392, 0.1490, 0.1725);
    vec3 c = t < 0.55 ? mix(c0, c1, t / 0.55) : mix(c1, c2, (t - 0.55) / 0.45);
    float vd = distance(p, vec2(${f(W * 0.5)}, ${f(H * 0.5)}));
    c *= 1.0 - 0.35 * clamp((vd - ${f(H * 0.45)}) / ${f(W * 0.6 - H * 0.45)}, 0.0, 1.0);
    // graticule: an engraved dark line and a faint light line beside it (textures.ts, 1 px = ${f(W / 4096)} u)
    float px = ${f(W / 4096)};
    float dark = max(oc_line(p.x, ${f(W / 18)}, 2.0 * px, 0.0), oc_line(p.y, ${f(H / 9)}, 2.0 * px, 0.0));
    float lite = max(oc_line(p.x, ${f(W / 18)}, 1.5 * px, 2.0 * px), oc_line(p.y, ${f(H / 9)}, 1.5 * px, -2.0 * px));
    c = mix(c, vec3(0.0, 0.039, 0.047), dark * 0.35);
    c = mix(c, vec3(0.745, 0.882, 0.843), lite * 0.07);
    return oc_srgb(c);
  }`;
}

export function buildScene(renderer: THREE.WebGLRenderer, g: BoardGeometry): SceneParts {
  const scene = new THREE.Scene();
  // Far ocean at the lamp's edge: the play view never shows a background.
  scene.background = new THREE.Color('#0a1a1d');
  const materials: THREE.Material[] = [];

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTexture;
  scene.environmentIntensity = 0.22;

  const W = g.width;
  const H = g.height;

  // --- Lamp: warm key spot with soft shadows, cool fill, hemisphere ambient.
  const key = new THREE.SpotLight('#ffd9a8', 2.6, 0, 0.62, 0.75, 0);
  key.position.set(-14, 62, 34);
  key.target.position.set(0, 0, 1);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 30;
  key.shadow.camera.far = 110;
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight('#9fc0e0', 0.42);
  fill.position.set(40, 30, -30);
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#ffe6c4', 0.25);
  rim.position.set(0, 20, 60);
  scene.add(rim);

  const hemi = new THREE.HemisphereLight('#c9d6e0', '#2a1c12', 0.55);
  scene.add(hemi);

  // --- Table: dark walnut, large, darker toward the edges (the lamp falloff does the vignette).
  const walnut = walnutTexture(512);
  walnut.repeat.set(5, 5);
  const tableMat = new THREE.MeshStandardMaterial({
    color: '#d9a883',
    map: walnut,
    roughness: 0.55,
    metalness: 0.0,
  });
  tableMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTableW;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float vr = length(vTableW.xz * vec2(0.0105, 0.016));
        gl_FragColor.rgb *= mix(1.0, 0.22, smoothstep(0.62, 1.75, vr));`,
      );
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTableW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTableW = (modelMatrix * vec4(transformed,1.0)).xyz;');
  };
  materials.push(tableMat);
  const furniture = new THREE.Group();
  furniture.visible = false;
  scene.add(furniture);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(420, 300), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -1.7;
  table.receiveShadow = true;
  furniture.add(table);

  // --- Slab: thick lacquered wood block under the chart.
  const slabWood = walnut.clone();
  slabWood.repeat.set(3, 0.4);
  slabWood.needsUpdate = true;
  const slabMat = new THREE.MeshStandardMaterial({ color: '#5a3d2c', map: slabWood, roughness: 0.45 });
  materials.push(slabMat);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W + FRAME_W * 2 + 0.6, 1.72, H + FRAME_W * 2 + 0.6), slabMat);
  slab.position.y = -0.86 - 0.02;
  slab.castShadow = true;
  slab.receiveShadow = true;
  furniture.add(slab);

  // --- Frame: wooden rim with a brass inlay and a brass outer bead.
  const frameMat = new THREE.MeshStandardMaterial({ color: '#6e4b35', map: walnut, roughness: 0.38, metalness: 0.0 });
  const brassMat = new THREE.MeshStandardMaterial({ color: '#c9a367', roughness: 0.3, metalness: 0.95, envMapIntensity: 1.6 });
  materials.push(frameMat, brassMat);
  const ring = (ow: number, oh: number, iw: number, ih: number, depth: number, bevel: number) => {
    const s = new THREE.Shape();
    s.moveTo(-ow / 2, -oh / 2);
    s.lineTo(ow / 2, -oh / 2);
    s.lineTo(ow / 2, oh / 2);
    s.lineTo(-ow / 2, oh / 2);
    s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-iw / 2, -ih / 2);
    hole.lineTo(-iw / 2, ih / 2);
    hole.lineTo(iw / 2, ih / 2);
    hole.lineTo(iw / 2, -ih / 2);
    hole.closePath();
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: 3,
      curveSegments: 1,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  };
  const frame = new THREE.Mesh(ring(W + FRAME_W * 2, H + FRAME_W * 2, W, H, FRAME_H - 0.12, 0.12), frameMat);
  frame.position.y = 0;
  frame.castShadow = true;
  frame.receiveShadow = true;
  furniture.add(frame);
  const inlay = new THREE.Mesh(ring(W + 0.62, H + 0.62, W + 0.04, H + 0.04, FRAME_H + 0.02, 0.05), brassMat);
  inlay.position.y = -0.04;
  inlay.castShadow = true;
  inlay.receiveShadow = true;
  furniture.add(inlay);
  const bead = new THREE.Mesh(
    ring(W + FRAME_W * 2 + 0.2, H + FRAME_W * 2 + 0.2, W + FRAME_W * 2 - 0.3, H + FRAME_W * 2 - 0.3, 0.3, 0.06),
    brassMat,
  );
  bead.position.y = FRAME_H - 0.34;
  furniture.add(bead);

  // --- Ocean chart, with a very slow shimmer (≤ 2% lightness, period ≥ 6 s).
  const chart = oceanChartTexture(g, 4096);
  chart.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const oceanUniforms = { uTime: { value: 0 } };
  const glsl = oceanGlsl(W, H);
  const oceanMat = new THREE.MeshStandardMaterial({ map: chart, roughness: 0.58, metalness: 0.0 });
  oceanMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = oceanUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vOceanP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvOceanP = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vOceanP;\n${glsl}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // The chart's last ~1.6 units hand over to the open-ocean colour, so the two meet without a seam.
          vec2 bp = vOceanP + vec2(${(W / 2).toFixed(4)}, ${(H / 2).toFixed(4)});
          float e = min(min(bp.x, ${W.toFixed(4)} - bp.x), min(bp.y, ${H.toFixed(4)} - bp.y));
          if (e < 1.6) diffuseColor.rgb = mix(oceanAt(bp), diffuseColor.rgb, smoothstep(0.0, 1.6, e));
        }
        {
          float t = uTime * 6.2831853 / 9.0;
          float w = sin(vOceanP.x * 0.21 + t) * sin(vOceanP.y * 0.27 - t * 0.8 + 1.3)
                  + 0.6 * sin((vOceanP.x + vOceanP.y) * 0.13 + t * 0.6);
          diffuseColor.rgb *= 1.0 + 0.012 * w;
        }`,
      );
  };
  oceanMat.customProgramCacheKey = () => 'ocean-v2';
  materials.push(oceanMat);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(W, H), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.receiveShadow = true;
  scene.add(ocean);

  // --- Open ocean past the chart: one big plane just under it, the same colour function, lit by the same
  // lamp (its falloff is the only vignette). A screen-door dissolve (uOuter) swaps it for the table.
  const outerUniforms = { uOuter: { value: 1 } };
  const outerMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, metalness: 0.0 });
  outerMat.onBeforeCompile = (sh) => {
    sh.uniforms.uOuter = outerUniforms.uOuter;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vOuterP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvOuterP = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uOuter;\nvarying vec2 vOuterP;\n${glsl}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          if (uOuter < 0.999) {
            if (oc_bayer4(gl_FragCoord.xy) + 0.03 > uOuter) discard;
          }
          vec2 bp = vOuterP + vec2(${(W / 2).toFixed(4)}, ${(H / 2).toFixed(4)});
          diffuseColor.rgb = oceanAt(bp);
        }`,
      );
  };
  outerMat.customProgramCacheKey = () => 'ocean-outer-v1';
  materials.push(outerMat);
  const outerOcean = new THREE.Mesh(new THREE.PlaneGeometry(W * 7, H * 9), outerMat);
  outerOcean.rotation.x = -Math.PI / 2;
  outerOcean.position.y = -0.012;
  // Nothing casts a shadow out there; drawn after the board, so the chart hides it by depth (no overdraw).
  outerOcean.receiveShadow = false;
  outerOcean.renderOrder = 1;
  scene.add(outerOcean);

  const setTableView = (v: number) => {
    const t = Math.min(1, Math.max(0, v));
    outerUniforms.uOuter.value = 1 - t;
    outerOcean.visible = t < 0.999;
    furniture.visible = t > 0.001;
    // The frame rises out of the ocean as the table comes up (and sinks under it on the way back).
    furniture.position.y = -2.4 * (1 - t) * (1 - t);
  };
  setTableView(0);

  return { scene, ocean, oceanUniforms, outerOcean, furniture, setTableView, key, envTexture, walnut, materials };
}
