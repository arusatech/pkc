import { loadCloudPrefs } from "../export/cloud-prefs";

export type ExportDestination = "local" | "google" | "dropbox";

export interface ExportArtifact {
  filename: string;
  blob: Blob;
  label: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

async function refreshAuthUi(): Promise<void> {
  const api = window.pkcExport;
  const googleStatus = document.getElementById("export-google-status")!;
  const dropboxStatus = document.getElementById("export-dropbox-status")!;
  const googleBtn = document.querySelector<HTMLButtonElement>(
    '[data-export-dest="google"]',
  )!;
  const dropboxBtn = document.querySelector<HTMLButtonElement>(
    '[data-export-dest="dropbox"]',
  )!;
  const googleSignOut = document.getElementById("export-google-signout") as HTMLButtonElement;
  const dropboxSignOut = document.getElementById("export-dropbox-signout") as HTMLButtonElement;

  if (!api) {
    googleStatus.textContent = "Desktop app required for cloud export";
    dropboxStatus.textContent = "Desktop app required for cloud export";
    googleBtn.disabled = true;
    dropboxBtn.disabled = true;
    return;
  }

  const prefs = loadCloudPrefs();
  const [g, d] = await Promise.all([api.authStatus("google"), api.authStatus("dropbox")]);

  if (!prefs.googleClientId) {
    googleStatus.textContent = "Add Google Client ID in Settings";
    googleBtn.disabled = true;
  } else if (g.signedIn) {
    googleStatus.textContent = g.accountLabel
      ? `Signed in as ${g.accountLabel} · Upload`
      : "Signed in · Upload";
    googleBtn.disabled = false;
  } else {
    googleStatus.textContent = "Continue with Google";
    googleBtn.disabled = false;
  }

  if (!prefs.dropboxAppKey) {
    dropboxStatus.textContent = "Add Dropbox App key in Settings";
    dropboxBtn.disabled = true;
  } else if (d.signedIn) {
    dropboxStatus.textContent = d.accountLabel
      ? `Signed in as ${d.accountLabel} · Upload`
      : "Signed in · Upload";
    dropboxBtn.disabled = false;
  } else {
    dropboxStatus.textContent = "Continue with Dropbox";
    dropboxBtn.disabled = false;
  }

  googleSignOut.hidden = !g.signedIn;
  dropboxSignOut.hidden = !d.signedIn;
}

async function exportLocal(artifact: ExportArtifact): Promise<string> {
  const api = window.pkcExport;
  const base64 = await blobToBase64(artifact.blob);

  if (api?.saveDialog && api.writeAbsolute) {
    const ext = artifact.filename.includes(".")
      ? artifact.filename.split(".").pop()!
      : "pkc";
    const path = await api.saveDialog({
      defaultPath: artifact.filename,
      filters: [
        { name: artifact.label, extensions: [ext] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!path) throw new Error("Save cancelled");
    const written = await api.writeAbsolute(path, base64);
    void api.reveal?.(written);
    return written;
  }

  const fs = window.acharyaFs;
  if (fs?.writeBytes) {
    const safe = artifact.filename.replace(/[/\\]/g, "_");
    return fs.writeBytes(`exports/${safe}`, base64);
  }

  const url = URL.createObjectURL(artifact.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return artifact.filename;
}

async function exportCloud(
  provider: "google" | "dropbox",
  artifact: ExportArtifact,
): Promise<string> {
  const api = window.pkcExport;
  if (!api?.uploadCloud) {
    throw new Error("Cloud export needs the Electron desktop app.");
  }
  const prefs = loadCloudPrefs();
  const clientId = provider === "google" ? prefs.googleClientId : prefs.dropboxAppKey;
  const clientSecret =
    provider === "google" ? prefs.googleClientSecret : prefs.dropboxAppSecret;
  if (!clientId) {
    throw new Error(
      provider === "google"
        ? "Add a Google OAuth Client ID in Settings first."
        : "Add a Dropbox App key in Settings first.",
    );
  }

  const status = await api.authStatus(provider);
  if (!status.signedIn) {
    await api.signIn({ provider, clientId, clientSecret: clientSecret || undefined });
  }

  const result = await api.uploadCloud({
    provider,
    filename: artifact.filename,
    base64: await blobToBase64(artifact.blob),
    clientId,
    clientSecret: clientSecret || undefined,
  });
  return result.link || result.path;
}

export function initExportModal(opts: {
  onStatus: (msg: string, kind?: "ok" | "err") => void;
}): { open: (artifact: ExportArtifact) => void } {
  const dialog = document.getElementById("export-dialog") as HTMLDialogElement;
  const titleEl = document.getElementById("export-file-label")!;
  const busyEl = document.getElementById("export-busy")!;
  let pending: ExportArtifact | null = null;
  let busy = false;

  const setBusy = (on: boolean, msg = "") => {
    busy = on;
    busyEl.hidden = !on;
    busyEl.textContent = msg;
    for (const btn of dialog.querySelectorAll<HTMLButtonElement>("[data-export-dest]")) {
      btn.disabled = on;
    }
    for (const btn of dialog.querySelectorAll<HTMLButtonElement>(".export-signout")) {
      btn.disabled = on;
    }
  };

  const run = async (dest: ExportDestination) => {
    if (!pending || busy) return;
    const busyMsg =
      dest === "local"
        ? "Saving…"
        : dest === "google"
          ? "Continue with Google…"
          : "Continue with Dropbox…";
    setBusy(true, busyMsg);
    try {
      const where =
        dest === "local"
          ? await exportLocal(pending)
          : await exportCloud(dest, pending);
      opts.onStatus(`Exported ${pending.label} → ${where}`, "ok");
      dialog.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== "Save cancelled") {
        opts.onStatus(`Export failed: ${message}`, "err");
      }
      await refreshAuthUi();
    } finally {
      setBusy(false);
      if (dialog.open) await refreshAuthUi();
    }
  };

  dialog.querySelectorAll<HTMLButtonElement>("[data-export-dest]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void run(btn.dataset.exportDest as ExportDestination);
    });
  });

  document.getElementById("export-google-signout")!.addEventListener("click", () => {
    void window.pkcExport?.signOut("google").then(() => refreshAuthUi());
  });
  document.getElementById("export-dropbox-signout")!.addEventListener("click", () => {
    void window.pkcExport?.signOut("dropbox").then(() => refreshAuthUi());
  });

  void window.pkcExport?.oauthRedirectUri().then((uri) => {
    const el = document.getElementById("export-oauth-redirect");
    if (el) el.textContent = uri;
  });

  return {
    open(artifact: ExportArtifact) {
      pending = artifact;
      titleEl.textContent = artifact.filename;
      setBusy(false);
      void refreshAuthUi();
      if (!dialog.open) dialog.showModal();
    },
  };
}
