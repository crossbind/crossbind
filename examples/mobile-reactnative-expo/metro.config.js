// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const crossbind = require('crossbind');

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = crossbind(getDefaultConfig(__dirname));
