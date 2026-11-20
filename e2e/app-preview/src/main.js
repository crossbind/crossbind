// The page e2e/desktop-app/e2e/preview.mjs previews: what its checks read comes from preview-check.js, and the
// extension's page module imports crossbind/app from a module Vite's dependency optimizer bundles.
import '@crossbind/extension-clipboard';
import { checkPreview } from './preview-check.js';

checkPreview();
