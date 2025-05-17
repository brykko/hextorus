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

// Cubic ease-in-out for smooth transitions
function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Get duration per stage (hold stages 2s, others use STAGE_DURATION)
function getStageDuration(stage) {
  return (stage === 'holdStart' || stage === 'holdEnd')
    ? 2000
    : STAGE_DURATION;
}

// --- Configuration --------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const STAGE_DURATION = 3000; // ms per morph stage
// Animation stages: pause at start, fade, morph steps, pause at end
const STAGES = ['holdStart', 'fade', 'cylinder', 'twist', 'torus', 'holdEnd'];
const FPS = 60;
const HEX_SIDE = 1 / Math.sqrt(3);
const NGRID = 15;
const SCALE = 2 * Math.PI;
const NTILE_RINGS = 3;
const NTILE_I = 50;

// Rendering & data modes (manipulated via buttons)
let dataMode      = 'torus1';   // 'torus1' | 'torus2' | 'torus3' | 'gridCells'

// --- Three.js setup --------------------------------------------------
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 1000);
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
// orbitControls.autoRotate = true;

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

// 2) Toroidal phases (unwrapped)
const Tv = euclidean2torus(Pv);  // [[t1,t2,t3],...]

// // 3) Edge interpolation for hex tile boundary
// const tileVerts = hexPhaseTile();
// tileVerts.push(tileVerts[0]);
// const TtileI = [];
// for (let s = 0; s < 6; s++) {
//   const p0 = tileVerts[s], p1 = tileVerts[s+1];
//   const pts = [];
//   for (let ii = 0; ii < NTILE_I; ii++) {
//     const t = ii / (NTILE_I - 1);
//     pts.push([ p0[0] * (1 - t) + p1[0] * t,
//                p0[1] * (1 - t) + p1[1] * t ]);
//   }
//   TtileI.push(pts);
// }

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
  console.log("posAttr:", posAttr)
  

  const faceMat = new THREE.MeshPhongMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,       // allow back faces to blend through
    opacity: 0.7,
    blending: THREE.NormalBlending,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  faceMesh = new THREE.Mesh(geom, faceMat);
  scene.add(faceMesh);

  // Wireframe mesh
  const wireGeom = new THREE.BufferGeometry();
  wireGeom.setAttribute('position', posAttr);
  wireGeom.setIndex(lineIndices);
  const wireMat = new THREE.LineBasicMaterial({
    transparent: true,
    depthWrite: true, 
    opacity: 0.05,
    vertexColors: false,
    color: 0xffffff,
    depthTest: false
  });
  wireMesh = new THREE.LineSegments(wireGeom, wireMat);
  wireMesh.renderOrder = 1;
  scene.add(wireMesh);
}
createMorphMesh();

// --- Prepare tile clones for fade stage ---
const tileGroups = [];
const tileCenters = gridNodes(NTILE_RINGS);

// Precompute boundary hexagon vertices (closed loop)
const boundaryHex = hexPhaseTile();
boundaryHex.push(boundaryHex[0]);
tileCenters.forEach(([cx, cy]) => {

  const cz = -1 / SCALE;
  // const cz = 0;

  const group = new THREE.Group();
  // Scale the entire tile to match morph coordinates
  group.scale.set(SCALE, SCALE, SCALE);
  // Face clone
  // Clone the original flat-hex geometry so it doesn’t morph
  const faceGeomClone = GvGeom.clone();
  // Initial color attribute copied from faceMesh
  const origColor = faceMesh.geometry.getAttribute('color');
  if (origColor) {
    faceGeomClone.setAttribute('color', origColor.clone());
  }
  // Clone material for independent fade
  const faceMatClone = faceMesh.material.clone();
  faceMatClone.transparent = true;
  faceMatClone.opacity = 1;
  const meshClone = new THREE.Mesh(faceGeomClone, faceMatClone);
  meshClone.material.vertexColors = true;
  meshClone.position.set(cx, cz, cy);
  group.add(meshClone);

  // Bold boundary lines
  const bVerts = [];
  boundaryHex.forEach(([x, y]) => {
    bVerts.push(x, 0, y);
  });
  const bGeom = new THREE.BufferGeometry();
  bGeom.setAttribute('position', new THREE.Float32BufferAttribute(bVerts, 3));
  const bMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    linewidth: 2
  });
  const bLine = new THREE.Line(bGeom, bMat);
  bLine.position.set(cx, cz, cy);
  group.add(bLine);

  scene.add(group);
  tileGroups.push(group);
});

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 3));

