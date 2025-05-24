// torusUtils.js
// Helper functions for hex-tile → cylinder → torus morph and grid-cell simulation

import Delaunator from 'delaunator';


/**
 * Rotate 2D points by a given angle.
 * @param {number[][]} p - Array of [x, y] points.
 * @param {number} alpha - Rotation angle in radians.
 * @returns {number[][]} Array of rotated [x, y] points.
 */
export function rotate2d(p, alpha) {
    return p.map(([x, y]) => {
      const theta = Math.atan2(y, x);
      const rho   = Math.hypot(x, y);
      const newTheta = theta + alpha;
      return [
        rho * Math.cos(newTheta),
        rho * Math.sin(newTheta)
      ];
    });
  }


  /**
 * Generate XY coords of hexagonal grid nodes, with hexagon
 * oriented so it has two horizontal sides.
 * @param {number} nRings  Number of rings around the center.
 * @returns {number[][]}   Array of [x,y] coords, starting with [0,0].
 */
export function gridNodes(nRings) {
    const points = [[0, 0]];
    const nIndTot = 6 * nRings;
    let total = 0;
  
    for (let a = 1; a <= nRings; a++) {
      // decide how many points on this ring
      const bArray =
        nIndTot === 0 || a !== nRings
          ? Array.from({ length: 6 * a }, (_, i) => i)
          : Array.from({ length: nIndTot }, (_, i) => i);
  
      for (const b of bArray) {
        const c = b % a;
        const theta =
          Math.atan((Math.sqrt(3) * c) / (2 * a - c)) +
          Math.PI * (b - c) / (3 * a);
        const r = Math.sqrt((a - c) * (a - c) + a * c);
        // console.log("pushing point r=", r, ", theta=", theta);
        total += 1;
        points.push([
          r * Math.cos(theta),
          r * Math.sin(theta)
        ]);
      }
    }
  
    // console.log("Total points: ", total);
    return points;
  }


/**
 * Generates Euclidean coordinates of the vertices of a single hexagonal
 * 'phase tile' (the area containing the full toroidal phase space),
 * with corner-up orientation (two sides vertical).
 * @returns {number[][]} 6×2 array of [x,y] coordinates.
 */
export function hexPhaseTile() {
    const d = 1 / Math.sqrt(3);
    // rotations = pi/6 + [pi/3, 2pi/3, pi, 4pi/3, 5pi/3, 2pi]
    const rotations = Array.from({ length: 6 }, (_, i) =>
      Math.PI / 6 + (i + 1) * (Math.PI / 3)
    );
    return rotations.map(theta => [
      d * Math.cos(theta),
      d * Math.sin(theta)
    ]);
  }


/**
 * Convert 2D Euclidean coordinates into (hexagonal) toroidal coordinates.
 * @param {number[][]} pEuclidean - Array of [x,y] pairs.
 * @returns {number[][]} Array of [t1,t2,t3] (in radians) for each input point.
 */
export function euclidean2torus(pEuclidean) {
const r = Math.tan(Math.PI / 3);
return pEuclidean.map(([x, y]) => {
    const t1 = x - (y / r);
    const t2 = y / (r / 2);
    const t3 = -(t1 + t2);
    return [
    2 * Math.PI * t1,
    2 * Math.PI * t2,
    2 * Math.PI * t3
    ];
});
}


/**
 * Wrap a single [x,y] point into the unit‐rhombus phase tile.
 * The rhombus is defined with two sides parallel to x
 * @param {[number,number]} pt  [x, y] point (spacing = 1)
 * @returns {[number,number]}    [xW, yW] wrapped point
 */
export function wrapToRhombus([x0, y0]) {
  const r     = Math.sqrt(3); // √3
  const halfR = r / 2;

  // how many full vertical half‐periods?
  const nYCycles = Math.floor(y0 / halfR);

  // wrap y into [0, halfR)
  const yW = y0 - nYCycles * halfR;

  // shift x for each y‐cycle
  const xShift = mod(yW / r, 1);
  const xBase  = x0 + nYCycles * 0.5;

  // wrap x into [0,1) around the shift
  const xW = mod(xBase - xShift, 1) + xShift;

  return [xW, yW];
}


