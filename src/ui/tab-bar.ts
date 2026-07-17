import { syncPanelRowSplitters, type PanelId } from "./panel-splitters";

export type { PanelId };

const STORAGE_KEY = "pkc:visible-panels";

const DEFAULT_VISIBLE: Record<PanelId, boolean> = {
  upload: true,
  blocks: false,
  preview: false,
  chat: false,
};

let visible = loadVisible();
let applyFn: (() => void) | null = null;

function loadVisible(): Record<PanelId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VISIBLE };
    const parsed = JSON.parse(raw) as Partial<Record<PanelId, boolean>>;
    return { ...DEFAULT_VISIBLE, ...parsed };
  } catch {
    return { ...DEFAULT_VISIBLE };
  }
}

function saveVisible(state: Record<PanelId, boolean>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** After a file is picked: hide Upload and open work panes. */
export function enterWorkMode(opts: { pdf: boolean }): void {
  visible.upload = false;
  visible.blocks = opts.pdf;
  visible.preview = true;
  // Keep chat as-is if user already had it open
  applyFn?.();
  // Ensure layout is computed before PdfCanvasEditor measures width.
  requestAnimationFrame(() => syncPanelRowSplitters());
}

/** When the queue is empty: return to the Upload picker. */
export function enterPickMode(): void {
  visible.upload = true;
  visible.blocks = false;
  visible.preview = false;
  visible.chat = false;
  applyFn?.();
}

export function initTabBar(): {
  getVisible: () => Record<PanelId, boolean>;
  setVisible: (id: PanelId, on: boolean) => void;
} {
  const tabBar = document.getElementById("tab-bar")!;
  const panels = document.querySelectorAll<HTMLElement>(".panel[data-panel]");

  function apply(): void {
    if (!Object.values(visible).some(Boolean)) {
      visible.upload = true;
    }

    for (const panel of panels) {
      const id = panel.dataset.panel as PanelId;
      panel.hidden = !visible[id];
    }

    for (const btn of tabBar.querySelectorAll<HTMLButtonElement>(".tab-btn")) {
      const id = btn.dataset.panel as PanelId;
      const on = !!visible[id];
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    saveVisible(visible);
    syncPanelRowSplitters();
  }

  applyFn = apply;

  tabBar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".tab-btn");
    if (!btn?.dataset.panel) return;
    const id = btn.dataset.panel as PanelId;

    // "+" Upload always opens the file picker (and keeps the drop zone visible).
    if (id === "upload") {
      visible.upload = true;
      apply();
      const input = document.getElementById("file-input") as HTMLInputElement | null;
      input?.click();
      return;
    }

    visible[id] = !visible[id];
    apply();
  });

  window.addEventListener("resize", () => {
    syncPanelRowSplitters();
  });

  apply();

  return {
    getVisible: () => ({ ...visible }),
    setVisible: (id, on) => {
      visible[id] = on;
      apply();
    },
  };
}
