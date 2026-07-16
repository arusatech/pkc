import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const stubs = resolve(root, "src/stubs");

export default defineConfig({
  root,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    target: "esnext",
  },
  server: { port: 5173, open: true },
  resolve: {
    alias: {
      // Canonical sibling package (not under ref-code/).
      "llama-cpp-pro": "/Users/annadata/Project_A/llama-cpp-pro/dist/esm/index.js",
      "node:fs/promises": resolve(stubs, "fs-promises.ts"),
      "fs/promises": resolve(stubs, "fs-promises.ts"),
      "node:fs": resolve(stubs, "fs.ts"),
      fs: resolve(stubs, "fs.ts"),
      "node:path": resolve(stubs, "path.ts"),
      path: resolve(stubs, "path.ts"),
      "node:os": resolve(stubs, "empty.ts"),
      os: resolve(stubs, "empty.ts"),
      "stream/promises": resolve(stubs, "empty.ts"),
      "node:stream": resolve(stubs, "empty.ts"),
      stream: resolve(stubs, "empty.ts"),
      "node:http": resolve(stubs, "empty.ts"),
      http: resolve(stubs, "empty.ts"),
      "node:https": resolve(stubs, "empty.ts"),
      https: resolve(stubs, "empty.ts"),
      "node:net": resolve(stubs, "empty.ts"),
      net: resolve(stubs, "empty.ts"),
      "node:tls": resolve(stubs, "empty.ts"),
      tls: resolve(stubs, "empty.ts"),
      "node:url": resolve(stubs, "empty.ts"),
      url: resolve(stubs, "empty.ts"),
      "node:assert": resolve(stubs, "empty.ts"),
      assert: resolve(stubs, "empty.ts"),
      "node:module": resolve(stubs, "empty.ts"),
      module: resolve(stubs, "empty.ts"),
    },
  },
  optimizeDeps: {
    // Prebundle llama so Cap web/desktop implementations resolve under Vite.
    exclude: ["mupdf"],
    include: ["buffer", "fflate", "llama-cpp-pro"],
  },
  // Serve packaged wasm/workers for WASM fallback (desktop prefers sidecar).
  publicDir: resolve(root, "public"),
});
