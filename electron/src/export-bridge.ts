/**
 * Export destinations: Save-as / absolute writes, reveal-in-folder, OAuth + cloud upload.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';

import { getAcharyaDownloadsRoot } from './acharya-fs';

const OAUTH_LOOPBACK_PORT = 17865;
const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_LOOPBACK_PORT}/oauth/callback`;

type CloudProvider = 'google' | 'dropbox';

type TokenBundle = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountLabel?: string;
  tokenType?: string;
};

type OAuthProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
};

const PROVIDERS: Record<CloudProvider, OAuthProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  dropbox: {
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['files.content.write', 'account_info.read'],
    extraAuthParams: { token_access_type: 'offline' },
  },
};

function base64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function authFilePath(provider: CloudProvider): string {
  return join(getAcharyaDownloadsRoot(), 'auth', `${provider}.token`);
}

async function writeTokenFile(provider: CloudProvider, bundle: TokenBundle): Promise<void> {
  const path = authFilePath(provider);
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(bundle);
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json);
    await writeFile(path, Buffer.concat([Buffer.from('ENC1'), enc]));
  } else {
    await writeFile(path, json, 'utf8');
  }
}

async function readTokenFile(provider: CloudProvider): Promise<TokenBundle | null> {
  try {
    const raw = await readFile(authFilePath(provider));
    if (raw.length >= 4 && raw.subarray(0, 4).toString('utf8') === 'ENC1') {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const json = safeStorage.decryptString(raw.subarray(4));
      return JSON.parse(json) as TokenBundle;
    }
    return JSON.parse(raw.toString('utf8')) as TokenBundle;
  } catch {
    return null;
  }
}

async function clearTokenFile(provider: CloudProvider): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(authFilePath(provider));
  } catch {
    /* ignore */
  }
}

function waitForOAuthCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', OAUTH_REDIRECT_URI);
        if (url.pathname !== '/oauth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const err = url.searchParams.get('error');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><p>Sign-in failed: ${err}</p><p>You can close this window.</p></body></html>`);
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        const state = url.searchParams.get('state') ?? '';
        const code = url.searchParams.get('code') ?? '';
        if (!code || state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><p>Invalid OAuth response.</p></body></html>');
          server.close();
          reject(new Error('Invalid OAuth state or missing code'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body style="font-family:system-ui;padding:2rem"><p>Signed in. You can close this window and return to PKC.</p></body></html>',
        );
        server.close();
        resolve(code);
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.on('error', reject);
    server.listen(OAUTH_LOOPBACK_PORT, '127.0.0.1');

    setTimeout(() => {
      server.close();
      reject(new Error('Sign-in timed out (3 minutes)'));
    }, 180_000);
  });
}

async function exchangeCode(opts: {
  provider: CloudProvider;
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
}): Promise<TokenBundle> {
  const cfg = PROVIDERS[opts.provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: OAUTH_REDIRECT_URI,
    client_id: opts.clientId,
    code_verifier: opts.codeVerifier,
  });
  if (opts.clientSecret) body.set('client_secret', opts.clientSecret);

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new Error(
      `Token exchange failed: ${typeof json.error === 'string' ? json.error : res.status}`,
    );
  }

  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : undefined;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}

async function refreshAccessToken(
  provider: CloudProvider,
  clientId: string,
  clientSecret: string | undefined,
  refreshToken: string,
): Promise<TokenBundle | null> {
  const cfg = PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') return null;

  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : undefined;
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === 'string' ? json.refresh_token : refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}

async function fetchAccountLabel(
  provider: CloudProvider,
  accessToken: string,
): Promise<string | undefined> {
  try {
    if (provider === 'google') {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return undefined;
      const json = (await res.json()) as { email?: string; name?: string };
      return json.email || json.name;
    }
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { email?: string; name?: { display_name?: string } };
    return json.email || json.name?.display_name;
  } catch {
    return undefined;
  }
}

async function ensureValidToken(
  provider: CloudProvider,
  clientId: string,
  clientSecret?: string,
): Promise<TokenBundle> {
  let bundle = await readTokenFile(provider);
  if (!bundle?.accessToken) {
    throw new Error(`Not signed in to ${provider}. Choose Sign in first.`);
  }

  const needsRefresh =
    bundle.expiresAt != null && bundle.expiresAt < Date.now() + 60_000 && bundle.refreshToken;
  if (needsRefresh && bundle.refreshToken) {
    const refreshed = await refreshAccessToken(
      provider,
      clientId,
      clientSecret,
      bundle.refreshToken,
    );
    if (refreshed) {
      refreshed.accountLabel = bundle.accountLabel;
      await writeTokenFile(provider, refreshed);
      bundle = refreshed;
    }
  }
  return bundle;
}

