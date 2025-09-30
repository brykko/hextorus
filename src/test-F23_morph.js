import assert from 'assert';
import { F23_morph, F12_morph } from './torusUtils.js';

function approx(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

// --- Test 1: p=0 identity with F12_morph ---
{
  const tp   = [[0, 0]];
  const out1 = F23_morph(tp, 0);
  const H    = 2 * Math.PI;  
  const out2 = F12_morph(tp, 1, H);
  for (let i = 0; i < 3; i++) {
    assert(
      approx(out1[0][i], out2[0][i]),
      `p=0 mismatch idx ${i}: got ${out1[0][i]}, expected ${out2[0][i]}`
    );
  }
}

// --- Test 2: full morph, center anchor ---
{
  const tp   = [[0, 0]];
  const [ [x, y, z] ] = F23_morph(tp, 1);
  assert(approx(x, -0.5), `x center: got ${x}, expected -0.5`);
  assert(approx(y,  0.0), `y center: got ${y}, expected 0`);
  assert(approx(z,  0.0), `z center: got ${z}, expected 0`);
}

// --- Test 3: full morph, bottom anchor ---
{
  const tp     = [[0, 0]];
  const [ [x, y, z] ] = F23_morph(tp, 1, 1, 2, 'bottom');
  const expX   = -Math.cos(1) / 2;
  const expY   =  0;
  const expZ   =  Math.sin(1) / 2;
  assert(approx(x, expX), `x bottom: got ${x}, expected ${expX}`);
  assert(approx(y, expY), `y bottom: got ${y}, expected ${expY}`);
  assert(approx(z, expZ), `z bottom: got ${z}, expected ${expZ}`);
}

console.log('All F23_morph tests passed.');