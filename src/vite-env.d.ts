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

interface Window {
  windowControls?: WindowControls;
  acharyaFs?: AcharyaFsApi;
}