async function uploadToGoogleDrive(
  accessToken: string,
  filename: string,
  bytes: Buffer,
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const metadata = JSON.stringify({ name: filename, mimeType: 'application/octet-stream' });
  const boundary = `pkc_${randomBytes(8).toString('hex')}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const closing = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([preamble, bytes, closing]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
    },
  );
  const json = (await res.json()) as {
    id?: string;
    name?: string;
    webViewLink?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message ?? `Google Drive upload failed (${res.status})`);
  }
  return { id: json.id, name: json.name ?? filename, webViewLink: json.webViewLink };
}

async function uploadToDropbox(
  accessToken: string,
  filename: string,
  bytes: Buffer,
): Promise<{ path: string; id: string }> {
  const destPath = `/PKC Exports/${filename}`;
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: destPath,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
    },
    body: new Uint8Array(bytes),
  });
  const json = (await res.json()) as {
    path_display?: string;
    id?: string;
    error_summary?: string;
  };
  if (!res.ok || !json.id) {
    throw new Error(json.error_summary ?? `Dropbox upload failed (${res.status})`);
  }
  return { path: json.path_display ?? destPath, id: json.id };
}

async function runSignIn(opts: {
  provider: CloudProvider;
  clientId: string;
  clientSecret?: string;
}): Promise<{ accountLabel?: string }> {
  if (!opts.clientId?.trim()) {
    throw new Error(
      opts.provider === 'google'
        ? 'Add a Google OAuth Client ID in Settings first.'
        : 'Add a Dropbox App key in Settings first.',
    );
  }

  const cfg = PROVIDERS[opts.provider];
  const state = base64Url(randomBytes(16));
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());

  const authUrl = new URL(cfg.authorizeUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', opts.clientId.trim());
  authUrl.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  authUrl.searchParams.set('scope', cfg.scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) {
    authUrl.searchParams.set(k, v);
  }

  const codePromise = waitForOAuthCode(state);

  const win = new BrowserWindow({
    width: 520,
    height: 720,
    title: opts.provider === 'google' ? 'Sign in with Google' : 'Sign in with Dropbox',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  void win.loadURL(authUrl.toString());

  let code: string;
  try {
    code = await codePromise;
  } finally {
    if (!win.isDestroyed()) win.close();
  }

  const bundle = await exchangeCode({
    provider: opts.provider,
    code,
    codeVerifier,
    clientId: opts.clientId.trim(),
    clientSecret: opts.clientSecret?.trim() || undefined,
  });
  bundle.accountLabel = await fetchAccountLabel(opts.provider, bundle.accessToken);
  await writeTokenFile(opts.provider, bundle);
  return { accountLabel: bundle.accountLabel };
}

export function registerExportBridgeIpc(): void {
  const channels = [
    'pkc-export:save-dialog',
    'pkc-export:write-absolute',
    'pkc-export:reveal',
    'pkc-export:auth-status',
    'pkc-export:sign-in',
    'pkc-export:sign-out',
    'pkc-export:upload-cloud',
    'pkc-export:oauth-redirect-uri',
  ] as const;

  for (const ch of channels) {
    ipcMain.removeHandler(ch);
  }

  ipcMain.handle('pkc-export:oauth-redirect-uri', () => OAUTH_REDIRECT_URI);

  ipcMain.handle(
    'pkc-export:save-dialog',
    async (_event, opts: { defaultPath: string; filters?: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showSaveDialog({
        title: 'Export PKC',
        defaultPath: opts.defaultPath,
        filters: opts.filters ?? [{ name: 'PKC', extensions: ['pkc'] }],
      });
      if (result.canceled || !result.filePath) return null;
      return result.filePath;
    },
  );

  ipcMain.handle(
    'pkc-export:write-absolute',
    async (_event, opts: { absolutePath: string; base64: string }) => {
      if (!opts.absolutePath || !opts.base64) throw new Error('absolutePath and base64 required');
      await mkdir(dirname(opts.absolutePath), { recursive: true });
      await writeFile(opts.absolutePath, Buffer.from(opts.base64, 'base64'));
      return opts.absolutePath;
    },
  );

  ipcMain.handle('pkc-export:reveal', async (_event, absolutePath: string) => {
    if (!absolutePath) return false;
    shell.showItemInFolder(absolutePath);
    return true;
  });

  ipcMain.handle('pkc-export:auth-status', async (_event, provider: CloudProvider) => {
    const bundle = await readTokenFile(provider);
    return {
      signedIn: !!bundle?.accessToken,
      accountLabel: bundle?.accountLabel ?? null,
    };
  });

  ipcMain.handle(
    'pkc-export:sign-in',
    async (
      _event,
      opts: { provider: CloudProvider; clientId: string; clientSecret?: string },
    ) => {
      return runSignIn(opts);
    },
  );

  ipcMain.handle('pkc-export:sign-out', async (_event, provider: CloudProvider) => {
    await clearTokenFile(provider);
    return true;
  });

  ipcMain.handle(
    'pkc-export:upload-cloud',
    async (
      _event,
      opts: {
        provider: CloudProvider;
        filename: string;
        base64: string;
        clientId: string;
        clientSecret?: string;
      },
    ) => {
      const bundle = await ensureValidToken(
        opts.provider,
        opts.clientId,
        opts.clientSecret,
      );
      const bytes = Buffer.from(opts.base64, 'base64');
      if (opts.provider === 'google') {
        const file = await uploadToGoogleDrive(bundle.accessToken, opts.filename, bytes);
        return {
          provider: 'google' as const,
          id: file.id,
          name: file.name,
          link: file.webViewLink ?? null,
          path: file.webViewLink ?? file.name,
        };
      }
      const file = await uploadToDropbox(bundle.accessToken, opts.filename, bytes);
      return {
        provider: 'dropbox' as const,
        id: file.id,
        name: opts.filename,
        link: null,
        path: file.path,
      };
    },
  );
}
