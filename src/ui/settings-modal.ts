import { loadCloudPrefs, saveCloudPrefs, type CloudExportPrefs } from "../export/cloud-prefs";

const PREF_PACK = "pkc:pref:pack-pkc";
const PREF_COLOR = "pkc:pref:color-mode";

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

export function initSettingsModal(opts: {
  getActiveModelLabel: () => string;
  onSave: (prefs: AppPrefs) => void;
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

  void window.pkcExport?.oauthRedirectUri().then((uri) => {
    if (redirectEl) redirectEl.textContent = uri;
  });

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
  };

  document.getElementById("settings-btn")!.addEventListener("click", syncForm);
  syncForm();
}

export function initInfoModal(version: string): void {
  const aboutVersion = document.getElementById("about-version")!;
  aboutVersion.textContent = `Version ${version}`;
}
