import assert from 'assert';
import { rotate2d } from './torusUtils.js';

function approxEqual(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

const tests = [
  { p: [[0,0]],       alpha: Math.PI/3,  exp: [[0,0]] },
  { p: [[1,0]],       alpha: Math.PI/2,  exp: [[0,1]] },
  { p: [[0,1]],       alpha: Math.PI,    exp: [[0,-1]] },
  { p: [[1,1],[-1,0]], alpha: Math.PI/4, exp: [[0,Math.SQRT2],[-Math.SQRT2/2,-Math.SQRT2/2]] }
];

for (const {p, alpha, exp} of tests) {
  const res = rotate2d(p, alpha);
  for (let i = 0; i < res.length; i++) {
    for (let j = 0; j < 2; j++) {
      assert(
        approxEqual(res[i][j], exp[i][j]),
        `Mismatch for input ${JSON.stringify(p[i])} at [${i}][${j}]: got ${res[i][j]}, expected ${exp[i][j]}`
      );
    }
  }
}

console.log('All rotate2d tests passed.');