const matrix = require('@crossbind/example-lib-prebuilt-matrix/node/napi');

matrix.initNative().then(() => {
    const product = new matrix.Matrix(9, 1).multiple(new matrix.Matrix(9, 2));
    console.log(`Matrix multiplier with c++ => J₃ * (2*J₃) = ${product.get(0)}*J₃`);
});
