/**
 * Wire llama-cpp-pro desktop sidecar into Electron (dev + packaged).
 */
import type { App, IpcMain } from 'electron';

type LlamaDesktop = {
  registerLlamaDesktopIpc: (o: {
    ipcMain: IpcMain;
    app: App;
    deps: { resourcesPath: string };
  }) => void;
  getResourcesPathForApp: (app: App) => string;
  assertSidecarBinary: (resourcesPath: string) => string;
  resolveBinaryPath: (deps: { resourcesPath: string }) => string;
};

export function registerLlamaDesktop(opts: { ipcMain: IpcMain; app: App }): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const desktop = require('llama-cpp-pro/desktop') as LlamaDesktop;

  const resourcesPath = desktop.getResourcesPathForApp(opts.app);
  const binary = desktop.assertSidecarBinary(resourcesPath);

  desktop.registerLlamaDesktopIpc({
    ipcMain: opts.ipcMain,
    app: opts.app,
    deps: { resourcesPath },
  });

  const resolved = desktop.resolveBinaryPath({ resourcesPath });

  console.log('[electron] llama-cpp-pro desktop IPC ready', {
    resourcesPath,
    binary: resolved || binary,
    packaged: opts.app.isPackaged,
  });
}
