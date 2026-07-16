const PREF_GOOGLE_CLIENT_ID = "pkc:pref:google-client-id";
const PREF_GOOGLE_CLIENT_SECRET = "pkc:pref:google-client-secret";
const PREF_DROPBOX_APP_KEY = "pkc:pref:dropbox-app-key";
const PREF_DROPBOX_APP_SECRET = "pkc:pref:dropbox-app-secret";

export interface CloudExportPrefs {
  googleClientId: string;
  googleClientSecret: string;
  dropboxAppKey: string;
  dropboxAppSecret: string;
}

export function loadCloudPrefs(): CloudExportPrefs {
  return {
    googleClientId: localStorage.getItem(PREF_GOOGLE_CLIENT_ID) ?? "",
    googleClientSecret: localStorage.getItem(PREF_GOOGLE_CLIENT_SECRET) ?? "",
    dropboxAppKey: localStorage.getItem(PREF_DROPBOX_APP_KEY) ?? "",
    dropboxAppSecret: localStorage.getItem(PREF_DROPBOX_APP_SECRET) ?? "",
  };
}

export function saveCloudPrefs(prefs: CloudExportPrefs): void {
  localStorage.setItem(PREF_GOOGLE_CLIENT_ID, prefs.googleClientId.trim());
  localStorage.setItem(PREF_GOOGLE_CLIENT_SECRET, prefs.googleClientSecret.trim());
  localStorage.setItem(PREF_DROPBOX_APP_KEY, prefs.dropboxAppKey.trim());
  localStorage.setItem(PREF_DROPBOX_APP_SECRET, prefs.dropboxAppSecret.trim());
}
