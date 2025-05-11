// torusUtils.js
// Helper functions for hex-tile → cylinder → torus morph and grid-cell simulation

import Delaunator from 'delaunator';

/** rotate2d: rotate 2D points by alpha radians */
export function rotate2d(points, alpha) {
  const cosA = Math.cos(alpha), sinA = Math.sin(alpha);
  return points.map(([x, y]) => [x*cosA - y*sinA, x*sinA + y*cosA]);
}

/** gridNodes: generate hexagonal grid points within radius R (distance between parallel sides) */
export function gridNodes(R, spacing) {
  const pts = [];
  const n = Math.ceil(R/spacing);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = i*spacing + j*(spacing/2);
      const y = j*(spacing*Math.sqrt(3)/2);
      if (
        Math.abs(x) <= R + 1e-6 &&
        Math.abs(y) <= Math.sqrt(3)*R/2 + 1e-6 &&
        Math.abs(x)*Math.sqrt(3) + Math.abs(y) <= Math.sqrt(3)*R + 1e-6
      ) pts.push([x, y]);
    }
  }
  return rotate2d(pts, Math.PI/6);
}

/** hexPhaseTile: vertices of a single normalized hexagon (side-to-side = 1) */
export function hexPhaseTile() {
  const R = Math.tan(Math.PI/6);
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const ang = Math.PI/6 + k * Math.PI/3;
    pts.push([R * Math.cos(ang), R * Math.sin(ang)]);
  }
  return pts;
}

/** euclidean2torus: map array of [x,y] to array of [t1,t2,t3] in [-π,π] */
export function euclidean2torus(points) {
  const wrap = a => ((a + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI;
  return points.map(([x,y]) => {
    const r = Math.sqrt(3);
    const alpha = Math.sqrt(3)*x - y;
    const beta  = 2*y;
    return [wrap(alpha), wrap(beta), wrap(-(alpha+beta))];
  });
}

/** simulateGridCells: sum of Gaussians centered at gridCellPhases */
export function simulateGridCells(points, gridCellPhases, sigma) {
  function gauss(x,y,mu) {
    const dx = x-mu[0], dy = y-mu[1];
    return Math.exp(-(dx*dx+dy*dy)/(2*sigma*sigma));
  }
  const Z = points.map(() => 0);
  gridCellPhases.forEach(mu => {
    points.forEach(([x,y],i) => {
      Z[i] += gauss(x,y,mu);
    });
  });
  const maxZ = Math.max(...Z);
  return Z.map(v=>v/maxZ);
}

/** Constrained Delaunay via max-side-length filter */
export function constrainedDelaunay(points, spacing, tol = 1e-6) {
  // points: Array of [x,y]
  // spacing: nominal neighbor distance
  const delaunay = Delaunator.from(points);
  const triangles = delaunay.triangles;
  const filtered = [];
  const sqMax = (spacing + tol) * (spacing + tol);
  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i], i1 = triangles[i+1], i2 = triangles[i+2];
    const [x0, y0] = points[i0];
    const [x1, y1] = points[i1];
    const [x2, y2] = points[i2];
    const d01 = (x0-x1)*(x0-x1) + (y0-y1)*(y0-y1);
    const d12 = (x1-x2)*(x1-x2) + (y1-y2)*(y1-y2);
    const d20 = (x2-x0)*(x2-x0) + (y2-y0)*(y2-y0);
    const dmax = Math.max(d01, d12, d20);
    if (dmax <= sqMax) {
      filtered.push(i0, i1, i2);
    }
  }
  return filtered;
}

/** Morph functions ported from MATLAB */
export function F01_morph(t1,t2,p,H=2*Math.PI) {
  const phi = t1.map((v,i)=>v + t2[i]/2);
  const v   = t2.map(v=>v/(2*Math.PI)*H);
  const x=[],y=[],z=[];
  if (p<=0) {
    for (let i=0;i<phi.length;i++) { x.push(phi[i]); y.push(0); z.push(v[i]); }
  } else if (p>=1) {
    for (let i=0;i<phi.length;i++) { x.push(Math.cos(phi[i])); y.push(Math.sin(phi[i])); z.push(v[i]); }
  } else {
    const R0=1/p;
    for (let i=0;i<phi.length;i++){
      const th=p*phi[i];
      x.push(R0*Math.sin(th));
      y.push(R0*(1-Math.cos(th)));
      z.push(v[i]);
    }
  }
  return {x,y,z};
}
export function F12_morph(t1,t2,p,H=2*Math.PI) {
  const {x:X1,y:Y1,z:Z1}=F01_morph(t1,t2,1,H);
  const x=[],y=[],z=[];
  const theta_full = t2.map(v=>(v+Math.PI)/2);
  if (p<=0) return {x:X1,y:Y1,z:Z1};
  if (p>=1) {
    for (let i=0;i<X1.length;i++){ const tf=theta_full[i]; x.push(X1[i]*Math.cos(tf)-Y1[i]*Math.sin(tf)); y.push(X1[i]*Math.sin(tf)+Y1[i]*Math.cos(tf)); z.push(Z1[i]); }
    return {x,y,z};
  }
  for (let i=0;i<X1.length;i++){ const th=p*theta_full[i]; x.push(X1[i]*Math.cos(th)-Y1[i]*Math.sin(th)); y.push(X1[i]*Math.sin(th)+Y1[i]*Math.cos(th)); z.push(Z1[i]); }
  return {x,y,z};
}
export function F23_morph(t1,t2,p,R=3,r=1) {
  const H=2*Math.PI*R;
  const {x:X2,y:Y2,z:Z2}=F12_morph(t1,t2,1,H);
  if (p<=0) return {x:X2,y:Y2,z:Z2};
  const u=Z2;
  const Rt=R/p;
  const Theta=u.map(v=>v/Rt);
  const x=[],y=[],z=[];
  for (let i=0;i<u.length;i++){
    const th=Theta[i];
    const Cy=Rt*Math.sin(th);
    const Cz=Rt*(1-Math.cos(th));
    const nx=0, ny=Math.cos(th), nz=Math.sin(th);
    x.push(r*Y2[i]);
    y.push(Cy + r*Y2[i]*ny);
    z.push(Cz + r*Y2[i]*nz);
  }
  return {x,y,z};
}
