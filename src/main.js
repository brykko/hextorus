// src/main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Delaunator from 'delaunator';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// rendering mode: 'surface' or 'points'
let renderMode = 'surface';
let planePoints, torusPoints, boundingLines;

// ---- scene setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// ---- parameters ----
const R = Math.tan(Math.PI / 6);  // side-to-side width = 1
const spacing = 0.01;             // hex grid resolution
const rCross  = 0.3;              // tube radius for torus\ nconst rCross = 0.3;                // tube radius for torus

// ---- flat hexagon ----
const hexGeom = createHexGeometry(R, spacing);
hexGeom.computeVertexNormals();

const planeMat = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.DoubleSide
});
const planeMesh = new THREE.Mesh(hexGeom, planeMat);
scene.add(planeMesh);

// also as point cloud
const pointMat = new THREE.PointsMaterial({ size: spacing * 5, vertexColors: true });
planePoints = new THREE.Points(hexGeom, pointMat);
planePoints.visible = false;
scene.add(planePoints);

// ---- twisted torus surface ----
// build the base hex geometry and apply the twist
const rawTorusGeom = createHexGeometry(R, spacing);
applyTwistedTorus(rawTorusGeom, rCross);

// properly weld the seam by merging vertices into a new geometry
const torusGeom = mergeVertices(rawTorusGeom, 1e-6);
torusGeom.computeVertexNormals();

// surface mesh
const torusMat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide });
const torusMesh = new THREE.Mesh(torusGeom, torusMat);
torusMesh.visible = false;
scene.add(torusMesh);

// point cloud version
torusPoints = new THREE.Points(torusGeom, pointMat.clone());
torusPoints.visible = false;
scene.add(torusPoints);

// ---- bounding box sanity lines ----
const bbGeom = new THREE.BufferGeometry();
const bbVerts = new Float32Array([
  -0.5, -0.5, 0,  -0.5,  0.5, 0,
   0.5, -0.5, 0,   0.5,  0.5, 0,
  -0.5, -0.5, 0,   0.5, -0.5, 0,
  -0.5,  0.5, 0,   0.5,  0.5, 0
]);
bbGeom.setAttribute('position', new THREE.BufferAttribute(bbVerts, 3));
const bbMat = new THREE.LineBasicMaterial({ color: 0x000000 });
boundingLines = new THREE.LineSegments(bbGeom, bbMat);
boundingLines.visible = false;
scene.add(boundingLines);

// ---- visibility control & animation ----
function setVisible(plane, torus) {
  if (renderMode === 'surface') {
    planeMesh.visible = plane;
    torusMesh.visible = torus;
    planePoints.visible = false;
    torusPoints.visible = false;
    boundingLines.visible = plane;
  } else {
    planeMesh.visible = false;
    torusMesh.visible = false;
    planePoints.visible = plane;
    torusPoints.visible = torus;
    boundingLines.visible = false;
  }
}

function startAnimation() {
  setVisible(true, false);
  setTimeout(() => setVisible(false, true), 2000);
}
startAnimation();

document.getElementById('resetBtn').onclick = startAnimation;

// toggle button
const toggleBtn = document.createElement('button');
toggleBtn.textContent = 'Point Cloud';
toggleBtn.style.cssText = 'position:absolute;top:40px;left:10px;z-index:1';
document.body.appendChild(toggleBtn);
toggleBtn.onclick = () => {
  renderMode = renderMode === 'surface' ? 'points' : 'surface';
  toggleBtn.textContent = renderMode === 'surface' ? 'Point Cloud' : 'Surface Mesh';
  startAnimation();
};

// main render loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- Geometry helper functions ---

function rot2d(x, y, a) {
  return [
    x * Math.cos(a) - y * Math.sin(a),
    y * Math.cos(a) + x * Math.sin(a)
  ];
}

function createHexGeometry(R, spacing, tol = 1e-6) {
  const a = [spacing, 0];
  const b = [spacing / 2, spacing * Math.sqrt(3) / 2];
  const n = Math.ceil(R / spacing);
  const pts = [];
  const rot = Math.PI / 6; // align hexagon

  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = i * a[0] + j * b[0];
      const y = i * a[1] + j * b[1];
      if (
        Math.abs(x) <= R + tol &&
        Math.abs(y) <= Math.sqrt(3) * R / 2 + tol &&
        Math.abs(x) * Math.sqrt(3) + Math.abs(y) <= Math.sqrt(3) * R + tol
      ) {
        const [xr, yr] = rot2d(x, y, rot);
        pts.push([xr, yr]);
      }
    }
  }

  const delaunay = Delaunator.from(pts);
  const geom = new THREE.BufferGeometry();
  const posArr = new Float32Array(pts.length * 3);
  const colArr = new Float32Array(pts.length * 3);

  pts.forEach((p, i) => {
    posArr[3 * i] = p[0];
    posArr[3 * i + 1] = p[1];
    posArr[3 * i + 2] = 0;
    const [t1] = cartesianToToroidal(p[0], p[1]);
    const hue = (t1 + Math.PI) / (2 * Math.PI);
    const c = new THREE.Color().setHSL(hue, 1, 0.5);
    colArr[3 * i] = c.r;
    colArr[3 * i + 1] = c.g;
    colArr[3 * i + 2] = c.b;
  });

  geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  geom.setIndex(new THREE.BufferAttribute(delaunay.triangles, 1));

  return geom;
}

function applyTwistedTorus(geom, r, nTwists = 1) {
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i), y0 = pos.getY(i);
    const [t1, t2] = cartesianToToroidal(x0, y0);
    const t2r = t2 + nTwists * t1;
    const X = Math.cos(t1) * (1 + r * Math.cos(t2r));
    const Y = Math.sin(t1) * (1 + r * Math.cos(t2r));
    const Z = r * Math.sin(t2r);
    pos.setXYZ(i, X, Y, Z);
  }
  pos.needsUpdate = true;
}

function cartesianToToroidal(x, y) {
  const r = Math.sqrt(3);
  const alpha = x - y / r;
  const beta = y / (r / 2);
  const wrap = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const t1 = wrap(alpha * 2 * Math.PI);
  const t2 = wrap(beta * 2 * Math.PI);
  const t3 = wrap(t2 - t1);
  return [t1, t2, t3];
}
