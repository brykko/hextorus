// torusUtils.js
// Helper functions for hex-tile → cylinder → torus morph and grid-cell simulation

import Delaunator from 'delaunator';

// /** rotate2d: rotate 2D points by alpha radians */
// export function rotate2d(points, alpha) {
//   const cosA = Math.cos(alpha), sinA = Math.sin(alpha);
//   return points.map(([x, y]) => [x*cosA - y*sinA, x*sinA + y*cosA]);
// }

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

// /** gridNodes: generate hexagonal grid points within radius R (distance between parallel sides) */
// export function gridNodes(R, spacing) {
//   const pts = [];
//   const n = Math.ceil(R/spacing);
//   for (let i = -n; i <= n; i++) {
//     for (let j = -n; j <= n; j++) {
//       const x = i*spacing + j*(spacing/2);
//       const y = j*(spacing*Math.sqrt(3)/2);
//       if (
//         Math.abs(x) <= R + 1e-6 &&
//         Math.abs(y) <= Math.sqrt(3)*R/2 + 1e-6 &&
//         Math.abs(x)*Math.sqrt(3) + Math.abs(y) <= Math.sqrt(3)*R + 1e-6
//       ) pts.push([x, y]);
//     }
//   }
//   return rotate2d(pts, Math.PI/6);
// }

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

// /** hexPhaseTile: vertices of a single normalized hexagon (side-to-side = 1) */
// export function hexPhaseTile() {
//   const R = Math.tan(Math.PI/6);
//   const pts = [];
//   for (let k = 0; k < 6; k++) {
//     const ang = Math.PI/6 + k * Math.PI/3;
//     pts.push([R * Math.cos(ang), R * Math.sin(ang)]);
//   }
//   return pts;
// }

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

// module.exports = euclidean2torus;

// /** euclidean2torus: map array of [x,y] to array of [t1,t2,t3] in [-π,π] */
// export function euclidean2torus(points) {
//   const wrap = a => ((a + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI;
//   return points.map(([x,y]) => {
//     const r = Math.sqrt(3);
//     const alpha = Math.sqrt(3)*x - y;
//     const beta  = 2*y;
//     return [wrap(alpha), wrap(beta), wrap(-(alpha+beta))];
//   });
// }

/**
 * Generate firing-rate PDF for an artificial grid cell.
 * @param {number[][]} X      2D array of X coordinates (row-major).
 * @param {number[][]} Y      2D array of Y coordinates, same size as X.
 * @param {number[]}   phase  [phaseX, phaseY] offset.
 * @param {number}     sigma  Gaussian width.
 * @returns {number[][]}      Z, same size as X and Y.
 */
export function gridCellPdf(X, Y, phase, sigma) {
  // Determine how many rings needed to cover all X,Y
  const flatX = X.flat();
  const flatY = Y.flat();
  const maxAbs = Math.max(...flatX.map(Math.abs), ...flatY.map(Math.abs));
  const nRings = Math.ceil(1.5 * maxAbs);

  const nodes = gridNodes(nRings);  // [[x1,y1], [x2,y2], ...]
  const rows = X.length, cols = X[0].length;
  const Z = Array.from({ length: rows }, () => Array(cols).fill(0));

  const normFactor = 1 / (Math.sqrt(2 * Math.PI) * sigma);

  for (const [dx, dy] of nodes) {
    const phaseX = phase[0] + dx;
    const phaseY = phase[1] + dy;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const dd = Math.hypot(X[i][j] - phaseX, Y[i][j] - phaseY);
        Z[i][j] += normFactor * Math.exp(-0.5 * (dd / sigma) ** 2);
      }
    }
  }

  return Z;
}

// /** simulateGridCells: sum of Gaussians centered at gridCellPhases */
// export function simulateGridCells(points, gridCellPhases, sigma) {
//   function gauss(x,y,mu) {
//     const dx = x-mu[0], dy = y-mu[1];
//     return Math.exp(-(dx*dx+dy*dy)/(2*sigma*sigma));
//   }
//   const Z = points.map(() => 0);
//   gridCellPhases.forEach(mu => {
//     points.forEach(([x,y],i) => {
//       Z[i] += gauss(x,y,mu);
//     });
//   });
//   const maxZ = Math.max(...Z);
//   return Z.map(v=>v/maxZ);
// }

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

