import assert from 'assert';
import { hexPhaseTile } from './torusUtils.js';

function approxEqual(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

const P = hexPhaseTile();
const r = 1 / Math.sqrt(3);

// Test 1: six vertices
assert.strictEqual(P.length, 6, 'Should return 6 vertices');

// Test 2: each vertex at distance r from origin
P.forEach(([x, y], i) => {
  const dist = Math.hypot(x, y);
  assert(
    approxEqual(dist, r),
    `Vertex ${i} distance ${dist} ≠ ${r}`
  );
});

// Test 3: first vertex is (0, r)
assert(approxEqual(P[0][0], 0), `P[0][0] = ${P[0][0]} ≠ 0`);
assert(approxEqual(P[0][1], r), `P[0][1] = ${P[0][1]} ≠ ${r}`);

console.log('All hexPhaseTile tests passed.');