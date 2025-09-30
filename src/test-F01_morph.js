import assert from 'assert';
import { F01_morph } from './torusUtils.js';

function approxEqual(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

// Test 1: flat sheet (p=0), default H
{
  const tp  = [[Math.PI/4, Math.PI/2]];
  const out = F01_morph(tp, 0);
  // expect [nphi, 0, v]
  const nphi = Math.PI/4 + (Math.PI/2)/2;          // = π/2
  const v    = (Math.PI/2)/(2*Math.PI) * (2*Math.PI) * (Math.sqrt(3)/2); // = π√3/4
  const exp  = [nphi, 0, v];
  out[0].forEach((val, i) => {
    assert(
      approxEqual(val, exp[i]),
      `Flat-sheet mismatch at index ${i}: got ${val}, expected ${exp[i]}`
    );
  });
}

// Test 2: full cylinder (p=1)
{
  const tp  = [[Math.PI/4, Math.PI/2]];
  const out = F01_morph(tp, 1);
  const nphi = Math.PI/4 + (Math.PI/2)/2;          // π/2
  const v    = (Math.PI/2)/(2*Math.PI) * (2*Math.PI) * (Math.sqrt(3)/2); // π√3/4
  const xExp = Math.sin(nphi);
  const yExp = (1 - Math.cos(nphi)) - 1;            // = -cos(nphi)
  const exp  = [xExp, yExp, v];
  out[0].forEach((val, i) => {
    assert(
      approxEqual(val, exp[i]),
      `Cylinder mismatch at index ${i}: got ${val}, expected ${exp[i]}`
    );
  });
}

// Test 3: flat sheet with custom H
{
  const tp  = [[Math.PI/4, Math.PI/2]];
  const H   = 4 * Math.PI;
  const out = F01_morph(tp, 0, H);
  const nphi = Math.PI/4 + (Math.PI/2)/2;          // π/2
  const v    = (Math.PI/2)/(2*Math.PI) * H * (Math.sqrt(3)/2);
  const exp  = [nphi, 0, v];
  out[0].forEach((val, i) => {
    assert(
      approxEqual(val, exp[i]),
      `Custom-H mismatch at index ${i}: got ${val}, expected ${exp[i]}`
    );
  });
}

console.log('All F01_morph tests passed.');