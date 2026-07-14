/**
 * All host downloads land under `<os temp>/AcharyaAnnadata/`.
 * Unix → `/tmp/AcharyaAnnadata` (predictable for tools & users).
 * Windows → `%TEMP%\AcharyaAnnadata`.
 */

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';

export const ACHARYA_DOWNLOADS_DIR_NAME = 'AcharyaAnnadata';

export function getAcharyaDownloadsRoot(): string {
  // Prefer /tmp on Unix so paths stay stable for tooling (Node's tmpdir() is often
  // under /var/folders/... on macOS).
  if (process.platform === 'win32') {
    return join(tmpdir(), ACHARYA_DOWNLOADS_DIR_NAME);
  }
  return join('/tmp', ACHARYA_DOWNLOADS_DIR_NAME);
}

function resolveUnderRoot(relativePath: string): string {
  const root = resolve(getAcharyaDownloadsRoot());
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const dest = resolve(root, cleaned);
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new Error(`Path escapes AcharyaAnnadata root: ${relativePath}`);
  }
  return dest;
}

async function ensureParent(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

type ProgressPayload = {
  downloadId: string;
  loaded: number;
  total: number;
  percentage: number;
};

export function registerAcharyaFsIpc(): void {
  ipcMain.handle('acharya-fs:get-root', async () => {
    const root = getAcharyaDownloadsRoot();
    await mkdir(root, { recursive: true });
    return root;
  });

  ipcMain.handle('acharya-fs:exists', async (_event, relativePath: string) => {
    return existsSync(resolveUnderRoot(relativePath));
  });

  ipcMain.handle('acharya-fs:read-text', async (_event, relativePath: string) => {
    try {
      return await readFile(resolveUnderRoot(relativePath), 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('acharya-fs:write-text', async (_event, relativePath: string, text: string) => {
    const dest = resolveUnderRoot(relativePath);
    await ensureParent(dest);
    await writeFile(dest, text, 'utf8');
  });

  ipcMain.handle('acharya-fs:write-bytes', async (_event, relativePath: string, base64: string) => {
    const dest = resolveUnderRoot(relativePath);
    await ensureParent(dest);
    await writeFile(dest, Buffer.from(base64, 'base64'));
    return dest;
  });

  ipcMain.handle('acharya-fs:unlink', async (_event, relativePath: string) => {
    try {
      await unlink(resolveUnderRoot(relativePath));
    } catch {
      /* ignore missing */
    }
  });

  ipcMain.handle(
    'acharya-fs:download-url',
    async (
      event: IpcMainInvokeEvent,
      payload: { url: string; relativePath: string; downloadId: string },
    ) => {
      const { url, relativePath, downloadId } = payload;
      if (!url || !relativePath || !downloadId) {
        throw new Error('url, relativePath, and downloadId are required');
      }

      const dest = resolveUnderRoot(relativePath);
      await ensureParent(dest);
      const partial = `${dest}.partial`;

      let res: Response;
      try {
        res = await fetch(url);
      } catch (err) {
        throw new Error(`Download failed: ${String(err)}`);
      }
      if (!res.ok) {
        throw new Error(`Download failed: HTTP ${res.status}`);
      }

      const total = Number(res.headers.get('content-length') ?? 0);
      let loaded = 0;
      const sendProgress = () => {
        const percentage = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        const body: ProgressPayload = { downloadId, loaded, total: total || loaded, percentage };
        event.sender.send('acharya-fs:download-progress', body);
      };

      try {
        if (existsSync(partial)) await unlink(partial).catch(() => undefined);
        const out = createWriteStream(partial);

        if (!res.body) {
          const buf = Buffer.from(await res.arrayBuffer());
          await new Promise<void>((resolvePromise, reject) => {
            out.write(buf, (err) => (err ? reject(err) : resolvePromise()));
          });
          loaded = buf.byteLength;
          sendProgress();
          await new Promise<void>((resolvePromise, reject) => {
            out.end(() => resolvePromise());
            out.on('error', reject);
          });
        } else {
          const nodeReadable = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
          nodeReadable.on('data', (chunk: Buffer) => {
            loaded += chunk.length;
            sendProgress();
          });
          await pipeline(nodeReadable, out);
        }

        await rename(partial, dest);
        sendProgress();
        event.sender.send('acharya-fs:download-progress', {
          downloadId,
          loaded,
          total: total || loaded,
          percentage: 100,
        } satisfies ProgressPayload);

        return { path: dest, sizeBytes: loaded };
      } catch (err) {
        await unlink(partial).catch(() => undefined);
        throw err;
      }
    },
  );
}
