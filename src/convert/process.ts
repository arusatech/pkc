import { gzipSync, gunzipSync } from "fflate";
import {
  MarkItDown,
  createEmptyPdfDocumentBlocks,
  blocksToMarkdown,
  clearPdfBlocksLocal,
  generateStudyPkc,
  download_model,
  getActiveModelId,
  isChatCapableModel,
  listModelsWithStatus,
  LFM2_CHAT_MODEL_ID,
  DEFAULT_OFFLINE_MODEL_ID,
  packStudyPkc,
  setActiveModelId,
  unpackPkc,
  PKC_STUDY_VERSION,
  loadPkcForChat,
  type PdfDocumentBlocks,
} from "@annadata/pack-it-pkc";
import { PdfCanvasEditor } from "@annadata/pack-it-pkc/pdf/editor";
import {
  state,
  activeFile,
  basename,
  extname,
  isPdf,
  isPkcFile,
} from "./app-state";
import { attachBlocksSplitter } from "../ui/blocks-splitter";
import { enterPickMode, enterWorkMode } from "../ui/tab-bar";
import { createStudyQuiz, type StudyQuizController } from "../ui/study-quiz";
import { createStudyGame, type StudyGameController } from "../ui/study-game";
import { initExportModal, type ExportArtifact } from "../ui/export-modal";
import { initChatPanel } from "../ui/chat-panel";

const PKC_MAGIC = new Uint8Array([0x50, 0x4b, 0x43, 0x01]);
let detachBlocksSplitter: (() => void) | null = null;
type PreviewMode = "markdown" | "pkc";
let previewMode: PreviewMode = "markdown";
let previewEditTimer: ReturnType<typeof setTimeout> | null = null;
let studyQuiz: StudyQuizController | null = null;
let studyGame: StudyGameController | null = null;
let openExport: ((artifact: ExportArtifact) => void) | null = null;

