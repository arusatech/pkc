export function initTitleBar(): void {
  const closeBtn = document.getElementById("close-btn")!;
  const settingsBtn = document.getElementById("settings-btn")!;
  const infoBtn = document.getElementById("info-btn")!;
  const settingsDialog = document.getElementById("settings-dialog") as HTMLDialogElement;
  const infoDialog = document.getElementById("info-dialog") as HTMLDialogElement;

  closeBtn.addEventListener("click", () => {
    if (window.windowControls?.close) {
      void window.windowControls.close();
      return;
    }
    window.close();
  });

  settingsBtn.addEventListener("click", () => {
    settingsDialog.showModal();
  });

  infoBtn.addEventListener("click", () => {
    infoDialog.showModal();
  });
}
