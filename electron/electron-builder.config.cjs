/**
 * PKC electron-builder config — merges llama-cpp-pro desktop sidecar + wasm
 * extraResources from the installed (or file-linked) plugin package.
 */
const llamaDesktop = require('llama-cpp-pro/desktop/electron-builder');

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

module.exports = llamaDesktop.merge(base);