function studySummaryBits(study: {
  stats: {
    flashCardCount: number;
    mcqCount: number;
    gameCount?: number;
  };
}): string {
  const games = study.stats.gameCount ?? 0;
  const parts = [
    `${study.stats.flashCardCount} flash`,
    `${study.stats.mcqCount} MCQ`,
  ];
  if (games > 0) parts.push(`${games} game${games === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function syncStudyUi(): void {
  studyQuiz?.syncActionButtons();
  studyGame?.syncActionButtons();
}

function closeStudyOverlays(): void {
  studyQuiz?.close();
  studyGame?.close();
}
/** Bumped on each enqueue/switch so in-flight process runs can abort cleanly. */
let processGeneration = 0;

function looksLikePkcMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PKC_MAGIC.length) return false;
  for (let i = 0; i < PKC_MAGIC.length; i++) {
    if (bytes[i] !== PKC_MAGIC[i]) return false;
  }
  return true;
}

const els = {
  get fileInput() {
    return document.getElementById("file-input") as HTMLInputElement;
  },
  get fileSelect() {
    return document.getElementById("file-select") as HTMLSelectElement;
  },
  get dropZone() {
    return document.getElementById("drop-zone")!;
  },
  get status() {
    return document.getElementById("status")!;
  },
  get editor() {
    return document.getElementById("pdf-editor")!;
  },
  get blocksEmpty() {
    return document.getElementById("blocks-empty")!;
  },
  get previewEmpty() {
    return document.getElementById("preview-empty")!;
  },
  get previewEditor() {
    return document.getElementById("preview-editor") as HTMLTextAreaElement;
  },
  get previewModeMd() {
    return document.getElementById("preview-mode-md") as HTMLButtonElement;
  },
  get previewModePkc() {
    return document.getElementById("preview-mode-pkc") as HTMLButtonElement;
  },
  get studyPkcStatus() {
    return document.getElementById("study-pkc-status")!;
  },
  get studyStatusBar() {
    return document.getElementById("study-status-bar")!;
  },
  get studyExportBtn() {
    return document.getElementById("study-export-btn") as HTMLButtonElement;
  },
  get studyPkcSummary() {
    return document.getElementById("study-pkc-summary") as HTMLPreElement;
  },
  get pkcToggle() {
    return document.getElementById("pkc-toggle") as HTMLInputElement;
  },
  get colorToggle() {
    return document.getElementById("color-toggle") as HTMLButtonElement;
  },
  get dlMd() {
    return document.getElementById("dl-md") as HTMLButtonElement;
  },
  get dlJson() {
    return document.getElementById("dl-json") as HTMLButtonElement;
  },
  get dlPkc() {
    return document.getElementById("dl-pkc") as HTMLButtonElement;
  },
  get dlStudyPkc() {
    return document.getElementById("dl-study-pkc") as HTMLButtonElement;
  },
  get ggufModelSelect() {
    return document.getElementById("gguf-model-select") as HTMLSelectElement;
  },
  get ggufDownloadBtn() {
    return document.getElementById("gguf-download-btn") as HTMLButtonElement;
  },
  get ggufSetActiveBtn() {
    return document.getElementById("gguf-set-active-btn") as HTMLButtonElement;
  },
  get ggufModelStatus() {
    return document.getElementById("gguf-model-status")!;
  },
};

export function setStatus(message: string, kind: "ok" | "err" | "" = ""): void {
  els.status.textContent = message;
  els.status.className = `status${kind ? ` ${kind}` : ""}`;
}

export function updateColorToggleUi(): void {
  els.colorToggle.classList.toggle("active", state.imageColorMode);
  els.colorToggle.setAttribute("aria-pressed", String(state.imageColorMode));
  els.colorToggle.title = state.imageColorMode
    ? "Colour ON — tap for monochrome"
    : "Monochrome — tap for colour";
  state.canvasEditor?.setImageColorMode(state.imageColorMode);
}

export function updateDownloadButtons(): void {
  const hasResult = !!state.lastResult;
  const canGenerateStudy = !!state.lastResult?.pdfBlocks;
  els.dlMd.disabled = !hasResult;
  els.dlJson.disabled = !hasResult || !state.lastResult?.pdfBlocks;
  els.dlJson.hidden = !state.lastResult?.pdfBlocks;
  els.dlPkc.disabled = !state.lastPkc;
  els.dlStudyPkc.disabled = !state.lastStudyPkc;
  els.studyExportBtn.disabled = !state.lastStudyPkc || state.generatingStudyPkc;
  els.previewModePkc.disabled = (!hasPkcPreview() && !canGenerateStudy) || state.generatingStudyPkc;
  els.previewModePkc.textContent = state.generatingStudyPkc ? "PKC…" : "PKC";
  syncStudyUi();
}

function openStudyPkcExport(): void {
  if (!state.lastStudyPkc || !state.lastResult || !openExport) return;
  openExport({
    label: "Study PKC",
    filename: `${state.lastResult.baseName}.study.pkc`,
    blob: new Blob([Uint8Array.from(state.lastStudyPkc)], {
      type: "application/octet-stream",
    }),
  });
}

function packToPkcBrowser(
  markdown: string,
  meta: { title?: string | null; source?: string },
): Uint8Array {
  const doc = {
    version: 1,
    title: meta.title ?? null,
    source: meta.source ?? null,
    mimetype: "text/markdown",
    markdown,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
  return packJsonToPkc(doc);
}

function packJsonToPkc(doc: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const compressed = gzipSync(json);
  const out = new Uint8Array(PKC_MAGIC.length + 4 + compressed.length);
  out.set(PKC_MAGIC, 0);
  new DataView(out.buffer).setUint32(PKC_MAGIC.length, compressed.length, false);
  out.set(compressed, PKC_MAGIC.length + 4);
  return out;
}

function unpackPkcJson(data: Uint8Array): unknown {
  if (data.length < PKC_MAGIC.length + 4) throw new Error("Invalid PKC: too short");
  for (let i = 0; i < PKC_MAGIC.length; i++) {
    if (data[i] !== PKC_MAGIC[i]) throw new Error("Invalid PKC magic header");
  }
  const payloadLen = new DataView(data.buffer, data.byteOffset).getUint32(PKC_MAGIC.length, false);
  const payload = data.subarray(PKC_MAGIC.length + 4, PKC_MAGIC.length + 4 + payloadLen);
  return JSON.parse(new TextDecoder().decode(gunzipSync(payload)));
}

function hasPkcPreview(): boolean {
  return !!(state.lastStudyDoc || state.lastStudyPkc || state.lastPkc || state.lastResult);
}

function getPkcJsonForEditor(): string {
  if (state.lastStudyDoc) {
    return JSON.stringify(state.lastStudyDoc, null, 2);
  }
  if (state.lastStudyPkc) {
    return JSON.stringify(unpackPkcJson(state.lastStudyPkc), null, 2);
  }
  if (state.lastPkc) {
    return JSON.stringify(unpackPkcJson(state.lastPkc), null, 2);
  }
  if (state.lastResult) {
    return JSON.stringify(
      {
        version: 1,
        title: state.lastResult.title ?? null,
        source: activeFile()?.name ?? null,
        mimetype: "text/markdown",
        markdown: state.lastResult.markdown,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    );
  }
  return "";
}

function setPreviewMode(mode: PreviewMode): void {
  previewMode = mode;
  els.previewModeMd.classList.toggle("active", mode === "markdown");
  els.previewModePkc.classList.toggle("active", mode === "pkc");
  els.previewModeMd.setAttribute("aria-pressed", String(mode === "markdown"));
  els.previewModePkc.setAttribute("aria-pressed", String(mode === "pkc"));
  closeStudyOverlays();
  refreshPreviewEditor();
}

function refreshPreviewEditor(): void {
  const hasResult = !!state.lastResult;
  syncStudyUi();

  if (!hasResult) {
    els.previewEditor.hidden = true;
    els.previewEditor.value = "";
    els.previewEmpty.hidden = false;
    updateDownloadButtons();
    return;
  }

  els.previewEmpty.hidden = true;
  if (studyQuiz?.isOpen() || studyGame?.isOpen()) {
    els.previewEditor.hidden = true;
  } else {
    els.previewEditor.hidden = false;
  }
  updateDownloadButtons();

  if (previewMode === "markdown") {
    els.previewEditor.value = state.lastResult?.markdown ?? "";
    els.previewEditor.placeholder = "Markdown output…";
    els.studyPkcSummary.hidden = true;
  } else {
    try {
      els.previewEditor.value = getPkcJsonForEditor();
      els.previewEditor.placeholder = "PKC JSON…";
      els.studyPkcSummary.hidden = true;
    } catch (err) {
      els.previewEditor.value = "";
      setStatus(`Failed to open PKC JSON: ${err instanceof Error ? err.message : String(err)}`, "err");
    }
  }
}

function persistStudyDoc(doc: NonNullable<typeof state.lastStudyDoc>): void {
  state.lastStudyDoc = doc;
  state.lastStudyPkc = packJsonToPkc(doc);
  if (typeof doc.markdown === "string" && state.lastResult) {
    state.lastResult = { ...state.lastResult, markdown: doc.markdown };
  }
  syncStudyUi();
  updateDownloadButtons();
  // Always refresh the PKC JSON buffer (even while the quiz overlay is open).
  refreshPreviewEditor();
  setStatus("Study PKC updated", "ok");
}

function applyMarkdownEdit(text: string): void {
  if (!state.lastResult) return;
  state.lastResult = { ...state.lastResult, markdown: text };
  if (els.pkcToggle.checked) {
    state.lastPkc = packToPkcBrowser(text, {
      title: state.lastResult.title,
      source: activeFile()?.name,
    });
  }
  updateDownloadButtons();
}

function applyPkcJsonEdit(text: string): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    setStatus(`Invalid PKC JSON: ${err instanceof Error ? err.message : String(err)}`, "err");
    return;
  }

  const version = Number(parsed.version ?? 0);
  // Study PKC documents use version 2.
  if (version === 2 || state.lastStudyDoc || state.lastStudyPkc) {
    state.lastStudyDoc = parsed as unknown as NonNullable<typeof state.lastStudyDoc>;
    state.lastStudyPkc = packJsonToPkc(parsed);
    if (typeof parsed.markdown === "string" && state.lastResult) {
      state.lastResult = { ...state.lastResult, markdown: parsed.markdown };
    }
    setStatus("Study PKC JSON updated", "ok");
  } else {
    const markdown = typeof parsed.markdown === "string" ? parsed.markdown : "";
    if (state.lastResult) {
      state.lastResult = {
        ...state.lastResult,
        markdown,
        title: (parsed.title as string | null | undefined) ?? state.lastResult.title,
      };
    }
    state.lastPkc = packJsonToPkc(parsed);
    setStatus("PKC JSON updated", "ok");
  }
  updateDownloadButtons();
}

function onPreviewEditorInput(): void {
  if (previewEditTimer) clearTimeout(previewEditTimer);
  previewEditTimer = setTimeout(() => {
    const text = els.previewEditor.value;
    if (previewMode === "markdown") applyMarkdownEdit(text);
    else applyPkcJsonEdit(text);
  }, 350);
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

/** Prefer `<tmpdir>/AcharyaAnnadata/exports`, else browser Downloads via anchor. */
async function downloadBlob(blob: Blob, filename: string): Promise<string> {
  const fs = window.acharyaFs;
  if (fs?.writeBytes) {
    const safe = filename.replace(/[/\\]/g, "_");
    const relativePath = `exports/${safe}`;
    const path = await fs.writeBytes(relativePath, await blobToBase64(blob));
    return path;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return filename;
}

export function refreshFileSelect(): void {
  els.fileSelect.innerHTML = "";

  if (state.fileQueue.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No file";
    els.fileSelect.append(opt);
    els.fileSelect.disabled = true;
    els.fileSelect.hidden = true;
    enterPickMode();
    return;
  }

  els.fileSelect.hidden = false;
  els.fileSelect.disabled = false;

  for (const item of state.fileQueue) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.file.name;
    els.fileSelect.append(opt);
  }

  // Honor intentional activeFileId (e.g. newly uploaded file). Do not restore a
  // stale <select> value — that skipped opening the PDF the user just picked.
  if (state.activeFileId && state.fileQueue.some((q) => q.id === state.activeFileId)) {
    els.fileSelect.value = state.activeFileId;
  } else {
    state.activeFileId = state.fileQueue[0]!.id;
    els.fileSelect.value = state.activeFileId;
  }
}

function destroyEditor(): void {
  detachBlocksSplitter?.();
  detachBlocksSplitter = null;
  state.canvasEditor?.destroy();
  state.canvasEditor = null;
  els.editor.innerHTML = "";
  els.blocksEmpty.hidden = false;
}

function resetOutput(): void {
  destroyEditor();
  state.lastResult = null;
  state.lastPkc = null;
  state.lastStudyPkc = null;
  state.lastStudyDoc = null;
  state.selectedBytes = null;
  previewMode = "markdown";
  closeStudyOverlays();
  els.previewEditor.value = "";
  els.previewEditor.hidden = true;
  els.previewEmpty.hidden = false;
  els.studyPkcSummary.hidden = true;
  els.studyPkcSummary.textContent = "";
  els.studyStatusBar.hidden = true;
  els.studyPkcStatus.textContent = "";
  setPreviewMode("markdown");
  syncStudyUi();
  updateDownloadButtons();
}

function applyResult(
  markdown: string,
  title: string | null | undefined,
  pdfBlocks?: PdfDocumentBlocks,
): void {
  const file = activeFile();
  if (!file) return;

  const baseName = basename(file.name);
  state.lastResult = { markdown, title, baseName, pdfBlocks };
  state.lastPkc = els.pkcToggle.checked
    ? packToPkcBrowser(markdown, { title, source: file.name })
    : null;
  state.lastStudyPkc = null;
  state.lastStudyDoc = null;
  els.studyPkcSummary.hidden = true;
  els.studyPkcSummary.textContent = "";
  els.studyStatusBar.hidden = true;
  els.studyPkcStatus.textContent = "";
  closeStudyOverlays();
  setPreviewMode("markdown");
  updateDownloadButtons();
}

/** Open an already-packed `.pkc` / `.study.pkc` without MarkItDown. */
function applyImportedPkc(bytes: Uint8Array): void {
  const file = activeFile();
  if (!file) return;

  const peeked = unpackPkc(bytes) as { version?: number; markdown?: string; title?: string | null };
  const version = Number(peeked.version ?? 0);
  const baseName = basename(file.name.replace(/\.study$/i, ""));

  if (version === PKC_STUDY_VERSION) {
    const study = loadPkcForChat(bytes);
    state.lastResult = {
      markdown: study.markdown || "",
      title: study.title ?? null,
      baseName,
    };
    state.lastPkc = null;
    state.lastStudyDoc = study;
    state.lastStudyPkc = bytes;
    els.studyStatusBar.hidden = false;
    els.studyPkcStatus.textContent = `Study PKC ready · ${studySummaryBits(study)}`;
    els.studyPkcSummary.hidden = true;
    syncStudyUi();
    setPreviewMode("markdown");
    updateDownloadButtons();
    return;
  }

  const markdown = typeof peeked.markdown === "string" ? peeked.markdown : "";
  if (!markdown.trim()) {
    throw new Error("PKC file has no markdown content");
  }
  state.lastResult = {
    markdown,
    title: peeked.title ?? null,
    baseName,
  };
  state.lastPkc = bytes;
  state.lastStudyPkc = null;
  state.lastStudyDoc = null;
  els.studyStatusBar.hidden = true;
  els.studyPkcStatus.textContent = "";
  els.studyPkcSummary.hidden = true;
  closeStudyOverlays();
  setPreviewMode("markdown");
  updateDownloadButtons();
}

function mountPdfEditor(
  bytes: Uint8Array,
  doc: PdfDocumentBlocks,
  title: string | null | undefined,
): void {
  const file = activeFile();
  if (!file) return;

  destroyEditor();
  els.blocksEmpty.hidden = true;

  state.canvasEditor = new PdfCanvasEditor({
    container: els.editor,
    fileName: file.name,
    pdfBytes: bytes,
    doc,
    imageColorMode: state.imageColorMode,
    llmProvider: state.llmProvider,
    getAssistModelId: () => getActiveModelId() || LFM2_CHAT_MODEL_ID,
    onAssistProgress: (msg) => setStatus(msg),
    onChange: (updated, markdown) => {
      applyResult(markdown, updated.title ?? title, updated);
      setStatus(`Blocks updated · ${markdown.length.toLocaleString()} chars`, "ok");
    },
  });

  detachBlocksSplitter = attachBlocksSplitter(els.editor);

  applyResult(blocksToMarkdown(doc), doc.title ?? title, doc);
}

export async function runProcess(): Promise<void> {
  const file = activeFile();
  if (!file) return;

  const gen = ++processGeneration;
  state.processing = true;
  setStatus("Processing…");
  destroyEditor();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (gen !== processGeneration) return;
    state.selectedBytes = bytes;
    const extension = extname(file.name);

    if (isPdf(file)) {
      setStatus("Opening PDF…");
      // Fresh canvas every open: no auto-extracted blocks, no stale localStorage tags.
      clearPdfBlocksLocal(file.name);
      const doc = await createEmptyPdfDocumentBlocks(bytes);
      if (gen !== processGeneration) return;

      mountPdfEditor(bytes, doc, doc.title ?? null);
      const title = doc.title ? ` — ${doc.title}` : "";
      setStatus(
        `PDF ready${title} · draw & tag regions, then Process Page`,
        "ok",
      );
      return;
    }

    if (isPkcFile(file) || looksLikePkcMagic(bytes)) {
      setStatus("Opening PKC…");
      applyImportedPkc(bytes);
      if (gen !== processGeneration) return;
      const study = state.lastStudyDoc;
      if (study) {
        setStatus(
          `Loaded Study PKC · ${studySummaryBits(study)} · ${(state.lastResult?.markdown.length ?? 0).toLocaleString()} chars`,
          "ok",
        );
      } else {
        setStatus(
          `Loaded PKC · ${(state.lastResult?.markdown.length ?? 0).toLocaleString()} chars`,
          "ok",
        );
      }
      return;
    }

    const md = new MarkItDown();
    const result = await md.convertBytes(bytes, {
      extension,
      filename: file.name,
      mimetype: file.type || null,
    });
    if (gen !== processGeneration) return;
    applyResult(result.markdown, result.title, result.pdfBlocks);
    const title = result.title ? ` — ${result.title}` : "";
    setStatus(`Done${title} (${result.markdown.length.toLocaleString()} chars)`, "ok");
  } catch (err) {
    if (gen !== processGeneration) return;
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Failed: ${message}`, "err");
    resetOutput();
  } finally {
    if (gen === processGeneration) {
      state.processing = false;
      refreshFileSelect();
    }
  }
}

