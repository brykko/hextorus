import assert from 'assert';
import { constrainedDelaunay } from './torusUtils.js';

function normalize(tris) {
  // sort indices within each triangle, then sort list of triangles
  return tris
    .map(t => t.slice().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

// Test data
const P = [
  [0, 0],
  [1, 0],
  [0, 1]
];

// Case 1: limit = 2 → triangle should be included
{
  const tris = constrainedDelaunay(P, 2);
  const exp  = [[1, 2, 3]];
  assert.deepStrictEqual(normalize(tris), normalize(exp));
}

// Case 2: limit = 1 → triangle should be excluded
{
  const tris = constrainedDelaunay(P, 1);
  assert.strictEqual(tris.length, 0);
}

console.log('All constrainedDelaunay tests passed.');