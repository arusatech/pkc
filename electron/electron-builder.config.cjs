/**
 * PKC electron-builder config — merges llama-cpp-pro desktop sidecar + wasm
 * extraResources from the co-developed plugin tree.
 */
const path = require('node:path');

const LLAMA_CPP_PRO_ROOT = '/Users/annadata/Project_A/llama-cpp-pro';

// eslint-disable-next-line import/no-dynamic-require
const llamaDesktop = require(path.join(LLAMA_CPP_PRO_ROOT, 'desktop/electron-builder.config.cjs'));

const base = {
  appId: 'ai.annadata.pkc',
  productName: 'PKC',
  directories: {
    buildResources: 'resources',
  },
  files: ['assets/**/*', 'build/**/*', 'capacitor.config.*', 'app/**/*'],
  nsis: {
    allowElevation: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  win: {
    target: ['nsis'],
    icon: 'assets/appIcon.ico',
  },
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg'],
    icon: 'assets/appIcon.png',
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
    icon: 'assets/appIcon.png',
  },
};

module.exports = llamaDesktop.merge(base, { packageRoot: LLAMA_CPP_PRO_ROOT });