export function enqueueFiles(files: FileList | File[]): void {
  const list = [...files];
  if (!list.length) return;

  for (const file of list) {
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.fileQueue.push({ id, file });
    if (!state.activeFileId) state.activeFileId = id;
  }

  // Switch to the last added file
  const last = state.fileQueue[state.fileQueue.length - 1]!;
  state.activeFileId = last.id;

  refreshFileSelect();
  resetOutput();
  enterWorkMode({ pdf: isPdf(last.file) });
  setStatus(`Added ${list.length} file${list.length > 1 ? "s" : ""}…`);
  void runProcess();
}

function switchFile(fileId: string): void {
  if (!state.fileQueue.some((q) => q.id === fileId)) return;
  state.activeFileId = fileId;
  const file = activeFile();
  resetOutput();
  if (file) enterWorkMode({ pdf: isPdf(file) });
  void runProcess();
}

async function handlePkcButton(): Promise<void> {
  if (state.generatingStudyPkc) return;

  const canGenerate = !!(state.canvasEditor?.getDocument() ?? state.lastResult?.pdfBlocks);
  const hasStudy = !!(state.lastStudyPkc || state.lastStudyDoc);

  // Already have a Study PKC → open/show it. Re-generate only when confirmed
  // (re-clicking PKC used to always regenerate and wiped flash/MCQ edits).
  if (hasStudy) {
    const wantsRegenerate =
      canGenerate &&
      previewMode === "pkc" &&
      !studyQuiz?.isOpen() &&
      !studyGame?.isOpen() &&
      window.confirm(
        "Regenerate Study PKC from the document?\n\nThis replaces the current flash cards and MCQs (including any edits).",
      );
    if (wantsRegenerate) {
      await handleGenerateStudyPkc();
      return;
    }
    closeStudyOverlays();
    setPreviewMode("pkc");
    return;
  }

  if (canGenerate) {
    await handleGenerateStudyPkc();
    return;
  }
  if (hasPkcPreview()) {
    setPreviewMode("pkc");
  }
}