// --- GUI controls ---
const gui = new GUI();
const controls = {
  data: dataMode,
  restart: () => { stageIndex = 0; reverse=false; firstStep=true; stageStart = performance.now(); }
};
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

function updateMaterial() {
  // Always show both meshes
  faceMesh.visible = true;
  wireMesh.visible = true;

  // Face always data, wireframe always plain
  faceMesh.material.vertexColors = true;
  wireMesh.material.vertexColors = false;
  wireMesh.material.color.set(0xffffff);

  faceMesh.material.needsUpdate = true;
  wireMesh.material.needsUpdate = true;

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
    // apply to face geometry only
    geom.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    geom.attributes.color.needsUpdate = true;
    // Also update peripheral tile colors
    tileGroups.forEach(group => {
      const meshClone = group.children.find(c => c.type === 'Mesh');
      if (meshClone) {
        meshClone.geometry.setAttribute(
          'color',
          new THREE.BufferAttribute(colorAttr.slice(), 3)
        );
        meshClone.geometry.attributes.color.needsUpdate = true;
      }
    });
    return;
  }

  // No data mode → revert to plain coloring
  faceMesh.material.vertexColors = false;
  faceMesh.material.color.set(0x888888); // gray faces
}

// --- Animation loop --------------------------------------------------
let stageIndex = 0;
let stageStart = performance.now();
let reverse = false;
let firstStep = false;

function animate() {
  const now = performance.now();
  const dt  = now - stageStart;
  const stage = STAGES[stageIndex];
  const dur   = getStageDuration(stage);
  const rawT  = Math.min(dt / dur, 1);
  // Compute base fraction and apply easing
  const baseT = reverse ? 1 - rawT : rawT;
  const t     = easeInOutCubic(baseT);

  if (stage === 'holdStart') {
    // Initial pause: show all tile clones fully, hide morph
    faceMesh.visible = false;
    wireMesh.visible = false;
    tileGroups.forEach(group => {
      group.visible = true;
      group.children.forEach(child => {
        child.material.opacity = 1;
      });
    });
    camera.fov = 40;
    camera.updateProjectionMatrix();

  } else if (stage === 'fade') {
    // Hide morph meshes
    faceMesh.visible = false;
    wireMesh.visible = false;
    // Show and fade tile clones
    const fadeVal = reverse ? rawT : 1 - rawT;
    tileGroups.forEach((group, idx) => {
      // The first tile returned by gridNodes is the center
      const isCenter = (idx === 0);
      group.visible = true;
      group.children.forEach(child => {
        child.material.opacity = isCenter ? 1 : fadeVal;
      });
    });
    // Zoom camera: forward (wide→tight), reverse (tight→wide)
    camera.fov = THREE.MathUtils.lerp(40, 20, baseT);
    camera.updateProjectionMatrix();

  } else if (stage === 'cylinder') {
    // Hide the tiled meshes, show the central meshes
    if (firstStep) {
      tileGroups.forEach(group => group.visible = false);
      faceMesh.visible = true;
      wireMesh.visible = true;
    }
    const Tp = Tv.map(([t1, t2]) => [t1, t2]);
    const out = F01_morph(Tp, t);
    applyMorph(out);

  } else if (stage === 'twist') {
    const out = F12_morph(Tv.map(([t1, t2]) => [t1, t2]), t);
    applyMorph(out);

  } else if (stage === 'torus') {
    const out = F23_morph(Tv.map(([t1, t2]) => [t1, t2]), t);
    applyMorph(out);

  } else if (stage === 'holdEnd') {
    // Final pause: hold full torus
    if (firstStep) {
      faceMesh.visible = true;
      wireMesh.visible = true;
    }
    const out = F23_morph(Tv.map(([t1, t2]) => [t1, t2]), 1);
    applyMorph(out);
  }

  if (dt >= dur) {
    // advance or reverse through stages
    if (reverse) {
      stageIndex--;
      if (stageIndex < 0) {
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
    firstStep = true;
  } else {
    firstStep = false;
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
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  faceMesh.geometry.computeVertexNormals();
  // Because wireMesh shares the position buffer attribute, it is updated automatically.
}