// /** Constrained Delaunay via max-side-length filter */
// export function constrainedDelaunay(points, spacing, tol = 1e-6) {
//   // points: Array of [x,y]
//   // spacing: nominal neighbor distance
//   const delaunay = Delaunator.from(points);
//   const triangles = delaunay.triangles;
//   const filtered = [];
//   const sqMax = (spacing + tol) * (spacing + tol);
//   for (let i = 0; i < triangles.length; i += 3) {
//     const i0 = triangles[i], i1 = triangles[i+1], i2 = triangles[i+2];
//     const [x0, y0] = points[i0];
//     const [x1, y1] = points[i1];
//     const [x2, y2] = points[i2];
//     const d01 = (x0-x1)*(x0-x1) + (y0-y1)*(y0-y1);
//     const d12 = (x1-x2)*(x1-x2) + (y1-y2)*(y1-y2);
//     const d20 = (x2-x0)*(x2-x0) + (y2-y0)*(y2-y0);
//     const dmax = Math.max(d01, d12, d20);
//     if (dmax <= sqMax) {
//       filtered.push(i0, i1, i2);
//     }
//   }
//   return filtered;
// }

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
        // flat sheet in X–Z plane at y=0
        return [nphi, 0, v];
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

// /** Morph functions ported from MATLAB */
// export function F01_morph(t1,t2,p,H=2*Math.PI) {
//   const phi = t1.map((v,i)=>v + t2[i]/2);
//   const v   = t2.map(v=>v/(2*Math.PI)*H);
//   const x=[],y=[],z=[];
//   if (p<=0) {
//     for (let i=0;i<phi.length;i++) { x.push(phi[i]); y.push(0); z.push(v[i]); }
//   } else if (p>=1) {
//     for (let i=0;i<phi.length;i++) { x.push(Math.cos(phi[i])); y.push(Math.sin(phi[i])); z.push(v[i]); }
//   } else {
//     const R0=1/p;
//     for (let i=0;i<phi.length;i++){
//       const th=p*phi[i];
//       x.push(R0*Math.sin(th));
//       y.push(R0*(1-Math.cos(th)));
//       z.push(v[i]);
//     }
//   }
//   return {x,y,z};
// }

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

// export function F12_morph(t1,t2,p,H=2*Math.PI) {
//   const {x:X1,y:Y1,z:Z1}=F01_morph(t1,t2,1,H);
//   const x=[],y=[],z=[];
//   const theta_full = t2.map(v=>(v+Math.PI)/2);
//   if (p<=0) return {x:X1,y:Y1,z:Z1};
//   if (p>=1) {
//     for (let i=0;i<X1.length;i++){ const tf=theta_full[i]; x.push(X1[i]*Math.cos(tf)-Y1[i]*Math.sin(tf)); y.push(X1[i]*Math.sin(tf)+Y1[i]*Math.cos(tf)); z.push(Z1[i]); }
//     return {x,y,z};
//   }
//   for (let i=0;i<X1.length;i++){ const th=p*theta_full[i]; x.push(X1[i]*Math.cos(th)-Y1[i]*Math.sin(th)); y.push(X1[i]*Math.sin(th)+Y1[i]*Math.cos(th)); z.push(Z1[i]); }
//   return {x,y,z};
// }


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
      const Cx = Rt * (1 - Math.cos(Θ));
      const Cz = Rt * Math.sin(Θ);
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
      let y =       rShrink * rad_y;   // Cy is zero
      let z = Cz + rShrink * rad_z - uoffset * (cylinderHeight / 2);
  
      // subtract shifting center of mass: C = p*[1,0,-π·uoffset]
      x -= p;
      // y unchanged (−0)
      z -= -p * Math.PI * uoffset; // ⇒ z += p·π·uoffset
  
      return [x, y, z];
    });
  }

// export function F23_morph(t1,t2,p,R=3,r=1) {
//   const H=2*Math.PI*R;
//   const {x:X2,y:Y2,z:Z2}=F12_morph(t1,t2,1,H);
//   if (p<=0) return {x:X2,y:Y2,z:Z2};
//   const u=Z2;
//   const Rt=R/p;
//   const Theta=u.map(v=>v/Rt);
//   const x=[],y=[],z=[];
//   for (let i=0;i<u.length;i++){
//     const th=Theta[i];
//     const Cy=Rt*Math.sin(th);
//     const Cz=Rt*(1-Math.cos(th));
//     const nx=0, ny=Math.cos(th), nz=Math.sin(th);
//     x.push(r*Y2[i]);
//     y.push(Cy + r*Y2[i]*ny);
//     z.push(Cz + r*Y2[i]*nz);
//   }
//   return {x,y,z};
// }
