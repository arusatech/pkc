/**
 * PKC electron-builder config — merges llama-cpp-pro desktop sidecar + wasm
 * extraResources from the installed (or file-linked) plugin package.
 *
 * Outputs land in electron/release/ (DMG/zip on macOS, NSIS Setup.exe on Windows).
 * Windows Authenticode: Certum via electron/signing/win-certum.cjs (env-driven).
 */
const llamaDesktop = require('llama-cpp-pro/desktop/electron-builder');
const { winSigningFromEnv } = require('./signing/win-certum.cjs');

const winSign = winSigningFromEnv();

const base = {
  appId: 'ai.annadata.pkc',
  productName: 'PKC',
  copyright: 'Copyright © Acharya Annadata',
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  directories: {
    buildResources: 'resources',
    output: 'release',
  },
  files: ['assets/**/*', 'build/**/*', 'capacitor.config.*', 'app/**/*'],
  nsis: {
    allowElevation: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    artifactName: '${productName}-${version}-win-${arch}-setup.${ext}',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/appIcon.ico',
    ...winSign,
  },
  mac: {
    category: 'public.app-category.productivity',
    // Separate arch DMGs — universal merge fails because each arch ships its own
    // llama sidecar binary (darwin-arm64 vs darwin-x64) under extraResources.
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    icon: 'assets/appIcon.png',
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
    icon: 'assets/appIcon.png',
  },
};

/** llamaDesktop.merge() overwrites platform blocks; restore app targets/icons. */
function mergePreservingAppTargets(appBase) {
  const merged = llamaDesktop.merge(appBase);
  for (const platform of ['mac', 'win', 'linux']) {
    if (!appBase[platform]) continue;
    merged[platform] = {
      ...merged[platform],
      ...appBase[platform],
      extraResources: merged[platform]?.extraResources ?? appBase[platform].extraResources ?? [],
    };
  }
  if (appBase.nsis) {
    merged.nsis = { ...merged.nsis, ...appBase.nsis };
  }
  if (appBase.directories) {
    merged.directories = { ...merged.directories, ...appBase.directories };
  }
  return merged;
}

module.exports = mergePreservingAppTargets(base);
