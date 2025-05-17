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
    return dmax <= limit;
  });
}


/**
 * Developable morph from flat sheet into cylinder.
 * @param {Array<[number,number]>} tp  Array of [t1, t2] pairs.
 * @param {number} p                  Morph parameter in [0,1].
 * @param {number} [H=2*Math.PI]      Cylinder height.
 * @returns {Array<[number,number,number]>}  Array of [x, y, z] for each input.
 */
export function F01_morph(tp, p, H = 2 * Math.PI) {
    const twoPi = 2 * Math.PI;
    const sqrt3 = Math.sqrt(3);
    return tp.map(([t1, t2]) => {
      // lattice-driven angles
      const nphi = t1 + t2 / 2;
      const v    = (t2 / twoPi) * H * (sqrt3 / 2);
  
      if (p <= 0) {
        // flat sheet in X–Z plane at y=-1
        // (The choice of -1 is because we want the cylinder to be centered on zero)
        return [nphi, -1, v]; 
      } else {
        // isometric pipe-bend
        const R0    = 1 / p;
        const theta = p * nphi;
        const x     = R0 * Math.sin(theta);
        const y     = R0 * (1 - Math.cos(theta)) - 1;  // center y=0 at p=1
        return [x, y, v];
      }
    });
  }


/**
 * Morph from cylinder (F1) to half-twist cylinder (F2).
 * @param {Array<[number,number]>} tp    Array of [t1,t2] pairs.
 * @param {number}                p     Morph parameter in [0,1].
 * @param {number}                [H]   Cylinder height (defaults through F01_morph).
 * @returns {Array<[number,number,number]>} Array of [x,y,z] for each input.
 */
export function F12_morph(tp, p, H) {
  // Start from full-cylinder output of F01_morph (p=1)
  const base = F01_morph(tp, 1, H);
  return tp.map(([t1, t2], i) => {
    const [X1, Y1, Z1] = base[i];
    // half-turn over tile, then interpolate by p
    const theta_full = (t2 + Math.PI) / 2;
    const theta_p    = p * theta_full;
    // rotate cross-section around Z
    const x = X1 * Math.cos(theta_p) - Y1 * Math.sin(theta_p);
    const y = X1 * Math.sin(theta_p) + Y1 * Math.cos(theta_p);
    const z = Z1;
    return [x, y, z];
  });
}


/**
 * Morph from twisted cylinder (F2) into torus by isometric pipe bending.
 * @param {Array<[number,number]>} tp      Array of [t1,t2] pairs.
 * @param {number}                p       Morph parameter in [0,1].
 * @param {number}                [R=1]   Target torus major radius.
 * @param {number}                [f=2]   Shrink factor for tube radius.
 * @param {string}                [anchor="center"]  "bottom" | "center" | "top"
 * @returns {Array<[number,number,number]>}  Array of [x,y,z] coordinates.
 */
export function F23_morph(tp, p, R = 1, f = 2, anchor = "center") {
    const twoPi = 2 * Math.PI;
    const cylinderHeight = R * twoPi;
  
    // get twisted-cylinder coords at p=1
    const base2 = F12_morph(tp, 1, cylinderHeight);
  
    // p≤0 → no bending
    if (p <= 0) {
      return base2;
    }
  
    // choose vertical anchor offset
    let uoffset = 0;
    switch (anchor.toLowerCase()) {
      case "bottom": uoffset = 1; break;
      case "top":    uoffset = -1; break;
      // center → 0
    }
  
    return tp.map(([t1, t2], i) => {
      const [X2, Y2, Z2] = base2[i];
  
      // arc-length coordinate along pipe
      const u  = (t2 / twoPi) * cylinderHeight + uoffset;
      const Rt = R / p;
      const Θ  = u / Rt;
  
      // centerline of bent pipe
      const Cx = Rt * (1 - Math.cos(Θ)) * Math.sqrt(3)/2;
      const Cz = Rt * (0 + Math.sin(Θ)) * Math.sqrt(3)/2;
      // principal normal
      const Nx =  Math.cos(Θ);
      const Nz = -Math.sin(Θ);
  
      // local cross-section offset
      const rad_x = Nx * X2;
      const rad_y = Y2;
      const rad_z = Nz * X2;
  
      // shrink tube radius as p→1
      const r0     = 1;
      const rShrink = r0 / (1 + (f - 1) * p);
  
      // initial bent coordinates
      let x = Cx + rShrink * rad_x;
      let y =      rShrink * rad_y;   // Cy is zero
      let z = Cz + rShrink * rad_z - (uoffset * (cylinderHeight / 2));
  
      // subtract shifting center of mass in X-Z plane: C = p*[1,0,-π·uoffset]
      x -= p;
      // y unchanged (−0)
      z -= -p * Math.PI * uoffset; // ⇒ z += p·π·uoffset
  
      return [x, y, z];
    });
  }
