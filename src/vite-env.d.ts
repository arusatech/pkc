/// <reference types="vite/client" />

interface WindowControls {
  close: () => Promise<void>;
  minimize: () => Promise<void>;
}

interface Window {
  windowControls?: WindowControls;
}
