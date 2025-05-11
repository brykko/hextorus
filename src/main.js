// main.js
// Three.js + GSAP animation of hex→cylinder→twist→torus

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { F01_morph, F12_morph, F23_morph, gridNodes, rotate2d, euclidean2torus, simulateGridCells, constrainedDelaunay } from './torusUtils.js';
import {GUI} from 'dat.gui';
import {gsap} from 'gsap';

// ---- View settings ----
const nGrid = 30;
const maxPhaseMag = 1/Math.sqrt(3);
const upVec = new THREE.Vector3(0,0,1);
const cameraPos = new THREE.Vector3(0,10,0);
const cameraTarget = new THREE.Vector3(0,0,0);
const viewAngleStart = 75;
const viewAngleZoomEnd = 50;
const viewAngleTorusEnd = 25;
const zoomSteps = 10;
const morphSteps = 50;
const stepDuration = 3; // seconds per stage

// ---- Scene setup ----
const container = document.getElementById('container');
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(viewAngleStart, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.copy(cameraPos);
camera.up.copy(upVec);
camera.lookAt(cameraTarget);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ---- Generate hex grid points ----
let Pv = gridNodes(nGrid+1, 1);
Pv = Pv.map(([x,y]) => [x/(nGrid+1)*maxPhaseMag, y/(nGrid+1)*maxPhaseMag]);
Pv = rotate2d(Pv, Math.PI/6);

// ---- Compute toroidal phases ----
const phases = euclidean2torus(Pv); // [[t1,t2,t3], ...]
const t1 = phases.map(p=>p[0]);
const t2 = phases.map(p=>p[1]);
const t3 = phases.map(p=>p[2]);

// ---- Simulate grid-cell firing rates ----
// in MATLAB: gridCellPhases & sigma
const gridCellPhases = []; // TODO: extract from MATLAB script
const gridCells = simulateGridCells(Pv, gridCellPhases, /*sigma*/0.2);

// ---- Triangulate hex tile ----
const triangles = constrainedDelaunay(Pv, /*spacing*/maxPhaseMag/(nGrid+1));

// ---- BufferGeometry with morph targets ----
const baseGeom = new THREE.BufferGeometry();
const N = Pv.length;

// positions attribute (will be morphTarget0, so keep initial flat positions)
const pos0 = new Float32Array(N*3);
for (let i=0; i<N; i++) {
  const [x,y] = Pv[i];
  pos0[3*i] = x;
  pos0[3*i+1] = y;
  pos0[3*i+2] = 0;
}
baseGeom.setAttribute('position', new THREE.BufferAttribute(pos0, 3));

// add morph targets: F01, F12, F23
function buildMorph(name, fn, pSteps, params) {
  const attr = [];
  for (let j=0; j<pSteps.length; j++) {
    const p = pSteps[j];
    const {x,y,z} = fn(t1, t2, p, ...params);
    for (let i=0; i<N; i++) {
      attr.push(x[i], y[i], z[i]);
    }
  }
  baseGeom.morphAttributes[name] = [ new THREE.Float32BufferAttribute(attr, 3) ];
}
// generate p arrays
const p01 = Array.from({length:morphSteps}, (_,i)=>i/(morphSteps-1));
const p12 = p01;
const p23 = p01;
buildMorph('F01', F01_morph, p01, [2*Math.PI]);
buildMorph('F12', F12_morph, p12, [2*Math.PI]);
buildMorph('F23', F23_morph, p23, [3, 1]);

baseGeom.setIndex(triangles);
baseGeom.computeVertexNormals();

// color attribute placeholders
const colorAttr = new THREE.Float32BufferAttribute(N*3, 3);
baseGeom.setAttribute('color', colorAttr);

// ---- Mesh & wireframe ----
const faceMat = new THREE.MeshPhongMaterial({ vertexColors:true, transparent:true, opacity:0.6, side: THREE.DoubleSide });
const mesh = new THREE.Mesh(baseGeom, faceMat);
faceMat.morphTargets = true;
scene.add(mesh);

const wireMat = new THREE.LineBasicMaterial({ vertexColors:true });
const wire = new THREE.LineSegments(new THREE.WireframeGeometry(baseGeom), wireMat);
scene.add(wire);

// ---- dat.GUI controls ----
const gui = new GUI();
const params = {
  wireframeMode: 'off', // off, single, data
  faceMode: 'data',     // off, single, data
  dataArray: 't1'       // t1, t2, t3, gridCells
};

// wireframeMode dropdown
gui.add(params, 'wireframeMode', ['off','single','data'])
   .name('Wireframe')
   .onChange(updateVisibility);
// faceMode dropdown
gui.add(params, 'faceMode', ['off','single','data'])
   .name('Faces')
   .onChange(updateVisibility);
// dataArray
gui.add(params, 'dataArray', ['t1','t2','t3','gridCells'])
   .name('Data')
   .onChange(value => { updateColors(); updateVisibility(); });

function updateColors() {
  const arr = { t1, t2, t3, gridCells }[params.dataArray];
  for (let i=0;i<N;i++) {
    const v = params.dataArray==='gridCells'? arr[i] : (arr[i]+Math.PI)/(2*Math.PI);
    const color = new THREE.Color().setHSL(v,1,0.5);
    colorAttr.setXYZ(i, color.r, color.g, color.b);
  }
  colorAttr.needsUpdate = true;
}

function updateVisibility() {
  // wireframe
  wire.visible = params.wireframeMode!=='off';
  if (params.wireframeMode==='single') wireMat.color.set('#ffffff');
  if (params.wireframeMode==='data') wireMat.vertexColors = true;
  // faces
  mesh.visible = params.faceMode!=='off';
  faceMat.transparent = params.faceMode==='data';
  if (params.faceMode==='single') faceMat.color.set('#888888');
  if (params.faceMode==='data') faceMat.vertexColors = true;
}

updateColors(); updateVisibility();

// ---- Lighting ----
scene.add(new THREE.AmbientLight(0x404040));
const dirLight = new THREE.DirectionalLight(0xffffff,1);
dirLight.position.set(5,5,5);
scene.add(dirLight);

// ---- Animation timeline ----
const timeline = gsap.timeline({ repeat:-1, yoyo:true });
// reset morph influences
mesh.morphTargetInfluences.fill(0);

// initial: flat hex tiles (morph targets off)
timeline.to(mesh.morphTargetInfluences, { 0: 0, 1:0, 2:0, duration:0 });
// Zoom
timeline.to(camera, { fov: viewAngleZoomEnd, duration: stepDuration, onUpdate: ()=>camera.updateProjectionMatrix() });
// F01
timeline.to(mesh.morphTargetInfluences, { 0: 1, duration: stepDuration });
// F12
timeline.to(mesh.morphTargetInfluences, { 1: 1, duration: stepDuration });
// F23
timeline.to(mesh.morphTargetInfluences, { 2: 1, duration: stepDuration });
// Torus viewAngle
timeline.to(camera, { fov: viewAngleTorusEnd, duration: stepDuration, onUpdate: ()=>camera.updateProjectionMatrix() });

// ---- Render loop ----
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
