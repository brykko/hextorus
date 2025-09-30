import assert from 'assert';
import { gridNodes } from './torusUtils.js';

function approxEqual(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

// --- Test: zero rings ---
{
  const pts = gridNodes(0);
  assert.strictEqual(pts.length, 1);
  assert(approxEqual(pts[0][0], 0) && approxEqual(pts[0][1], 0),
         `Expected [0,0], got [${pts[0]}]`);
}

// --- Test: one ring ---
{
  const pts = gridNodes(1);
  assert.strictEqual(pts.length, 7, `Expected 7 points, got ${pts.length}`);
  // second point → [1,0]
  assert(
    approxEqual(pts[1][0], 1) && approxEqual(pts[1][1], 0),
    `pts[1] = [${pts[1]}], expected [1,0]`
  );
  // third point → [1/2, √3/2]
  const expX = 0.5;
  const expY = Math.sqrt(3) / 2;
  assert(
    approxEqual(pts[2][0], expX) && approxEqual(pts[2][1], expY),
    `pts[2] = [${pts[2]}], expected [${expX},${expY}]`
  );
}

// --- Test: two rings count ---
{
  const pts = gridNodes(2);
  assert.strictEqual(
    pts.length, 19,
    `Expected 19 points for 2 rings, got ${pts.length}`
  );
}

console.log('All gridNodes tests passed.');