/**
 * Windows Authenticode options for Certum code signing.
 *
 * Certum certificates are usually cloud/HSM (SimplySign) — private key is NOT a .pfx.
 * After SimplySign Desktop mounts the virtual smart card, electron-builder signs via
 * the Windows certificate store using SHA1 thumbprint or subject name.
 *
 * CertManager entry (this project): https://certmanager.certum.pl/certificate/108341876
 *
 * Env (see electron/signing/env.signing.example):
 *   CERTUM_CERT_SHA1       — preferred (thumbprint, no spaces)
 *   CERTUM_CERT_SUBJECT    — alternative (CN=… subject)
 *   WIN_CSC_LINK           — only if you have an exportable .pfx/.p12 (rare for Certum)
 *   CSC_KEY_PASSWORD       — PFX password when using WIN_CSC_LINK
 *   WIN_TIMESTAMP_URL      — default http://time.certum.pl
 *
 * Note: Certum cannot sign macOS apps for Gatekeeper — use Apple Developer ID for DMG.
 */
'use strict';

function env(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : undefined;
}

function winSigningFromEnv() {
  const sha1 = (env('CERTUM_CERT_SHA1') || env('WIN_CERTIFICATE_SHA1') || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  const subject = env('CERTUM_CERT_SUBJECT') || env('WIN_CERTIFICATE_SUBJECT');
  const timestamp =
    env('WIN_TIMESTAMP_URL') || env('CSC_TIMESTAMP_URL') || 'http://time.certum.pl';

  /** @type {Record<string, unknown>} */
  const win = {
    signingHashAlgorithms: ['sha256'],
    rfc3161TimeStampServer: timestamp,
    // Legacy Authenticode timestamp (some older tooling); rfc3161 is primary.
    timeStampServer: timestamp,
  };

  if (sha1) {
    win.certificateSha1 = sha1;
    console.log(`[signing] Windows: Certum store cert SHA1=${sha1.slice(0, 8)}…`);
  } else if (subject) {
    win.certificateSubjectName = subject;
    console.log(`[signing] Windows: Certum store cert subject="${subject}"`);
  } else if (env('WIN_CSC_LINK') || env('CSC_LINK')) {
    console.log('[signing] Windows: using WIN_CSC_LINK / CSC_LINK (PFX)');
  } else {
    console.log(
      '[signing] Windows: no CERTUM_CERT_SHA1 / CERTUM_CERT_SUBJECT / CSC_LINK — building unsigned',
    );
  }

  return win;
}

module.exports = { winSigningFromEnv };
