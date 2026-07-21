# PKC desktop code signing

## What Certum covers

[Certum](https://www.certum.eu/) **code signing** certificates sign **Windows** PE files (`.exe` / NSIS installer) for Authenticode / SmartScreen.

They do **not** replace an [Apple Developer ID](https://developer.apple.com/) certificate for macOS Gatekeeper / notarization.

Your CertManager certificate: [108341876](https://certmanager.certum.pl/certificate/108341876)

## Windows + Certum SimplySign (usual path)

Certum keeps the private key in the cloud / crypto token. There is typically **no `.pfx`**. Signing works after [SimplySign Desktop](https://support.certum.eu/en/cert-offer-software-and-libraries/) mounts a virtual smart card into the Windows certificate store.

1. Install SimplySign Desktop (Windows) and unlock it (TOTP from the Certum mobile app).
2. Confirm the cert is visible:

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.HasPrivateKey } |
  Format-List Subject, Thumbprint, NotAfter
```

3. Copy `electron/signing/env.signing.example` → repo `.env.signing` (gitignored) and set:

```text
CERTUM_CERT_SHA1=<thumbprint with no spaces>
WIN_TIMESTAMP_URL=http://time.certum.pl
```

4. On a Windows machine with the win32 sidecar staged:

```powershell
# optional: load env from .env.signing then
npm run release:win
```

electron-builder will Authenticode-sign the app and the NSIS `*-setup.exe` using the store certificate and Certum’s timestamp server.

### Automating SimplySign unlock

SimplySign often needs a manual TOTP before `signtool` can use the key. See [this walkthrough](https://www.devas.life/how-to-automate-signing-your-windows-app-with-certum/) and `Connect-SimplySign.ps1` in this folder.

## Windows + PFX (only if Certum provided one)

```text
WIN_CSC_LINK=C:\secure\codesign.pfx
CSC_KEY_PASSWORD=...
```

Then `npm run release:win` — electron-builder picks these up automatically.

## macOS

Use Apple **Developer ID Application** (+ notarization). Set `CSC_LINK` / `CSC_KEY_PASSWORD` (and notarize env vars) and run `npm run release:mac` **without** forcing `CSC_IDENTITY_AUTO_DISCOVERY=false`.

Local llama sidecar binaries still need an ad-hoc codesign on macOS (handled by `llama-cpp-pro` `stage:desktop`) so Electron can spawn them during development — that is separate from Certum / Apple release signing.

## CI notes

GitHub Actions Windows runners do **not** have SimplySign mounted. Prefer:

- sign on a Windows build machine with SimplySign unlocked, or
- use a secrets-backed PFX only if your Certum product allows export (most do not).
