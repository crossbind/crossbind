module.exports = {
  preset: '@react-native/jest-preset',
  // pnpm keeps packages under node_modules/.pnpm, which the preset's pattern does not look past.
  transformIgnorePatterns: ['node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?)/)'],
  moduleNameMapper: { '\\.h$': '<rootDir>/__mocks__/native-header.js' },
};
