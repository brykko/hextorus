const assert = require('assert');
const {euclidean2torus} = require('./torusUtils.js');

function approxEqual(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

const r       = Math.tan(Math.PI / 3);
const input   = [
  [0, 0],
  [1, 0],
  [0, r / 2]
];
const expected = [
  [0, 0, 0],
  [2 * Math.PI, 0, -2 * Math.PI],
  [-Math.PI, 2 * Math.PI, -Math.PI]
];

const result = euclidean2torus(input);

for (let i = 0; i < result.length; i++) {
  for (let j = 0; j < 3; j++) {
    assert(
      approxEqual(result[i][j], expected[i][j]),
      `Mismatch at [${i}][${j}]: got ${result[i][j]}, expected ${expected[i][j]}`
    );
  }
}

console.log('All euclidean2torus tests passed.');