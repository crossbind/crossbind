// Workspace only: ESLint 8 takes the closest flat config, which inside this repository is the
// monorepo's own ESLint 10 setup. create-crossbind leaves this file out, so a scaffolded project
// keeps React Native's .eslintrc.js. The legacy CLI skips dotfiles; flat config has to be told.
import reactNative from '@react-native/eslint-config/flat';

export default [{ ignores: ['**/.*'] }, ...reactNative];
