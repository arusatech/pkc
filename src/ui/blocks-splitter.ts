const STORAGE_KEY = "pkc:blocks-split-pct";
const MIN_PCT = 28;
const MAX_PCT = 78;

function loadSplitPct(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : 58;
  return Number.isFinite(n) ? Math.min(MAX_PCT, Math.max(MIN_PCT, n)) : 58;
}

function saveSplitPct(pct: number): void {
  localStorage.setItem(STORAGE_KEY, String(Math.round(pct)));
}

/**
 * Inserts a draggable vertical splitter between the PDF canvas column and
 * the block list inside PdfCanvasEditor's `.pce-layout`.
 */
export function attachBlocksSplitter(editorRoot: HTMLElement): () => void {
  const layout = editorRoot.querySelector<HTMLElement>(".pce-layout");
  const canvasCol = editorRoot.querySelector<HTMLElement>(".pce-canvas-col");
  const blockPanel = editorRoot.querySelector<HTMLElement>(".pce-block-panel");
  if (!layout || !canvasCol || !blockPanel) return () => {};

  // Avoid duplicate splitters on remount races
  layout.querySelector(".blocks-splitter")?.remove();

  const splitter = document.createElement("div");
  splitter.className = "blocks-splitter";
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-label", "Resize PDF and Blocks panels");
  splitter.tabIndex = 0;

  canvasCol.after(splitter);

  let pct = loadSplitPct();
  const apply = () => {
    layout.style.gridTemplateColumns = `minmax(0, ${pct}fr) 6px minmax(0, ${100 - pct}fr)`;
  };
  apply();

  let dragging = false;
  let startX = 0;
  let startPct = pct;

  const onPointerDown = (e: PointerEvent) => {
    // Stacked layout (narrow Blocks panel) — no horizontal resize
    if (layout.clientWidth < 640) return;
    dragging = true;
    startX = e.clientX;
    startPct = pct;
    splitter.classList.add("dragging");
    document.body.classList.add("blocks-splitter-active");
    splitter.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const width = layout.clientWidth;
    if (width < 1) return;
    const deltaPct = ((e.clientX - startX) / width) * 100;
    pct = Math.min(MAX_PCT, Math.max(MIN_PCT, startPct + deltaPct));
    apply();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.classList.remove("blocks-splitter-active");
    try {
      splitter.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    saveSplitPct(pct);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      pct = Math.max(MIN_PCT, pct - 2);
      apply();
      saveSplitPct(pct);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      pct = Math.min(MAX_PCT, pct + 2);
      apply();
      saveSplitPct(pct);
      e.preventDefault();
    }
  };

  splitter.addEventListener("pointerdown", onPointerDown);
  splitter.addEventListener("pointermove", onPointerMove);
  splitter.addEventListener("pointerup", onPointerUp);
  splitter.addEventListener("pointercancel", onPointerUp);
  splitter.addEventListener("keydown", onKeyDown);

  return () => {
    splitter.removeEventListener("pointerdown", onPointerDown);
    splitter.removeEventListener("pointermove", onPointerMove);
    splitter.removeEventListener("pointerup", onPointerUp);
    splitter.removeEventListener("pointercancel", onPointerUp);
    splitter.removeEventListener("keydown", onKeyDown);
    document.body.classList.remove("blocks-splitter-active");
    splitter.remove();
    layout.style.gridTemplateColumns = "";
  };
}