/**
 * Generate a rhombus‐shaped meshgrid in torus‐phase space and map it into Euclidean coords.
 *
 * @param {number} numRings 
 *   Number of subdivisions per side. You’ll get (numRings+1)² points.
 * @returns {object} 
 *   { 
 *     phaseCoords: Array<[t1, t2]>,   // toroidal phases in [0,2π]
 *     euclidCoords: Array<[x,  y]>    // mapped into the rhombus domain
 *   }
 */
export function buildRhombusMeshGrid(numRings) {
  const N = numRings;
  const phaseCoords = [];

  const twoPi = 2 * Math.PI;

  // 1) Sample uniformly in [0,2π] × [0,2π]
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const t1 = (i/N - 0.5) * twoPi;
      const t2 = (j/N - 0.5) * twoPi;
      phaseCoords.push([t1, t2]);
    }
  }

  // 2) Linear map (t1,t2) → rhombus (x,y):
  //    x = t1 + 0.5*t2
  //    y = (√3/2)*t2
  const sqrt3 = Math.sqrt(3);
  const euclidCoords = phaseCoords.map(([t1, t2]) => [
    t1/twoPi + 0.5 * t2/twoPi,
    (sqrt3 / 2) * (t2/twoPi)
  ]);

  return { phaseCoords, euclidCoords };
}


// Positive modulo helper
function mod(a, m) {
  return ((a % m) + m) % m;
}


/**
 * Generate firing-rate PDF for an artificial grid cell at a set of points.
 * @param {Array<[number,number]>} points - Array of [x,y] coordinates.
 * @param {number[]} phase              - [phaseX, phaseY] offset.
 * @param {number}   sigma              - Gaussian width.
 * @returns {number[]} Z                - Array of PDF values per point.
 */
export function gridCellPdf(points, phase, sigma) {
  // Determine number of rings to cover all points
  const maxAbs = Math.max(
    ...points.map(p => Math.abs(p[0])),
    ...points.map(p => Math.abs(p[1]))
  );
  const nRings = Math.ceil(1.5 * maxAbs);
  const nodes = gridNodes(nRings);
  const Z = new Array(points.length).fill(0);
  const normFactor = 1 / (Math.sqrt(2 * Math.PI) * sigma);

  for (const [dx, dy] of nodes) {
    const phaseX = phase[0] + dx;
    const phaseY = phase[1] + dy;
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      const dd = Math.hypot(x - phaseX, y - phaseY);
      Z[i] += normFactor * Math.exp(-0.5 * (dd / sigma) ** 2);
    }
  }

  return Z;
}


/**
 * 2D Delaunay triangulation with a constraint on maximum triangle side length.
 * @param {number[][]} P               Array of [x,y] points.
 * @param {number}       sideLengthLimit  Maximum allowed side length.
 * @param {number}       [tol=1e-6]       Tolerance added to sideLengthLimit.
 * @returns {number[][]}  Array of triangles, each as a 1-based index triple [i,j,k].
 */
export function constrainedDelaunay(P, sideLengthLimit, tol = 1e-6) {
  // 1) Raw Delaunay (0-based indices)
  const delaunay = Delaunator.from(P);
  const rawTris  = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    rawTris.push([
      delaunay.triangles[i] + 1,
      delaunay.triangles[i + 1] + 1,
      delaunay.triangles[i + 2] + 1
    ]);
  }

  // 2) Filter by max side length
  const limit = sideLengthLimit + tol;
  return rawTris.filter(([i1, i2, i3]) => {
    const [x1, y1] = P[i1 - 1];
    const [x2, y2] = P[i2 - 1];
    const [x3, y3] = P[i3 - 1];
    // edge lengths
    const d12 = Math.hypot(x2 - x1, y2 - y1);
    const d23 = Math.hypot(x3 - x2, y3 - y2);
    const d31 = Math.hypot(x1 - x3, y1 - y3);
    const dmax = Math.max(d12, d23, d31);
    if (dmax <= limit) {
      // console.log("max side length: ", dmax);
    }
    return dmax <= limit;
  });
}


