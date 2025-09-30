import assert from 'assert';
import { F12_morph, F01_morph } from './torusUtils.js';

function approx(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

// --- Test 1: p=0 → no twist, matches F01_morph at p=1 ---
{
  const tp = [[Math.PI/4, 0]];
  const out12 = F12_morph(tp, 0);
  const out01 = F01_morph(tp, 1);
  for (let i = 0; i < 3; i++) {
    assert(
      approx(out12[0][i], out01[0][i]),
      `p=0 mismatch at index ${i}: got ${out12[0][i]}, expected ${out01[0][i]}`
    );
  }
}

// --- Test 2: p=1 → full half-twist ---
{
  const tp = [[Math.PI/4, 0]];
  const [[X1, Y1, Z1]] = F01_morph(tp, 1);
  const [[x12, y12, z12]] = F12_morph(tp, 1);
  const theta_full = (0 + Math.PI) / 2;  // pi/2
  const expX = X1 * Math.cos(theta_full) - Y1 * Math.sin(theta_full);
  const expY = X1 * Math.sin(theta_full) + Y1 * Math.cos(theta_full);
  assert(approx(x12, expX), `p=1 x: got ${x12}, expected ${expX}`);
  assert(approx(y12, expY), `p=1 y: got ${y12}, expected ${expY}`);
  assert(approx(z12, Z1), `p=1 z: got ${z12}, expected ${Z1}`);
}

// --- Test 3: custom H propagates into z for p=0 ---
{
  const tp = [[0, Math.PI/2]];
  const H  = 4 * Math.PI;
  const [[, , z12]] = F12_morph(tp, 0, H);
  const expectedZ = (Math.PI/2) / (2 * Math.PI) * H * (Math.sqrt(3) / 2);
  assert(approx(z12, expectedZ), `custom H z: got ${z12}, expected ${expectedZ}`);
}

console.log('All F12_morph tests passed.');