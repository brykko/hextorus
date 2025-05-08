// src/main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Delaunator from 'delaunator';

// scene + camera + renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

// controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// lights
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// parameters
const R = 0.5;            // half-distance between parallel hexagon sides
const spacing = 0.01;   // lattice spacing
const rCross = 0.5;    // tube radius for torus

// generate hexagonal mesh geometry
const hexGeom = createHexGeometry(R, spacing);
// compute normals so WebGL has a normal attribute
hexGeom.computeVertexNormals();

// plane mesh (initial)
const planeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const planeMesh = new THREE.Mesh(hexGeom, planeMat);
scene.add(planeMesh);

// torus mesh (wrapped)
// regenerate fresh hex geometry for the torus (avoids clone issues)
const torusGeom = createHexGeometry(R, spacing);
applyTwistedTorus(torusGeom, rCross);
// recompute normals after twisting
torusGeom.computeVertexNormals();
const torusMat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide });
const torusMesh = new THREE.Mesh(torusGeom, torusMat);
torusMesh.visible = false;
scene.add(torusMesh);

// animation timeline (simple)
function startAnimation() {
  planeMesh.visible = true;
  torusMesh.visible = false;
  setTimeout(() => {
    planeMesh.visible = false;
    torusMesh.visible = true;
  }, 2000);
}
startAnimation();

document.getElementById('resetBtn').onclick = startAnimation;

// render loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- geometry helpers ---
function createHexGeometry(R, spacing, tol = 1e-6) {
  const a = [spacing, 0];
  const b = [spacing/2, spacing * Math.sqrt(3)/2];
  const nSteps = Math.ceil(R/spacing);
  const points = [];

  for (let i = -nSteps; i <= nSteps; i++) {
    for (let j = -nSteps; j <= nSteps; j++) {
      const x = i*a[0] + j*b[0];
      const y = i*a[1] + j*b[1];
      if (
        Math.abs(x) <= R + tol &&
        Math.abs(y) <= Math.sqrt(3)*R/2 + tol &&
        Math.abs(x)*Math.sqrt(3) + Math.abs(y) <= Math.sqrt(3)*R + tol
      ) {
        points.push([x, y]);
      }
    }
  }

  // Delaunay triangulation
  const delaunay = Delaunator.from(points);
  const geom = new THREE.BufferGeometry();
  const posArr = new Float32Array(points.length * 3);
  const colArr = new Float32Array(points.length * 3);

  points.forEach((p, i) => {
    posArr[3*i]   = p[0];
    posArr[3*i+1] = p[1];
    posArr[3*i+2] = 0;
    // HSV color by t1 phase
    const [t1,] = cartesianToToroidal(p[0], p[1]);
    const hue = (t1 + Math.PI) / (2 * Math.PI);
    const col = new THREE.Color().setHSL(hue, 1, 0.5);
    colArr[3*i]   = col.r;
    colArr[3*i+1] = col.g;
    colArr[3*i+2] = col.b;
  });

  geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
  // set up index buffer explicitly
  geom.setIndex(new THREE.BufferAttribute(delaunay.triangles, 1));

  return geom;
}

function applyTwistedTorus(geometry, r, nTwists = 1) {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i), y0 = pos.getY(i);
    const [t1, t2] = cartesianToToroidal(x0, y0);
    const t2Rot = t2 + nTwists * t1;
    const X = Math.cos(t1) * (1 + r * Math.cos(t2Rot));
    const Y = Math.sin(t1) * (1 + r * Math.cos(t2Rot));
    const Z = r * Math.sin(t2Rot);
    pos.setXYZ(i, X, Y, Z);
  }
  pos.needsUpdate = true;
}

function cartesianToToroidal(x, y) {
  const alpha = Math.sqrt(3)*x - y;
  const beta  = 2*y;
  const t1 = (alpha * Math.PI + Math.PI) % (2 * Math.PI) - Math.PI;
  const t2 = (beta  * Math.PI + Math.PI) % (2 * Math.PI) - Math.PI;
  return [t1, t2];
}