/**
 * Developable morph from flat sheet into cylinder for one point.
 * @param {[number,number]} tp     [t1, t2] toroidal coordinates.
 * @param {number}          p      Morph parameter in [0,1].
 * @param {number}          [H=2π] Cylinder height.
 * @returns {[number,number,number]} [x, y, z] Euclidean coordinates.
 */
export function F01_morph([t1, t2], p, H = 2 * Math.PI) {
  const twoPi = 2 * Math.PI;
  const sqrt3 = Math.sqrt(3);
  // lattice-driven angles
  const nphi = t1 + t2 / 2;
  const v    = (t2 / twoPi) * H * (sqrt3 / 2);

  if (p <= 0) {
    // flat sheet in X–Z plane at y = -1 (centered at y=0 when p→1)
    return [nphi, -1, v];
  } else {
    // isometric pipe-bend
    const R0    = 1 / p;
    const theta = p * nphi;
    const x     = R0 * Math.sin(theta);
    const y     = R0 * (1 - Math.cos(theta)) - 1;
    return [x, y, v];
  }
}

/**
 * Morph from cylinder (F1) to half-twist cylinder (F2) for one point.
 * @param {[number,number]} tp     [t1, t2] toroidal coordinates.
 * @param {number}          p      Morph parameter in [0,1].
 * @param {number}          H      Cylinder height.
 * @returns {[number,number,number]} [x, y, z] Euclidean coordinates.
 */
export function F12_morph([t1, t2], p, H) {
  // Base cylinder at p=1
  const [X1, Y1, Z1] = F01_morph([t1, t2], 1, H);
  const thetaFull   = (t2 + Math.PI) / 2;
  const thetaP      = p * thetaFull;
  // rotate cross-section around Z
  const x = X1 * Math.cos(thetaP) - Y1 * Math.sin(thetaP);
  const y = X1 * Math.sin(thetaP) + Y1 * Math.cos(thetaP);
  const z = Z1;
  return [x, y, z];
}

/**
 * Morph from twisted cylinder (F2) into torus by isometric pipe bending for one point.
 * @param {[number,number]} tp      [t1, t2] toroidal coordinates.
 * @param {number}          p       Morph parameter in [0,1].
 * @param {number}          [R=1]   Torus major radius.
 * @param {number}          [f=2]   Tube shrink factor.
 * @param {string}          [anchor="center"]  "bottom"|"center"|"top".
 * @returns {[number,number,number]} [x, y, z] Euclidean coordinates.
 */
export function F23_morph([t1, t2], p, R = 1, f = 2, anchor = "center") {
  const twoPi = 2 * Math.PI;
  const cylinderHeight = R * twoPi;

  // Twisted cylinder at p=1
  const [X2, Y2, Z2] = F12_morph([t1, t2], 1, cylinderHeight);

  if (p <= 0) {
    return [X2, Y2, Z2];
  }

  // Anchor offset: bottom=1, center=0, top=-1
  let uoffset = 0;
  switch (anchor.toLowerCase()) {
    case 'bottom': uoffset = 1; break;
    case 'top':    uoffset = -1; break;
  }

  // Arc-length coordinate along pipe
  const u  = (t2 / twoPi) * cylinderHeight + uoffset;
  const Rt = R / p;
  const Theta = u / Rt;

  // Centerline in X–Z (scaled by √3/2)
  const cFactor = Math.sqrt(3) / 2;
  const Cx = Rt * (1 - Math.cos(Theta)) * cFactor;
  const Cz = Rt * Math.sin(Theta) * cFactor;

  // Principal normal
  const Nx =  Math.cos(Theta);
  const Nz = -Math.sin(Theta);

  // Cross-section offset
  const radX = Nx * X2;
  const radY = Y2;
  const radZ = Nz * X2;

  // Shrink tube radius
  const r0 = 1;
  const rShrink = r0 / (1 + (f - 1) * p);

  // Initial bent coords
  let x = Cx + rShrink * radX;
  let y =      rShrink * radY;
  let z = Cz + rShrink * radZ - uoffset * (cylinderHeight / 2);

  // Subtract center-of-mass shift: p*[1,0,-π·uoffset]
  x -= p;
  z += p * Math.PI * uoffset;

  return [x, y, z];
}
