// Workspace only: ESLint 8 takes the closest flat config, which inside this repository is the
// monorepo's own ESLint 10 setup. This gives the fixture React Native's own rules, as its
// .eslintrc.js does anywhere else. The legacy CLI skips dotfiles; flat config has to be told.
import reactNative from '@react-native/eslint-config/flat';

export default [{ ignores: ['**/.*'] }, ...reactNative];
