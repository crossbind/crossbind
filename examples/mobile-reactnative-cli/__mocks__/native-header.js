// A test renders the app without its native module: the header's exports as the app uses them.
module.exports = {
  initNative: () => Promise.resolve(),
  Native: { sample: () => 'hello' },
};