async function handleGenerateStudyPkc(): Promise<void> {
  const doc = state.canvasEditor?.getDocument() ?? state.lastResult?.pdfBlocks;
  if (!doc || !state.lastResult || state.generatingStudyPkc) return;

  state.generatingStudyPkc = true;
  updateDownloadButtons();
  els.studyStatusBar.hidden = false;
  els.studyPkcStatus.textContent = "Generating study PKC…";
  els.studyPkcSummary.hidden = true;
  closeStudyOverlays();

  try {
    const result = await generateStudyPkc(doc, {
      title: state.lastResult.title,
      source: activeFile()?.name ?? state.lastResult.baseName,
      llmProvider: state.llmProvider,
      chatModelId: getActiveModelId() ?? LFM2_CHAT_MODEL_ID,
      embeddingModelId: DEFAULT_OFFLINE_MODEL_ID,
      onProgress: (msg) => {
        els.studyStatusBar.hidden = false;
        els.studyPkcStatus.textContent = msg;
      },
    });

    state.lastStudyPkc = result.pkc;
    state.lastStudyDoc = result.document;
    const { stats, models, warnings } = result.document;
    const lines = [
      `blocks: ${stats.blockCount}`,
      `chunks: ${stats.chunkCount} (embedded: ${stats.embeddedChunkCount})`,
      `flashcards: ${stats.flashCardCount}`,
      `mcqs: ${stats.mcqCount}`,
      `games: ${stats.gameCount}`,
      `models: embedding=${models.embedding ?? "—"} chat=${models.chat ?? "—"}`,
    ];
    if (warnings?.length) {
      lines.push("", "warnings:", ...warnings.map((w) => `· ${w}`));
      try {
        if (window.acharyaFs) {
          lines.push("", `store: ${await window.acharyaFs.getRootDir()}`);
        }
      } catch {
        /* ignore */
      }
    }
    els.studyPkcSummary.textContent = lines.join("\n");
    els.studyPkcSummary.hidden = true;
    els.studyStatusBar.hidden = false;
    els.studyPkcStatus.textContent = result.warnings.length
      ? `Study PKC ready with ${result.warnings.length} warning(s)`
      : "Study PKC ready";
    syncStudyUi();
    setPreviewMode("pkc");
    setStatus(
      `Study PKC · ${studySummaryBits(result.document)} · ${stats.embeddedChunkCount}/${stats.chunkCount} embedded`,
      "ok",
    );
  } catch (err) {
    state.lastStudyPkc = null;
    state.lastStudyDoc = null;
    els.studyPkcSummary.hidden = true;
    els.studyStatusBar.hidden = false;
    els.studyPkcStatus.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    syncStudyUi();
    setStatus(`Study PKC failed: ${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    state.generatingStudyPkc = false;
    updateDownloadButtons();
  }
}

export async function updateGgufModelStatus(): Promise<void> {
  const id = els.ggufModelSelect.value || getActiveModelId();
  const active = getActiveModelId();
  const providerNote = state.llmProvider
    ? "LLM provider ready"
    : "No LLM provider (download still works; AI fix needs llama-cpp-pro)";
  let rootNote = "";
  try {
    if (window.acharyaFs) {
      rootNote = ` · Store: ${await window.acharyaFs.getRootDir()}`;
    }
  } catch {
    /* ignore */
  }
  els.ggufModelStatus.textContent = `Selected: ${id} · Active: ${active} · ${providerNote}${rootNote}`;
  els.ggufDownloadBtn.disabled = state.ggufDownloading || !id;
  els.ggufSetActiveBtn.disabled = !id;
}

export async function refreshGgufModelSelect(): Promise<void> {
  const models = await listModelsWithStatus();
  const active = getActiveModelId();
  const prev = els.ggufModelSelect.value || active;
  els.ggufModelSelect.innerHTML = "";

  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    const chat = isChatCapableModel(m.id) ? "chat" : "embed";
    const stateLabel = m.status === "downloaded" ? "downloaded" : "not downloaded";
    opt.textContent = `${m.name} · ${m.sizeMB} MB · ${chat} · ${stateLabel}`;
    els.ggufModelSelect.append(opt);
  }

  if (models.some((m) => m.id === prev)) els.ggufModelSelect.value = prev;
  else if (models.some((m) => m.id === active)) els.ggufModelSelect.value = active;
  else if (models[0]) els.ggufModelSelect.value = models[0].id;

  updateGgufModelStatus();
}

async function handleGgufDownload(): Promise<void> {
  const modelId = els.ggufModelSelect.value;
  if (!modelId || state.ggufDownloading) return;

  state.ggufDownloading = true;
  updateGgufModelStatus();
  setStatus(`Downloading ${modelId}…`);

  try {
    const info = await download_model(modelId, {
      onProgress: (p) => {
        setStatus(`Downloading ${modelId}… ${p.percentage}%`);
        els.ggufModelStatus.textContent = `Downloading ${modelId}: ${p.percentage}% (${p.loaded.toLocaleString()} / ${p.total.toLocaleString()} bytes)`;
      },
    });
    setActiveModelId(modelId);
    await refreshGgufModelSelect();
    setStatus(
      `${info.cached ? "Using existing" : "Downloaded"} ${modelId} → ${info.path} (${info.sizeBytes.toLocaleString()} bytes)`,
      "ok",
    );
    els.ggufModelStatus.textContent = `${info.cached ? "Cached" : "Saved"}: ${info.path}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Download failed: ${message}`, "err");
    els.ggufModelStatus.textContent = message;
  } finally {
    state.ggufDownloading = false;
    updateGgufModelStatus();
  }
}

async function tryCreateLlmProvider(): Promise<void> {
  try {
    const { CapacitorGgufProvider } = await import(
      "@annadata/pack-it-pkc/inference/capacitor"
    );
    state.llmProvider = await CapacitorGgufProvider.create();
  } catch (err) {
    console.warn("[pkc] CapacitorGgufProvider unavailable", err);
    state.llmProvider = null;
  }
}

export function wireConvertUi(): void {
  els.colorToggle.addEventListener("click", () => {
    state.imageColorMode = !state.imageColorMode;
    updateColorToggleUi();
  });

  const openPicker = () => els.fileInput.click();
  document.getElementById("browse-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker();
  });
  els.dropZone.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("#browse-btn")) return;
    openPicker();
  });

  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files?.length) enqueueFiles(els.fileInput.files);
    els.fileInput.value = "";
  });

  els.fileSelect.addEventListener("change", () => {
    if (els.fileSelect.value) switchFile(els.fileSelect.value);
  });

  els.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  });

  els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("dragover"));

  els.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("dragover");
    if (e.dataTransfer?.files?.length) enqueueFiles(e.dataTransfer.files);
  });

  els.ggufDownloadBtn.addEventListener("click", () => void handleGgufDownload());
  els.ggufSetActiveBtn.addEventListener("click", () => {
    const modelId = els.ggufModelSelect.value;
    if (!modelId) return;
    setActiveModelId(modelId);
    updateGgufModelStatus();
    setStatus(`Active model: ${modelId}`, "ok");
  });
  els.ggufModelSelect.addEventListener("change", () => updateGgufModelStatus());

  els.dlMd.addEventListener("click", () => {
    if (!state.lastResult || !openExport) return;
    openExport({
      label: "Markdown",
      filename: `${state.lastResult.baseName}.md`,
      blob: new Blob([state.lastResult.markdown], { type: "text/markdown;charset=utf-8" }),
    });
  });

  els.dlPkc.addEventListener("click", () => {
    if (!state.lastPkc || !state.lastResult || !openExport) return;
    openExport({
      label: "PKC",
      filename: `${state.lastResult.baseName}.pkc`,
      blob: new Blob([Uint8Array.from(state.lastPkc)], { type: "application/octet-stream" }),
    });
  });

  els.dlStudyPkc.addEventListener("click", () => openStudyPkcExport());
  els.studyExportBtn.addEventListener("click", () => openStudyPkcExport());

  els.dlJson.addEventListener("click", () => {
    const blocks = state.canvasEditor?.getDocument() ?? state.lastResult?.pdfBlocks;
    if (!blocks || !state.lastResult || !openExport) return;
    openExport({
      label: "Blocks JSON",
      filename: `${state.lastResult.baseName}.blocks.json`,
      blob: new Blob([JSON.stringify(blocks, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    });
  });

  els.previewModeMd.addEventListener("click", () => setPreviewMode("markdown"));
  els.previewModePkc.addEventListener("click", () => void handlePkcButton());
  els.previewEditor.addEventListener("input", () => onPreviewEditorInput());

  els.pkcToggle.addEventListener("change", () => {
    state.packPkcOnProcess = els.pkcToggle.checked;
    if (state.lastResult) {
      state.lastPkc = els.pkcToggle.checked
        ? packToPkcBrowser(state.lastResult.markdown, {
            title: state.lastResult.title,
            source: activeFile()?.name,
          })
        : null;
      updateDownloadButtons();
      if (previewMode === "pkc") refreshPreviewEditor();
    }
  });
}

export async function initConvert(): Promise<void> {
  refreshFileSelect();
  updateColorToggleUi();
  updateDownloadButtons();
  els.pkcToggle.checked = state.packPkcOnProcess;
  openExport = initExportModal({
    onStatus: (msg, kind) => setStatus(msg, kind),
  }).open;
  studyQuiz = createStudyQuiz({
    getDoc: (source) => (source === "chat" ? state.chatStudyDoc : state.lastStudyDoc),
    saveDoc: (doc, source) => {
      if (source === "chat") {
        state.chatStudyDoc = doc;
        try {
          state.chatStudyPkc = packStudyPkc(doc);
        } catch {
          /* keep previous bytes */
        }
        return;
      }
      persistStudyDoc(doc);
    },
    onOpen: () => {
      studyGame?.close();
      els.previewEditor.hidden = true;
      els.previewEmpty.hidden = true;
      els.previewModeMd.classList.remove("active");
      els.previewModePkc.classList.remove("active");
    },
    onClose: () => {
      refreshPreviewEditor();
      els.previewModeMd.classList.toggle("active", previewMode === "markdown");
      els.previewModePkc.classList.toggle("active", previewMode === "pkc");
    },
  });
  studyGame = createStudyGame({
    getDoc: (source) => (source === "chat" ? state.chatStudyDoc : state.lastStudyDoc),
    onOpen: () => {
      studyQuiz?.close();
      els.previewEditor.hidden = true;
      els.previewEmpty.hidden = true;
      els.previewModeMd.classList.remove("active");
      els.previewModePkc.classList.remove("active");
    },
    onClose: () => {
      refreshPreviewEditor();
      els.previewModeMd.classList.toggle("active", previewMode === "markdown");
      els.previewModePkc.classList.toggle("active", previewMode === "pkc");
    },
  });
  initChatPanel({
    getStudyQuiz: () => studyQuiz,
    getStudyGame: () => studyGame,
    onStatus: (msg, kind) => setStatus(msg, kind),
    onImported: () => {
      syncStudyUi();
    },
  });
  wireConvertUi();
  setPreviewMode("markdown");

  await tryCreateLlmProvider();
  await refreshGgufModelSelect();
  state.canvasEditor?.setLlmProvider(state.llmProvider);
  setStatus(
    state.llmProvider
      ? "Add a file to begin · LLM provider ready for AI fix"
      : "Add a file to begin · download models anytime; AI fix needs llama-cpp-pro",
  );
}
