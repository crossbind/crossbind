import { initNative, Matrix } from '@crossbind/example-lib-prebuilt-matrix/node/napi';

await initNative();
const product = new Matrix(9, 1).multiple(new Matrix(9, 2));
console.log(`Matrix multiplier with c++ => J₃ * (2*J₃) = ${product.get(0)}*J₃`);
