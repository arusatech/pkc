/**
 * Wire llama-cpp-pro desktop sidecar into Electron (dev + packaged).
 *
 * Dev: binaries live under
 *   /Users/annadata/Project_A/llama-cpp-pro/extraResources/sidecar/
 * Packaged: electron-builder copies those into process.resourcesPath/sidecar/
 */
import fs from 'node:fs';
import path from 'node:path';
import type { App, IpcMain } from 'electron';

/** Canonical plugin root while co-developing (before npm publish). */
export const LLAMA_CPP_PRO_ROOT = '/Users/annadata/Project_A/llama-cpp-pro';

export function getLlamaExtraResourcesDir(app: App): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.join(LLAMA_CPP_PRO_ROOT, 'extraResources');
}

export function expectSidecarBinary(resourcesDir: string): string {
  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === 'win32' ? '.exe' : '';
  const binary = path.join(resourcesDir, 'sidecar', `${platform}-${arch}${ext}`);
  if (!fs.existsSync(binary)) {
    throw new Error(
      `llama-cpp-pro sidecar missing at ${binary}. ` +
        `From llama-cpp-pro run: npm run build:sidecar && npm run stage:desktop`,
    );
  }
  return binary;
}

export function registerLlamaDesktop(opts: { ipcMain: IpcMain; app: App }): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const desktop = require('llama-cpp-pro/desktop') as {
    registerLlamaDesktopIpc?: (o: {
      ipcMain: IpcMain;
      app: App;
      deps: { resourcesPath: string };
    }) => void;
    resolveBinaryPath?: (deps: { resourcesPath: string }) => string;
  };

  if (typeof desktop.registerLlamaDesktopIpc !== 'function') {
    throw new Error('llama-cpp-pro/desktop.registerLlamaDesktopIpc is not available');
  }

  const resourcesPath = getLlamaExtraResourcesDir(opts.app);
  const binary = expectSidecarBinary(resourcesPath);

  desktop.registerLlamaDesktopIpc({
    ipcMain: opts.ipcMain,
    app: opts.app,
    deps: { resourcesPath },
  });

  const resolved =
    typeof desktop.resolveBinaryPath === 'function'
      ? desktop.resolveBinaryPath({ resourcesPath })
      : binary;

  console.log('[electron] llama-cpp-pro desktop IPC ready', {
    resourcesPath,
    binary: resolved,
    packaged: opts.app.isPackaged,
  });
}
