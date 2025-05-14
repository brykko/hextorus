// src/main.js

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  F01_morph,
  F12_morph,
  F23_morph,
  gridNodes,
  rotate2d,
  euclidean2torus,
  simulateGridCells,
  constrainedDelaunay
} from './torusUtils.js';
import { GUI } from 'dat.gui';
import { gsap } from 'gsap';

// ---- MATLAB settings ----
const nGrid = 30;
const maxPhaseMag = 1 / Math.sqrt(3);
const sigma = 0.2;            // grid-cell std
const cameraPos = new THREE.Vector3(0, 10, 0);
const cameraTarget = new THREE.Vector3(0, 0, 0);
const upVec = new THREE.Vector3(0, 0, 1);
const viewAngleStart    = 75;
const viewAngleZoomEnd  = 50;
const viewAngleTorusEnd = 25;
const morphSteps        = 50;
const stepDuration      = 3;  // seconds per stage

// ---- Renderer & Scene ----
const container = document.getElementById('container');
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// ---- Camera & Controls ----
const camera = new THREE.PerspectiveCamera(
  viewAngleStart,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.copy(cameraPos);
camera.up.copy(upVec);
camera.lookAt(cameraTarget);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ---- Build Hex Grid Points ----
let Pv = gridNodes( Math.tan(Math.PI/6), 1 / nGrid );
Pv = Pv.map(([x, y]) => [
  x / nGrid * maxPhaseMag,
  y / nGrid * maxPhaseMag
]);
Pv = rotate2d(Pv, Math.PI / 6);

// ---- Toroidal Phases & Grid-Cell Data ----
const phases = euclidean2torus(Pv);
const t1 = phases.map(p => p[0]),
      t2 = phases.map(p => p[1]),
      t3 = phases.map(p => p[2]);

const gridCellPhases = [];  // fill in from MATLAB script
const gridCells       = simulateGridCells(Pv, gridCellPhases, sigma);

// ---- Triangulation via max-edge filter ----
const triangles = constrainedDelaunay(Pv, 1 / nGrid, 1e-6);

// ---- BufferGeometry & Morph Targets ----
const baseGeom = new THREE.BufferGeometry();
const N = Pv.length;

// flat positions
const posFlat = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  posFlat[3 * i]     = Pv[i][0];
  posFlat[3 * i + 1] = Pv[i][1];
  posFlat[3 * i + 2] = 0;
}
baseGeom.setAttribute('position', new THREE.BufferAttribute(posFlat, 3));

// helper to build morph target
function buildMorph(fn, params) {
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) arr.set([0, 0, 0], 3 * i);
  for (let j = 0; j < morphSteps; j++) {
    const p = j / (morphSteps - 1);
    const m = fn(t1, t2, p, ...params);
    for (let i = 0; i < N; i++) {
      arr[3 * i]     = m.x[i];
      arr[3 * i + 1] = m.y[i];
      arr[3 * i + 2] = m.z[i];
    }
  }
  return arr;
}

const morph0 = buildMorph(F01_morph, [2 * Math.PI]);
const morph1 = buildMorph(F12_morph, [2 * Math.PI]);
const morph2 = buildMorph(F23_morph, [3, 1]);

baseGeom.morphAttributes.position = [
  new THREE.Float32BufferAttribute(morph0, 3),
  new THREE.Float32BufferAttribute(morph1, 3),
  new THREE.Float32BufferAttribute(morph2, 3)
];

baseGeom.setIndex(triangles);
baseGeom.computeVertexNormals();

// ---- Color Attribute ----
const colorAttr = new Float32Array(N * 3);
baseGeom.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));

// ---- Mesh & Wireframe ----
const faceMat = new THREE.MeshPhongMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.6,
  side: THREE.DoubleSide
});
faceMat.morphTargets = true;
const mesh = new THREE.Mesh(baseGeom, faceMat);
scene.add(mesh);

const wireMat = new THREE.LineBasicMaterial({ vertexColors: true });
const wire = new THREE.LineSegments(
  new THREE.WireframeGeometry(baseGeom),
  wireMat
);
scene.add(wire);

// ---- GUI Controls ----
const gui = new GUI();
const params = {
  wireframe: 'off', // off, single, data
  faces:     'data',// off, single, data
  data:      't1'   // t1, t2, t3, gridCells
};

gui.add(params, 'wireframe', ['off', 'single', 'data'])
   .name('Wireframe')
   .onChange(updateVis);
gui.add(params, 'faces', ['off', 'single', 'data'])
   .name('Faces')
   .onChange(updateVis);
gui.add(params, 'data', ['t1','t2','t3','gridCells'])
   .name('Data')
   .onChange(v => { updateColors(); updateVis(); });

function updateColors() {
  const arrMap = { t1, t2, t3, gridCells };
  const arr    = arrMap[params.data];
  for (let i = 0; i < N; i++) {
    const v = params.data === 'gridCells'
            ? arr[i]
            : (arr[i] + Math.PI) / (2 * Math.PI);
    const c = new THREE.Color().setHSL(v, 1, 0.5);
    colorAttr[3 * i]     = c.r;
    colorAttr[3 * i + 1] = c.g;
    colorAttr[3 * i + 2] = c.b;
  }
  baseGeom.attributes.color.needsUpdate = true;
}

function updateVis() {
  wire.visible = params.wireframe !== 'off';
  wireMat.vertexColors = params.wireframe === 'data';
  if (params.wireframe === 'single') wireMat.color.set('#fff');
  mesh.visible = params.faces !== 'off';
  faceMat.vertexColors = params.faces === 'data';
  faceMat.transparent  = params.faces === 'data';
  if (params.faces === 'single') faceMat.color.set('#888');
}

updateColors();
updateVis();

// ---- Lighting ----
scene.add(new THREE.AmbientLight(0x404040));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// ---- Animation ----
mesh.morphTargetInfluences.fill(0);
const morph = { m0: 0, m1: 0, m2: 0 };
const tl    = gsap.timeline({ repeat: -1, yoyo: true });

// zoom
tl.to(camera, {
  fov: viewAngleZoomEnd,
  duration: stepDuration,
  onUpdate: () => camera.updateProjectionMatrix()
});
// F01
tl.to(morph, {
  m0: 1,
  duration: stepDuration,
  onUpdate: () => { mesh.morphTargetInfluences[0] = morph.m0; }
});
// F12
tl.to(morph, {
  m1: 1,
  duration: stepDuration,
  onUpdate: () => { mesh.morphTargetInfluences[1] = morph.m1; }
});
// F23
tl.to(morph, {
  m2: 1,
  duration: stepDuration,
  onUpdate: () => { mesh.morphTargetInfluences[2] = morph.m2; }
});
// final FOV
tl.to(camera, {
  fov: viewAngleTorusEnd,
  duration: stepDuration,
  onUpdate: () => camera.updateProjectionMatrix()
});

// ---- Render ----
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();