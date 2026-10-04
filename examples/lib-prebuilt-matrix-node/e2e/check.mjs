import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Matrix } from '@crossbind/example-lib-prebuilt-matrix-node/Matrix.h';

// J₃ * (2*J₃) = 6*J₃: every entry of the product sums three 1 * 2 terms.
const product = new Matrix(9, 1).multiple(new Matrix(9, 2));
assert.deepEqual(Array.from({ length: 9 }, (_, index) => product.get(index)), Array(9).fill(6));
assert.equal(createRequire(import.meta.url)('@crossbind/example-lib-prebuilt-matrix-node/Matrix.h').Matrix, Matrix);
console.log(`ok: matrix on ${process.platform}-${process.arch}`);
