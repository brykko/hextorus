import assert from 'assert';
import { gridCellPdf } from './torusUtils.js';

function approx(a, b, tol = 1e-10) {
  return Math.abs(a - b) < tol;
}

// Helper to build meshgrid
function meshgrid(range) {
  const X = [], Y = [];
  for (let i = 0; i < range.length; i++) {
    X.push([]);
    Y.push([]);
    for (let j = 0; j < range.length; j++) {
      X[i].push(range[j]);
      Y[i].push(range[i]);
    }
  }
  return [X, Y];
}

// --- Test 1: Single peak centered ---
{
  const [X, Y] = meshgrid([-0.1, 0, 0.1]);
  const Z = gridCellPdf(X, Y, [0, 0], 0.1);
  let maxVal = -Infinity, maxIdx = null;
  for (let i = 0; i < Z.length; i++) {
    for (let j = 0; j < Z[0].length; j++) {
      if (Z[i][j] > maxVal) {
        maxVal = Z[i][j];
        maxIdx = [i, j];
      }
    }
  }
  assert.deepStrictEqual(maxIdx, [1, 1], 'Peak should be at center [1,1]');
}

// --- Test 2: Symmetry at zero phase ---
{
  const [X, Y] = meshgrid([-0.2, -0.1, 0, 0.1, 0.2]);
  const Z = gridCellPdf(X, Y, [0, 0], 0.1);
  for (let i = 0; i < Z.length; i++) {
    for (let j = 0; j < Z[0].length; j++) {
      assert(
        approx(Z[i][j], Z[j][i]),
        `Symmetry failed at Z[${i}][${j}] vs Z[${j}][${i}]`
      );
    }
  }
}

// --- Test 3: Peak value at phase location ---
{
  const Z = gridCellPdf([[0]], [[0]], [0, 0], 2);
  const expPeak = 1 / (Math.sqrt(2 * Math.PI) * 2);
  assert(
    approx(Z[0][0], expPeak),
    `Peak value ${Z[0][0]} ≠ expected ${expPeak}`
  );
}

console.log('All gridCellPdf tests passed.');