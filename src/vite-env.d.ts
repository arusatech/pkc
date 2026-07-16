/// <reference types="vite/client" />

interface WindowControls {
  close: () => Promise<void>;
  minimize: () => Promise<void>;
}

interface AcharyaDownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

interface AcharyaFsApi {
  getRootDir: () => Promise<string>;
  exists: (relativePath: string) => Promise<boolean>;
  stat: (relativePath: string) => Promise<{ path: string; sizeBytes: number } | null>;
  readText: (relativePath: string) => Promise<string | null>;
  writeText: (relativePath: string, text: string) => Promise<void>;
  writeBytes: (relativePath: string, base64: string) => Promise<string>;
  unlink: (relativePath: string) => Promise<void>;
  downloadUrl: (
    url: string,
    relativePath: string,
    onProgress?: (progress: AcharyaDownloadProgress) => void,
  ) => Promise<{ path: string; sizeBytes: number }>;
}

type PkcCloudProvider = "google" | "dropbox";

interface PkcExportApi {
  oauthRedirectUri: () => Promise<string>;
  saveDialog: (opts: {
    defaultPath: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;
  writeAbsolute: (absolutePath: string, base64: string) => Promise<string>;
  reveal: (absolutePath: string) => Promise<boolean>;
  authStatus: (
    provider: PkcCloudProvider,
  ) => Promise<{ signedIn: boolean; accountLabel: string | null }>;
  signIn: (opts: {
    provider: PkcCloudProvider;
    clientId: string;
    clientSecret?: string;
  }) => Promise<{ accountLabel?: string }>;
  signOut: (provider: PkcCloudProvider) => Promise<boolean>;
  uploadCloud: (opts: {
    provider: PkcCloudProvider;
    filename: string;
    base64: string;
    clientId: string;
    clientSecret?: string;
  }) => Promise<{
    provider: PkcCloudProvider;
    id: string;
    name: string;
    link: string | null;
    path: string;
  }>;
}

interface Window {
  windowControls?: WindowControls;
  acharyaFs?: AcharyaFsApi;
  pkcExport?: PkcExportApi;
}
