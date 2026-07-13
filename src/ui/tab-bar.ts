export type PanelId = "upload" | "blocks" | "preview" | "chat";

const STORAGE_KEY = "pkc:visible-panels";

const DEFAULT_VISIBLE: Record<PanelId, boolean> = {
  upload: true,
  blocks: false,
  preview: false,
  chat: false,
};

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

export function initTabBar(): {
  getVisible: () => Record<PanelId, boolean>;
  setVisible: (id: PanelId, on: boolean) => void;
} {
  const tabBar = document.getElementById("tab-bar")!;
  const panels = document.querySelectorAll<HTMLElement>(".panel[data-panel]");
  let visible = loadVisible();

  function apply(): void {
    // Keep at least one panel visible
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
  }

  tabBar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".tab-btn");
    if (!btn?.dataset.panel) return;
    const id = btn.dataset.panel as PanelId;
    visible[id] = !visible[id];
    apply();
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
