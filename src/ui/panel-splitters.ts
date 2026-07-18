export type PanelId = "upload" | "merge" | "blocks" | "preview" | "chat";

const STORAGE_KEY = "pkc:panel-widths";
const MIN_PCT = 12;

type WidthMap = Partial<Record<PanelId, number>>;

function loadWidths(): WidthMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as WidthMap;
  } catch {
    return {};
  }
}

function saveWidths(map: WidthMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function isStacked(row: HTMLElement): boolean {
  return getComputedStyle(row).flexDirection === "column" || row.clientWidth < 700;
}

/**
 * Keeps draggable splitters between visible main panes (Upload / Blocks / Preview / Chat).
 * Call after panel visibility changes.
 */
export function syncPanelRowSplitters(): void {
  const row = document.getElementById("panel-row");
  if (!row) return;

  for (const el of row.querySelectorAll(".panel-splitter")) {
    el.remove();
  }

  const panels = [...row.querySelectorAll<HTMLElement>(":scope > .panel[data-panel]")].filter(
    (p) => !p.hidden,
  );

  if (panels.length <= 1 || isStacked(row)) {
    for (const p of panels) {
      p.style.flex = "";
      p.style.minWidth = "";
    }
    return;
  }

  const widths = loadWidths();
  const equal = 100 / panels.length;

  let sum = 0;
  for (const p of panels) {
    const id = p.dataset.panel as PanelId;
    if (!widths[id] || widths[id]! <= 0) widths[id] = equal;
    sum += widths[id]!;
  }
  if (Math.abs(sum - 100) > 0.5) {
    for (const p of panels) {
      const id = p.dataset.panel as PanelId;
      widths[id] = (widths[id]! / sum) * 100;
    }
  }

  const applyFlex = () => {
    for (const p of panels) {
      const id = p.dataset.panel as PanelId;
      const pct = widths[id] ?? equal;
      p.style.flex = `${pct} 1 0`;
      p.style.minWidth = "0";
    }
  };
  applyFlex();
  saveWidths(widths);

  for (let i = 0; i < panels.length - 1; i++) {
    const left = panels[i]!;
    const right = panels[i + 1]!;
    const splitter = document.createElement("div");
    splitter.className = "panel-splitter";
    splitter.setAttribute("role", "separator");
    splitter.setAttribute("aria-orientation", "vertical");
    splitter.setAttribute(
      "aria-label",
      `Resize ${left.dataset.panel} and ${right.dataset.panel}`,
    );
    splitter.tabIndex = 0;
    left.after(splitter);

    let dragging = false;
    let startX = 0;
    let startLeftPct = 0;
    let startRightPct = 0;
    let pairTotal = 0;

    const leftId = left.dataset.panel as PanelId;
    const rightId = right.dataset.panel as PanelId;

    const onPointerDown = (e: PointerEvent) => {
      if (isStacked(row)) return;
      dragging = true;
      startX = e.clientX;
      startLeftPct = widths[leftId] ?? equal;
      startRightPct = widths[rightId] ?? equal;
      pairTotal = startLeftPct + startRightPct;
      splitter.classList.add("dragging");
      document.body.classList.add("panel-splitter-active");
      splitter.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const rowWidth = row.clientWidth;
      if (rowWidth < 1) return;

      const deltaPct = ((e.clientX - startX) / rowWidth) * 100;
      let nextLeft = startLeftPct + deltaPct;
      nextLeft = Math.min(pairTotal - MIN_PCT, Math.max(MIN_PCT, nextLeft));
      widths[leftId] = nextLeft;
      widths[rightId] = pairTotal - nextLeft;
      applyFlex();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove("dragging");
      document.body.classList.remove("panel-splitter-active");
      try {
        splitter.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      saveWidths(widths);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const step = e.key === "ArrowLeft" ? -2 : 2;
      let nextLeft = (widths[leftId] ?? equal) + step;
      const total = (widths[leftId] ?? equal) + (widths[rightId] ?? equal);
      nextLeft = Math.min(total - MIN_PCT, Math.max(MIN_PCT, nextLeft));
      widths[leftId] = nextLeft;
      widths[rightId] = total - nextLeft;
      applyFlex();
      saveWidths(widths);
      e.preventDefault();
    };

    splitter.addEventListener("pointerdown", onPointerDown);
    splitter.addEventListener("pointermove", onPointerMove);
    splitter.addEventListener("pointerup", onPointerUp);
    splitter.addEventListener("pointercancel", onPointerUp);
    splitter.addEventListener("keydown", onKeyDown);
  }
}
