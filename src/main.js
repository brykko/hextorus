import * as THREE from 'three';
import { GUI } from 'dat.gui';
import { EffectComposer, EffectPass, RenderPass, BloomEffect } from 'postprocessing';
import { KernelSize } from 'postprocessing';
import { gridNodes, rotate2d, constrainedDelaunay, euclidean2torus,
         F01_morph, F12_morph, F23_morph, gridCellPdf} from './torusUtils.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GridTile } from './GridTile.js';

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

function getStageDuration(stage) {
  return (stage === 'holdStart' || stage === 'holdEnd')
    ? 1000
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
const POINT_SIZE = 3;
// const NTILE_I = 50;

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
// // 1) Flat hexagon grid
// let Pv = gridNodes(NGRID)
//   .map(([x, y]) => [ x / (NGRID) * HEX_SIDE,
//                      y / (NGRID) * HEX_SIDE ]);
// Pv = rotate2d(Pv, Math.PI / 6);

// // 2) Toroidal phases (unwrapped)
// const Tv = euclidean2torus(Pv);  // [[t1,t2,t3],...]

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


// --- Create GridTile instances using template and static cloning ---
// Template tile at origin; builds its own geometry internally
const templateTile = new GridTile(NGRID, { position: [0, 0, 0], scale: SCALE, shape: 'hexagon' });
const Pv = templateTile.euclidCoords;
// templateTile.setTransform(pt => F01_morph(pt, 0));

// Clone tiles for all centers (first is the central tile)
const allTiles = GridTile.tile(templateTile, NTILE_RINGS, SCALE);
const centralTile = allTiles[0];
const peripheralTiles = allTiles.slice(1);
// Add all tiles to the scene
allTiles.forEach(tile => scene.add(tile.group));
scene.add(centralTile.group);

// Initialize visibility and opacity
// centralTile.setVisibility(false);
allTiles.forEach(tile => {
  tile.setVisibility(true);
  tile.setOpacity(1);
});

// // Debug: display every grid point as a white dot
// allTiles.forEach(tile => {
//   const ptsGeom = new THREE.BufferGeometry();
//   // reuse the same positions as the face geometry
//   ptsGeom.setAttribute(
//     'position',
//     tile.faceGeom.getAttribute('position')
//   );
//   const ptsMat = new THREE.PointsMaterial({
//     color: 0xffffff,
//     size: POINT_SIZE,
//     sizeAttenuation: false
//   });
//   const pts = new THREE.Points(ptsGeom, ptsMat);
//   tile.group.add(pts);
// });

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 3));

// --- GUI controls ---
const gui = new GUI();
const controls = {
  data: dataMode,
  restart: () => { onRestart() }
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

// Calculate grid-cell PDFs
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


function updateColors() {
  const N = Pv.length;

  // Determine which vertex‐based data to use
  let colorsArray;
  if (dataMode === 'gridCells') {
    // RGB from three normalized grid‐cell PDFs
    colorsArray = gridCellsRgbV;
  } else if (dataMode.startsWith('torus')) {
    // HSV→RGB mapping of torus phase channel (including computed 3rd axis)
    const channel = parseInt(dataMode.slice(-1), 10) - 1;
    colorsArray = centralTile.torusCoords.map(([t1, t2]) => {
      // compute third phase
      const t3 = - (t1 + t2);
      const phases = [t1, t2, t3];
      // wrap and normalize selected channel
      const raw = phases[channel];
      const wrapped = ((raw % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
      const h = wrapped / (2*Math.PI);
      return hsv2rgb(h, 1, 1);
    });
  } else {
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

    // Function to map phases and index to color RGB
    function colorMap(tpt, i) {
      return [colorAttr[3*i], colorAttr[3*i+1], colorAttr[3*i+2]];
    }

    centralTile.setColorMap((tpt, i) => {
      return colorMap(tpt, i);
    });
    peripheralTiles.forEach(tile =>
      tile.setColorMap((tpt, i) => {
        return colorMap(tpt, i);
      })
    );
    return;
  }

  // No data mode → set default gray color
  centralTile.setColorMap(() => [0.5333333333333333, 0.5333333333333333, 0.5333333333333333]);
  peripheralTiles.forEach(tile => tile.setColorMap(() => [0.5333333333333333, 0.5333333333333333, 0.5333333333333333]));
}

function fcnScaled(fcn, pt) {
  const [x,y,z] = fcn(pt);
  return [x/SCALE, y/SCALE, z/SCALE];
}

function setMorph(fcn, t) {
  function fmorph(pt) {
    return fcn(pt, t);
  }
  centralTile.setTransform(pt => fcnScaled(fmorph, pt));
}

function onRestart() {
  centralTile.setVisibility(true);
  peripheralTiles.forEach(tile => {
    tile.setVisibility(true);
    tile.setOpacity(1);
  });
  stageIndex = 0;
  reverse = false;
  firstStep = true;
  stageStart = performance.now();
}

// --- Animation loop --------------------------------------------------
let stageIndex = 0;
let stageStart = performance.now();
let reverse = false;
let firstStep = false;

updateColors();
onRestart();

// console.log(centralTile.faceMesh);

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
    if (firstStep) {
      centralTile.setVisibility(true);
      setMorph(F01_morph, 0);
      peripheralTiles.forEach(tile => {
        tile.setVisibility(true);
        tile.setOpacity(1);
      });
      camera.fov = 40;
      camera.updateProjectionMatrix();
    }

  } else if (stage === 'fade') {
    centralTile.setVisibility(true);
    setMorph(F01_morph, 0);
    peripheralTiles.forEach((tile, idx) => {
      tile.setOpacity(1-t);
      tile.setVisibility(true);
    });
    camera.fov = THREE.MathUtils.lerp(40, 20, t);
    camera.updateProjectionMatrix();

  } else if (stage === 'cylinder') {
    if (firstStep) {
      peripheralTiles.forEach(tile => tile.setVisibility(false));
      centralTile.setVisibility(true);
    }
    setMorph(F01_morph, t);


  } else if (stage === 'twist') {
    if (firstStep) {
      peripheralTiles.forEach(tile => tile.setVisibility(false));
      centralTile.setVisibility(true);
    }
    setMorph(F12_morph, t);

  } else if (stage === 'torus') {
    if (firstStep) {
      peripheralTiles.forEach(tile => tile.setVisibility(false));
      centralTile.setVisibility(true);
    }
    setMorph(F23_morph, t);
    camera.fov = THREE.MathUtils.lerp(20, 10, t);
    camera.updateProjectionMatrix();

  } else if (stage === 'holdEnd') {
    if (firstStep) {
      centralTile.setVisibility(true);
      peripheralTiles.forEach(tile => tile.setVisibility(false));
    }
    setMorph(F23_morph, 1);
    camera.fov = 10;
    camera.updateProjectionMatrix();
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
