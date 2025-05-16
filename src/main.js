import * as THREE from 'three';
import { GUI } from 'dat.gui';
import { EffectComposer, EffectPass, RenderPass, BloomEffect } from 'postprocessing';
import { KernelSize } from 'postprocessing';
import { gridNodes, rotate2d, constrainedDelaunay, euclidean2torus, hexPhaseTile,
         F01_morph, F12_morph, F23_morph, gridCellPdf } from './torusUtils.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Convert hue-saturation-value to RGB (all in [0,1])
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;
  switch (mod) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
  }
}

// --- Configuration --------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const STAGE_DURATION = 3000; // ms per morph stage
const STAGES = ['fade', 'cylinder', 'twist', 'torus'];
const FPS = 60;
const HEX_SIDE = 1 / Math.sqrt(3);
const NGRID = 15;
const SCALE = 2 * Math.PI;
const NTILE_RINGS = 2;
const NTILE_I = 50;

// Rendering & data modes (manipulated via buttons)
let wireframeMode = 'plain';    // 'off' | 'plain' | 'data'
let faceMode      = 'plain';    // 'off' | 'plain' | 'data'
let dataMode      = 'torus1';   // 'torus1' | 'torus2' | 'torus3' | 'gridCells'

// --- Three.js setup --------------------------------------------------
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(75, WIDTH / HEIGHT, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(WIDTH, HEIGHT);
document.body.appendChild(renderer.domElement);

// --- Postprocessing setup ---
// Clock for delta timing
const clock = new THREE.Clock();

// Composer and passes
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Bloom effect
const bloomEffect = new BloomEffect({
  intensity: 0,
  kernelSize: KernelSize.LARGE,
  luminanceThreshold: 0.5,
  luminanceSmoothness: 0.025
});
const bloomPass = new EffectPass(camera, bloomEffect);
bloomPass.renderToScreen = true;
composer.addPass(bloomPass);

camera.position.set(0, 30, 0);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);

// --- Orbit controls ---
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.1;

// --- Prepare geometry data -------------------------------------------
// 1) Flat hexagon grid
let Pv = gridNodes(NGRID + 1)
  .map(([x, y]) => [ x / (NGRID + 1) * HEX_SIDE,
                     y / (NGRID + 1) * HEX_SIDE ]);
Pv = rotate2d(Pv, Math.PI / 6);
const spacing = HEX_SIDE / (NGRID + 1);
const tri      = constrainedDelaunay(Pv, spacing);  // 1-based indices

