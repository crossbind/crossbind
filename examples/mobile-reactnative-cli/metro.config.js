const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const crossbind = require('crossbind');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
    watchFolders: [require('path').resolve('../../')] /* Delete this line for create-crossbind */,
};

module.exports = crossbind(mergeConfig(getDefaultConfig(__dirname), config));
