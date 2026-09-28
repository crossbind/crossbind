const initNative = require('../dist/crossbind-example-backend-nodejs-native.native.cjs');

initNative().then(({ Native }) => {
    console.log(`Matrix multiplier with c++ => ${Native.sample()}`);
});