// Vertex arrays for Three.js BufferGeometry
function buildBufferGeometry(vertices2D, faces) {
  const verts = [];
  for (const [x, y] of vertices2D) {
    verts.push(x, 0, y);
  }
  const indices = [];
  for (const [i, j, k] of faces) {
    indices.push(i-1, j-1, k-1);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Build vertex positions and face centroids
const GvGeom = buildBufferGeometry(Pv, tri);
// Face centroids for face-color data
const Pfi = tri.map(([i,j,k]) => [
  (Pv[i-1][0] + Pv[j-1][0] + Pv[k-1][0]) / 3,
  (Pv[i-1][1] + Pv[j-1][1] + Pv[k-1][1]) / 3
]);

// 2) Toroidal phases (unwrapped)
const Tv = euclidean2torus(Pv);  // [[t1,t2,t3],...]
// const Tf = euclidean2torus(Pfi); // No longer used: face-based torus phases

// 3) Edge interpolation for hex tile boundary
const tileVerts = hexPhaseTile();
tileVerts.push(tileVerts[0]);
const TtileI = [];
for (let s = 0; s < 6; s++) {
  const p0 = tileVerts[s], p1 = tileVerts[s+1];
  const pts = [];
  for (let ii = 0; ii < NTILE_I; ii++) {
    const t = ii / (NTILE_I - 1);
    pts.push([ p0[0] * (1 - t) + p1[0] * t,
               p0[1] * (1 - t) + p1[1] * t ]);
  }
  TtileI.push(pts);
}

// 4) Simulated grid-cell PDFs at vertices
const gridPhases = [
  [0, 0.3],
  [0.9, 0.35],
  [0.6, 0.7]
].map(([a, b]) => [a * HEX_SIDE, b * HEX_SIDE]);

// Compute normalized PDF values per vertex for each grid cell
const gridCellsRgbV = (() => {
  // Compute and normalize PDF for each phase across all Pv points
  const allNormPdfs = gridPhases.map(ph => {
    const Z = gridCellPdf(Pv, ph, 0.1);
    const maxZ = Math.max(...Z);
    return Z.map(v => v / maxZ);
  });
  // Build [r,g,b] per vertex
  return Pv.map((_, i) => [
    allNormPdfs[0][i],
    allNormPdfs[1][i],
    allNormPdfs[2][i]
  ]);
})();

// --- Mesh & materials ------------------------------------------------
let faceMesh, wireMesh;

// Precompute line indices for wireframe
const faceIdx = GvGeom.index.array;
const lineIndices = [];
for (let i = 0; i < faceIdx.length; i += 3) {
  const a = faceIdx[i], b = faceIdx[i+1], c = faceIdx[i+2];
  lineIndices.push(a, b, b, c, c, a);
}

function createMorphMesh() {
  const geom = GvGeom.clone();
  // share position buffer
  const posAttr = geom.getAttribute('position');

  // Face mesh

// … in createMorphMesh(), instead of MeshPhongMaterial:
const faceMat = new THREE.MeshPhysicalMaterial({
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  transparent: true,         // enable blending
  depthWrite: false,
  transmission: 0,         // 1 = fully “see-through” glass/plastic
  thickness: 10,          // the sheet will be rendered with this thickness/depth
  attenuationColor: new THREE.Color(0.9, 0.9, 0.9), 
  attenuationDistance: 0.01,  // how quickly light is absorbed (smaller = more opaque)
  roughness: 0.5,            // how glossy the surface is
  metalness: 0.2,            // plastic, not metal
  vertexColors: (faceMode === 'data')
});

  // const faceMat = new THREE.MeshPhongMaterial({
  //   side: THREE.DoubleSide,
  //   transparent: true,
  //   depthWrite: false,       // allow back faces to blend through
  //   opacity: 1.0,
  //   blending: THREE.AdditiveBlending,
  //   vertexColors: (faceMode === 'data'),
  //   polygonOffset: true,
  //   polygonOffsetFactor: 1,
  //   polygonOffsetUnits: 1
  // });
  faceMesh = new THREE.Mesh(geom, faceMat);
  scene.add(faceMesh);

  // Wireframe mesh
  const wireGeom = new THREE.BufferGeometry();
  wireGeom.setAttribute('position', posAttr);
  wireGeom.setIndex(lineIndices);
  const wireMat = new THREE.LineBasicMaterial({
    transparent: true,
    depthWrite: true, 
    opacity: 0.1,
    vertexColors: (wireframeMode === 'data'),
    color: 0xffffff,
    depthTest: false
  });
  wireMesh = new THREE.LineSegments(wireGeom, wireMat);
  wireMesh.renderOrder = 1;
  scene.add(wireMesh);
}
createMorphMesh();
// // DEBUG: show all raw gridNodes Pv points
// const debugPointsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05 });
// const debugGeom = new THREE.BufferGeometry();
// const rawPositions = new Float32Array(Pv.length * 3);
// Pv.forEach(([x, y], i) => {
//   rawPositions[3*i]   = x;
//   rawPositions[3*i+1] = 0;
//   rawPositions[3*i+2] = y;
// });
// debugGeom.setAttribute('position', new THREE.BufferAttribute(rawPositions, 3));
// const debugPoints = new THREE.Points(debugGeom, debugPointsMaterial);
// scene.add(debugPoints);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0));
// const light = new THREE.PointLight(0xffffff, 3);
// light.position.set(0, 10, 0);
// scene.add(light);
const dir = new THREE.DirectionalLight(0xffffff, 3);
dir.position.set(0, 1, 1); // N.B. this is the light's *direction* vector not actual position!
scene.add(dir);

// --- GUI controls ---
const gui = new GUI();
const controls = {
  wireframe: wireframeMode,
  faces: faceMode,
  data: dataMode,
  restart: () => { stageIndex = 0; stageStart = performance.now(); }
};
gui.add(controls, 'wireframe', ['off','plain','data'])
  .name('Wireframe').onChange(v => { wireframeMode = v; updateMaterial(); });
gui.add(controls, 'faces', ['off','plain','data'])
  .name('Faces').onChange(v => { faceMode = v; updateMaterial(); });
gui.add(controls, 'data', ['torus1','torus2','torus3','gridCells'])
  .name('Data').onChange(v => { dataMode = v; updateColors(); });

// gui.add(controls, 'restart').name('Restart');

// Bind top-left HTML Restart button (if present) to our restart action
// N.B. this button is created in index.html, not in main.js
document.querySelectorAll('button').forEach(btn => {
  if (btn.textContent.trim() === 'Restart') {
    btn.addEventListener('click', controls.restart);
  }
});


// function updateMaterial() {
//   faceMesh.visible = (faceMode !== 'off');
//   wireMesh.visible = (wireframeMode !== 'off');
//   faceMesh.material.vertexColors = (faceMode === 'data');
//   wireMesh.material.vertexColors = (wireframeMode === 'data');
//   faceMesh.material.needsUpdate = true;
//   wireMesh.material.needsUpdate = true;
//   updateColors();
// }

function updateMaterial() {
  // Show or hide each mesh
  faceMesh.visible = (faceMode !== 'off');
  wireMesh.visible = (wireframeMode !== 'off');

  // Switch between vertexColors and flat color
  faceMesh.material.vertexColors = (faceMode === 'data');
  wireMesh.material.vertexColors = (wireframeMode === 'data');

  // When faces are visible, make the wireframe semi-transparent
  if (faceMesh.visible) {
    wireMesh.material.transparent = true;
    // wireMesh.material.opacity     = 0.5;  // you can adjust this value
  } else {
    wireMesh.material.opacity     = 1.0;
    // (optional) wireMesh.material.transparent = false;
  }

  faceMesh.material.needsUpdate = true;
  wireMesh.material.needsUpdate = true;

  // Re-apply color buffer or flat colors
  updateColors();
}

function updateColors() {
  const geom = faceMesh.geometry;
  const N = geom.getAttribute('position').count;

  // Determine which vertex‐based data to use
  let colorsArray;
  if (dataMode === 'gridCells') {
    // RGB from three normalized grid‐cell PDFs
    colorsArray = gridCellsRgbV;
  } else if (dataMode.startsWith('torus')) {
    // HSV→RGB mapping of torus phase channel
    const channel = parseInt(dataMode.slice(-1), 10) - 1; // 0,1,2
    colorsArray = Tv.map(phases => {
      // wrap phase to [0,2π), normalize to [0,1]
      const h = ((((phases[channel] % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI)) / (2*Math.PI));
      return hsv2rgb(h, 1, 1);
    });
  } else {
    // no data mapping selected
    colorsArray = null;
  }

  if (colorsArray) {
    // build a flat Float32 array [r,g,b,...] for all N vertices
    const colorAttr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const c = colorsArray[i];
      colorAttr[3*i    ] = c[0];
      colorAttr[3*i + 1] = c[1];
      colorAttr[3*i + 2] = c[2];
    }
    // apply to both face and wire geometries
    faceMesh.geometry.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    wireMesh.geometry.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    faceMesh.geometry.attributes.color.needsUpdate = true;
    wireMesh.geometry.attributes.color.needsUpdate = true;
    return;
  }

  // No data mode → revert to plain coloring
  faceMesh.material.vertexColors = false;
  wireMesh.material.vertexColors = false;

  if (wireframeMode === 'plain') {
    wireMesh.material.color.set(0xffffff); // white wire
  }
  if (faceMode === 'plain') {
    faceMesh.material.color.set(0x888888); // gray faces
  }
}

// --- Animation loop --------------------------------------------------
let stageIndex = 0;
let stageStart = performance.now();
let reverse = false;

function animate() {
  const now = performance.now();
  const dt  = now - stageStart;
  const stage = STAGES[stageIndex];
  // const t = Math.min(dt / STAGE_DURATION, 1);
  const rawT = Math.min(dt / STAGE_DURATION, 1);
  // Reverse the morph fraction within each stage if reversing
  const t = reverse ? 1 - rawT : rawT;

  if (stage==='fade') {
    // Fade stage: ensure mesh is at flat-sheet state
    const Tp = Tv.map(([t1, t2]) => [t1, t2]);
    const out = F01_morph(Tp, 0);  // p=0 gives flat sheet
    applyMorph(out);
    // (Optional) adjust camera FOV or other fade effects here
  } else if (stage==='cylinder') {
    const Tp = Tv.map(([t1,t2]) => [t1, t2]);
    const out = F01_morph(Tp, t);
    applyMorph(out);
  } else if (stage==='twist') {
    const out = F12_morph(Tv.map(([t1,t2])=>[t1,t2]), t);
    applyMorph(out);
  } else if (stage==='torus') {
    const out = F23_morph(Tv.map(([t1,t2])=>[t1,t2]), t);
    applyMorph(out);
  }

  if (dt >= STAGE_DURATION) {
    // advance or reverse through stages
    if (reverse) {
      stageIndex--;
      if (stageIndex <= 0) {
        stageIndex = 0;
        reverse = false;
      }
    } else {
      stageIndex++;
      if (stageIndex > STAGES.length - 1) {
        stageIndex = STAGES.length - 1;
        reverse = true;
      }
    }
    stageStart = now;
  }

  orbitControls.update();

  const delta = clock.getDelta();
  composer.render(delta);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Apply new morph output to mesh
function applyMorph(out) {
  // (the faceMesh and wireframe objects hold references to the same 'geometry' object)
  const pos = faceMesh.geometry.getAttribute('position');
  for (let i = 0; i < out.length; i++) {
    const [x, y, z] = out[i];
    pos.setXYZ(i, x * SCALE, y * SCALE, z * SCALE);
  }
  pos.needsUpdate = true;
  faceMesh.geometry.computeVertexNormals();
  // Because wireMesh shares the position buffer attribute, it is updated automatically.
}
