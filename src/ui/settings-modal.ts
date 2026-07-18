import { loadCloudPrefs, saveCloudPrefs, type CloudExportPrefs } from "../export/cloud-prefs";

const PREF_PACK = "pkc:pref:pack-pkc";
const PREF_COLOR = "pkc:pref:color-mode";

const BACKEND_LABELS: Record<string, string> = {
  "sidecar-gpu": "Native GPU",
  "sidecar-npu": "Native NPU",
  "sidecar-cpu": "Native CPU",
  "wasm-cpu": "WASM CPU",
};

export interface AppPrefs {
  packPkc: boolean;
  colorMode: boolean;
}

export function loadPrefs(): AppPrefs {
  return {
    packPkc: localStorage.getItem(PREF_PACK) !== "0",
    colorMode: localStorage.getItem(PREF_COLOR) === "1",
  };
}

export function savePrefs(prefs: AppPrefs): void {
  localStorage.setItem(PREF_PACK, prefs.packPkc ? "1" : "0");
  localStorage.setItem(PREF_COLOR, prefs.colorMode ? "1" : "0");
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setSidecarClass(text: string, kind: "running" | "stopped" | "unavailable"): void {
  const el = document.getElementById("diag-sidecar");
  if (!el) return;
  el.textContent = text;
  el.className = `diag-value sidecar-${kind}`;
}

type DiagnosisSnapshot = {
  collectedAt: string;
  runtime: string;
  appVersion: string;
  userAgent: string;
  activeModel: string;
  storeRoot: string | null;
  desktop: boolean;
  backendOverride: string | null;
  backendStatus: unknown;
  sidecarStatus: unknown;
  memory: unknown;
  error?: string;
};

async function collectDiagnosis(opts: {
  appVersion: string;
  getActiveModelLabel: () => string;
}): Promise<DiagnosisSnapshot> {
  const snap: DiagnosisSnapshot = {
    collectedAt: new Date().toISOString(),
    runtime: window.__annadataDesktop ? "Electron desktop" : "Browser / Capacitor",
    appVersion: opts.appVersion,
    userAgent: navigator.userAgent,
    activeModel: opts.getActiveModelLabel(),
    storeRoot: null,
    desktop: !!window.__annadataDesktop,
    backendOverride: null,
    backendStatus: null,
    sidecarStatus: null,
    memory: null,
  };

  try {
    if (window.acharyaFs?.getRootDir) {
      snap.storeRoot = await window.acharyaFs.getRootDir();
    }
  } catch {
    /* ignore */
  }

  const llama = window.annadataLlama;
  if (!llama) {
    snap.error = "annadataLlama bridge unavailable (web / no desktop preload)";
    return snap;
  }

  try {
    if (llama.getBackendOverride) {
      snap.backendOverride = await llama.getBackendOverride();
    }
  } catch {
    /* ignore */
  }

  try {
    snap.backendStatus = await llama.getBackendStatus();
  } catch (err) {
    snap.error = err instanceof Error ? err.message : String(err);
  }

  try {
    snap.sidecarStatus = await llama.getSidecarStatus();
  } catch {
    /* ignore */
  }

  try {
    snap.memory = await llama.getMemorySnapshot();
  } catch {
    /* ignore */
  }

  return snap;
}

function applyDiagnosisToUi(snap: DiagnosisSnapshot): void {
  setText("diag-runtime", snap.runtime);
  setText("diag-app", `PKC ${snap.appVersion}`);
  setText("diag-store", snap.storeRoot ?? "— (no Acharya FS bridge)");

  const overrideEl = document.getElementById("diag-backend-override") as HTMLSelectElement | null;
  if (overrideEl && snap.backendOverride) {
    overrideEl.value = snap.backendOverride;
  }

  const mem = snap.memory as {
    totalBytes?: number;
    usedBytes?: number;
    freeBytes?: number;
    pressure?: string;
  } | null;
  if (mem && typeof mem.totalBytes === "number") {
    setText(
      "diag-memory",
      `${formatBytes(mem.usedBytes ?? 0)} used / ${formatBytes(mem.totalBytes)} · ${mem.pressure ?? "—"} pressure`,
    );
  } else {
    setText("diag-memory", snap.desktop ? "—" : "n/a (browser)");
  }

  const backend = snap.backendStatus as {
    selection?: { type?: string; gpuBackend?: string | null; reason?: string; variant?: string | null };
    lastSelection?: { type?: string; gpuBackend?: string | null; reason?: string };
    probe?: { backends?: Array<{ name: string; kind: string; available: boolean; reason?: string }> };
    sidecar?: { running?: boolean; port?: number | null; backend?: string; variant?: string };
    error?: string;
  } | null;

  const selection = backend?.selection ?? backend?.lastSelection;
  if (selection?.type) {
    const label = BACKEND_LABELS[selection.type] || selection.type;
    const gpu = selection.gpuBackend ? ` · ${selection.gpuBackend}` : "";
    setText("diag-active", `${label}${gpu}`);
  } else if (!snap.desktop) {
    setText("diag-active", "WASM / in-process (browser)");
  } else {
    setText("diag-active", snap.error ? "unavailable" : "—");
  }

  const sc = (snap.sidecarStatus as { running?: boolean; port?: number | null; backend?: string } | null)
    ?? backend?.sidecar
    ?? null;
  if (sc && typeof sc.running === "boolean") {
    if (sc.running) {
      const port = sc.port != null ? ` · port ${sc.port}` : "";
      const be = sc.backend ? ` · ${sc.backend}` : "";
      setSidecarClass(`running${port}${be}`, "running");
    } else {
      setSidecarClass("stopped", "stopped");
    }
  } else if (!snap.desktop) {
    setSidecarClass("n/a (no sidecar)", "unavailable");
  } else {
    setSidecarClass("unavailable", "unavailable");
  }

  const probeBackends = backend?.probe?.backends ?? [];
  const available = probeBackends.filter((b) => b.available && b.kind !== "cpu").map((b) => b.name);
  if (available.length) {
    setText("diag-gpu", available.join(", "));
  } else if (selection?.gpuBackend) {
    setText("diag-gpu", selection.gpuBackend);
  } else if (!snap.desktop) {
    setText("diag-gpu", "n/a");
  } else {
    setText("diag-gpu", "none detected");
  }

  const warnEl = document.getElementById("diag-warning");
  if (warnEl) {
    if (selection?.reason && /no gpu|fallback|wasm/i.test(selection.reason)) {
      warnEl.textContent = `⚠ ${selection.reason}`;
      warnEl.hidden = false;
    } else if (snap.error) {
      warnEl.textContent = `⚠ ${snap.error}`;
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
      warnEl.textContent = "";
    }
  }

  const dumpEl = document.getElementById("diag-dump");
  if (dumpEl) {
    dumpEl.textContent = JSON.stringify(snap, null, 2);
  }
}

export function initSettingsModal(opts: {
  getActiveModelLabel: () => string;
  onSave: (prefs: AppPrefs) => void;
  appVersion?: string;
}): void {
  const dialog = document.getElementById("settings-dialog") as HTMLDialogElement;
  const packEl = document.getElementById("pref-pack-pkc") as HTMLInputElement;
  const colorEl = document.getElementById("pref-color-mode") as HTMLInputElement;
  const activeEl = document.getElementById("pref-active-model")!;
  const googleIdEl = document.getElementById("pref-google-client-id") as HTMLInputElement;
  const googleSecretEl = document.getElementById(
    "pref-google-client-secret",
  ) as HTMLInputElement;
  const dropboxKeyEl = document.getElementById("pref-dropbox-app-key") as HTMLInputElement;
  const dropboxSecretEl = document.getElementById(
    "pref-dropbox-app-secret",
  ) as HTMLInputElement;
  const redirectEl = document.getElementById("settings-oauth-redirect");
  const overrideEl = document.getElementById("diag-backend-override") as HTMLSelectElement;
  const noteEl = document.getElementById("diag-note")!;
  const warnGpuEl = document.getElementById("diag-warning")!;
  const appVersion = opts.appVersion ?? "1.0.0";

  let lastSnap: DiagnosisSnapshot | null = null;
  let refreshing = false;
  let applyingOverride = false;

  void window.pkcExport?.oauthRedirectUri().then((uri) => {
    if (redirectEl) redirectEl.textContent = uri;
  });

  const refreshDiagnosis = async () => {
    if (refreshing) return;
    refreshing = true;
    setText("diag-runtime", "checking…");
    try {
      lastSnap = await collectDiagnosis({
        appVersion,
        getActiveModelLabel: opts.getActiveModelLabel,
      });
      applyDiagnosisToUi(lastSnap);
    } finally {
      refreshing = false;
    }
  };

  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "save") return;
    const prefs: AppPrefs = {
      packPkc: packEl.checked,
      colorMode: colorEl.checked,
    };
    savePrefs(prefs);
    const cloud: CloudExportPrefs = {
      googleClientId: googleIdEl.value,
      googleClientSecret: googleSecretEl.value,
      dropboxAppKey: dropboxKeyEl.value,
      dropboxAppSecret: dropboxSecretEl.value,
    };
    saveCloudPrefs(cloud);
    opts.onSave(prefs);
  });

  const syncForm = () => {
    const prefs = loadPrefs();
    packEl.checked = prefs.packPkc;
    colorEl.checked = prefs.colorMode;
    activeEl.textContent = `Active model: ${opts.getActiveModelLabel()}`;
    const cloud = loadCloudPrefs();
    googleIdEl.value = cloud.googleClientId;
    googleSecretEl.value = cloud.googleClientSecret;
    dropboxKeyEl.value = cloud.dropboxAppKey;
    dropboxSecretEl.value = cloud.dropboxAppSecret;
    void refreshDiagnosis();
  };

  document.getElementById("settings-btn")!.addEventListener("click", syncForm);
  document.getElementById("diag-refresh")!.addEventListener("click", () => {
    noteEl.hidden = true;
    void refreshDiagnosis();
  });

  document.getElementById("diag-copy")!.addEventListener("click", async () => {
    if (!lastSnap) await refreshDiagnosis();
    const text = JSON.stringify(lastSnap, null, 2);
    const dumpEl = document.getElementById("diag-dump")!;
    dumpEl.hidden = false;
    dumpEl.textContent = text;
    try {
      await navigator.clipboard.writeText(text);
      noteEl.textContent = "✅ Diagnostics copied to clipboard";
      noteEl.hidden = false;
    } catch {
      noteEl.textContent = "Diagnostics shown below — copy manually";
      noteEl.hidden = false;
    }
  });

  overrideEl.addEventListener("change", async () => {
    if (applyingOverride) return;
    const value = overrideEl.value;
    const llama = window.annadataLlama;
    if (!llama?.setBackendOverride) {
      warnGpuEl.textContent = "⚠ Backend override needs the Electron desktop build";
      warnGpuEl.hidden = false;
      return;
    }

    if (value === "sidecar-gpu" || value === "sidecar-npu") {
      const backends =
        (lastSnap?.backendStatus as { probe?: { backends?: Array<{ name: string; available: boolean; kind: string }> } })
          ?.probe?.backends ?? [];
      const hasAccel = backends.some(
        (b) =>
          b.available &&
          (value === "sidecar-gpu" ? b.kind === "gpu" : b.kind === "npu"),
      );
      if (!hasAccel) {
        warnGpuEl.textContent =
          value === "sidecar-gpu"
            ? "⚠ No GPU detected — will fall back to next available backend."
            : "⚠ No NPU detected — will fall back to next available backend.";
        warnGpuEl.hidden = false;
      }
    }

    applyingOverride = true;
    noteEl.textContent = "⏳ Saving backend override…";
    noteEl.hidden = false;
    try {
      await llama.setBackendOverride(value);
      noteEl.textContent =
        "✅ Override saved. Restart the app (or reload the LLM provider) for it to take effect.";
      await refreshDiagnosis();
    } catch (err) {
      noteEl.hidden = true;
      warnGpuEl.textContent = `⚠ ${err instanceof Error ? err.message : String(err)}`;
      warnGpuEl.hidden = false;
    } finally {
      applyingOverride = false;
    }
  });

  // Disable override control when not on desktop
  if (!window.annadataLlama?.setBackendOverride) {
    overrideEl.disabled = true;
  }

  syncForm();
}

export function initInfoModal(version: string): void {
  const aboutVersion = document.getElementById("about-version")!;
  aboutVersion.textContent = `Version ${version}`;
}
