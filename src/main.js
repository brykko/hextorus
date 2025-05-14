import * as THREE from 'three';
import { gridNodes, rotate2d, constrainedDelaunay, euclidean2torus, hexPhaseTile,
         F01_morph, F12_morph, F23_morph, gridCellPdf } from './torusUtils.js';

// --- Configuration --------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const STAGE_DURATION = 3000; // ms per morph stage
const LOOP_STAGES = ['fade', 'cylinder', 'twist', 'torus', 'twist', 'cylinder', 'fade'];
const FPS = 60;
const HEX_SIDE = 1 / Math.sqrt(3);
const NGRID = 50;
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

camera.position.set(0, 20, 0);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);

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
const Tf = euclidean2torus(Pfi);

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

// 4) Simulated grid-cell PDFs at faces and vertices
const gridPhases = [ [0,0.3], [0.9,0.35], [0.6,0.7] ]
  .map(([a,b]) => [ a * HEX_SIDE, b * HEX_SIDE ]);

const gridCellsRgbV = Pv.map((_, idx) => {
  const col = [0,0,0];
  gridPhases.forEach((ph, g) => {
    const Z = gridCellPdf(
      [Pv[idx][0]], [Pv[idx][1]], ph, 0.1
    );
    col[g] = Z[0][0];
  });
  return col;
});
const gridCellsRgbF = Pfi.map((_, idx) => {
  const col = [0,0,0];
  gridPhases.forEach((ph, g) => {
    const Z = gridCellPdf(
      [Pfi[idx][0]], [Pfi[idx][1]], ph, 0.1
    );
    col[g] = Z[0][0];
  });
  return col;
});

// --- Mesh & materials ------------------------------------------------
let mesh;
function createMorphMesh() {
  const geom = GvGeom.clone();
  const mat = new THREE.MeshPhongMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    wireframe: (wireframeMode !== 'off'),
    vertexColors: (wireframeMode==='data'),
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);
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
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
scene.add(new THREE.DirectionalLight(0xffffff, 0.4));

// --- UI Buttons -------------------------------------------------------
function makeButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.onclick = onClick;
  document.body.appendChild(btn);
}

// Wireframe controls
makeButton('WF Off',    () => { wireframeMode='off'; updateMaterial(); });
makeButton('WF Plain',  () => { wireframeMode='plain'; updateMaterial(); });
makeButton('WF Data',   () => { wireframeMode='data'; updateMaterial(); });
// Face controls
makeButton('FC Off',    () => { faceMode='off'; updateMaterial(); });
makeButton('FC Plain',  () => { faceMode='plain'; updateMaterial(); });
makeButton('FC Data',   () => { faceMode='data'; updateMaterial(); });
// Data controls
['torus1','torus2','torus3','gridCells'].forEach(dm =>
  makeButton(dm, () => { dataMode = dm; updateColors(); })
);

function updateMaterial() {
  mesh.material.wireframe = (wireframeMode !== 'off');
  // enable vertexColors if either wireframe or face data mode is active
  mesh.material.vertexColors = (wireframeMode === 'data' || faceMode === 'data');
  mesh.material.needsUpdate = true;
  updateColors();
}

function updateColors() {
  const geom = mesh.geometry;
  const N = geom.getAttribute('position').count;

  let colorsArray = null;
  // Determine which data array to use for coloring
  if (wireframeMode === 'data') {
    if (dataMode === 'gridCells') {
      colorsArray = gridCellsRgbV;
    }
    // TODO: add torus1/2/3 as needed
  } else if (faceMode === 'data') {
    if (dataMode === 'gridCells') {
      colorsArray = gridCellsRgbF;
    }
    // TODO: add torus1/2/3 as needed
  }

  if (colorsArray) {
    const colorAttr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const c = colorsArray[i];
      colorAttr[3 * i]     = c[0];
      colorAttr[3 * i + 1] = c[1];
      colorAttr[3 * i + 2] = c[2];
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    geom.attributes.color.needsUpdate = true;
    return;
  }

  // No data mapping: use plain-color rules
  mesh.material.vertexColors = false;
  if (wireframeMode === 'plain') {
    mesh.material.color.set(0xffffff);  // white edges
  } else if (faceMode === 'plain') {
    mesh.material.color.set(0x888888);  // gray faces
  }
}

// --- Animation loop --------------------------------------------------
let stageIndex = 0;
let stageStart = performance.now();
let reverse = false;

function animate() {
  const now = performance.now();
  const dt  = now - stageStart;
  const stage = LOOP_STAGES[stageIndex];
  const t = Math.min(dt / STAGE_DURATION, 1);

  if (stage==='fade') {
    // TODO: fade peripheral & zoom camera
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
    stageIndex = (stageIndex + 1) % LOOP_STAGES.length;
    stageStart = now;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Apply new morph output to mesh
function applyMorph(out) {
  const pos = mesh.geometry.getAttribute('position');
  for (let i = 0; i < out.length; i++) {
    const [x, y, z] = out[i];
    pos.setXYZ(i, x * SCALE, y * SCALE, z * SCALE);
  }
  pos.needsUpdate = true;
}
