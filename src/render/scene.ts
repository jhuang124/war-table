// The table, the board slab and frame, the ocean chart, and the lamp.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BoardGeometry } from '../map/types';
import { oceanChartTexture, walnutTexture } from './textures';

export interface SceneParts {
  scene: THREE.Scene;
  ocean: THREE.Mesh;
  oceanUniforms: { uTime: { value: number } };
  key: THREE.SpotLight;
  envTexture: THREE.Texture;
  walnut: THREE.Texture;
  materials: THREE.Material[];
}

export const FRAME_W = 2.3;
export const FRAME_H = 0.75;

export function buildScene(renderer: THREE.WebGLRenderer, g: BoardGeometry): SceneParts {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0c0f13');
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
  const table = new THREE.Mesh(new THREE.PlaneGeometry(420, 300), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -1.7;
  table.receiveShadow = true;
  scene.add(table);

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
  scene.add(slab);

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
  scene.add(frame);
  const inlay = new THREE.Mesh(ring(W + 0.62, H + 0.62, W + 0.04, H + 0.04, FRAME_H + 0.02, 0.05), brassMat);
  inlay.position.y = -0.04;
  inlay.castShadow = true;
  inlay.receiveShadow = true;
  scene.add(inlay);
  const bead = new THREE.Mesh(
    ring(W + FRAME_W * 2 + 0.2, H + FRAME_W * 2 + 0.2, W + FRAME_W * 2 - 0.3, H + FRAME_W * 2 - 0.3, 0.3, 0.06),
    brassMat,
  );
  bead.position.y = FRAME_H - 0.34;
  scene.add(bead);

  // --- Ocean chart, with a very slow shimmer (≤ 2% lightness, period ≥ 6 s).
  const chart = oceanChartTexture(g, 4096);
  chart.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const oceanUniforms = { uTime: { value: 0 } };
  const oceanMat = new THREE.MeshStandardMaterial({ map: chart, roughness: 0.58, metalness: 0.0 });
  oceanMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = oceanUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vOceanP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvOceanP = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vOceanP;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float t = uTime * 6.2831853 / 9.0;
          float w = sin(vOceanP.x * 0.21 + t) * sin(vOceanP.y * 0.27 - t * 0.8 + 1.3)
                  + 0.6 * sin((vOceanP.x + vOceanP.y) * 0.13 + t * 0.6);
          diffuseColor.rgb *= 1.0 + 0.012 * w;
        }`,
      );
  };
  oceanMat.customProgramCacheKey = () => 'ocean-v1';
  materials.push(oceanMat);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(W, H), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.receiveShadow = true;
  scene.add(ocean);

  return { scene, ocean, oceanUniforms, key, envTexture, walnut, materials };
}
