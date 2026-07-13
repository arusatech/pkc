import { gzipSync } from "fflate";
import {
  MarkItDown,
  extractPdfBlocks,
  blocksToMarkdown,
  loadPdfBlocksLocal,
  savePdfBlocksLocal,
  generateStudyPkc,
  download_model,
  getActiveModelId,
  isChatCapableModel,
  listModelsWithStatus,
  LFM2_CHAT_MODEL_ID,
  DEFAULT_OFFLINE_MODEL_ID,
  setActiveModelId,
  type PdfDocumentBlocks,
} from "@annadata/pack-it-pkc";
import { PdfCanvasEditor } from "@annadata/pack-it-pkc/pdf/editor";
import {
  state,
  activeFile,
  basename,
  extname,
  isPdf,
} from "./app-state";
import { attachBlocksSplitter } from "../ui/blocks-splitter";
import { enterPickMode, enterWorkMode } from "../ui/tab-bar";

const PKC_MAGIC = new Uint8Array([0x50, 0x4b, 0x43, 0x01]);
let detachBlocksSplitter: (() => void) | null = null;

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
  get markdownOut() {
    return document.getElementById("markdown-out")!;
  },
  get studyPkcStatus() {
    return document.getElementById("study-pkc-status")!;
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
  get generateStudyPkcBtn() {
    return document.getElementById("generate-study-pkc-btn") as HTMLButtonElement;
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
  els.dlMd.disabled = !hasResult;
  els.dlJson.disabled = !hasResult || !state.lastResult?.pdfBlocks;
  els.dlJson.hidden = !state.lastResult?.pdfBlocks;
  els.dlPkc.disabled = !state.lastPkc;
  els.dlStudyPkc.disabled = !state.lastStudyPkc;
  els.generateStudyPkcBtn.disabled = !state.lastResult?.pdfBlocks || state.generatingStudyPkc;
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
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const compressed = gzipSync(json);
  const out = new Uint8Array(PKC_MAGIC.length + 4 + compressed.length);
  out.set(PKC_MAGIC, 0);
  new DataView(out.buffer).setUint32(PKC_MAGIC.length, compressed.length, false);
  out.set(compressed, PKC_MAGIC.length + 4);
  return out;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function refreshFileSelect(): void {
  const prev = els.fileSelect.value;
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

  if (state.activeFileId && state.fileQueue.some((q) => q.id === state.activeFileId)) {
    els.fileSelect.value = state.activeFileId;
  } else {
    state.activeFileId = state.fileQueue[0]!.id;
    els.fileSelect.value = state.activeFileId;
  }

  if (prev && state.fileQueue.some((q) => q.id === prev)) {
    els.fileSelect.value = prev;
    state.activeFileId = prev;
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
  els.markdownOut.textContent = "";
  els.previewEmpty.hidden = false;
  els.studyPkcSummary.hidden = true;
  els.studyPkcSummary.textContent = "";
  els.studyPkcStatus.hidden = true;
  els.studyPkcStatus.textContent = "";
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
  els.studyPkcStatus.hidden = true;
  els.studyPkcStatus.textContent = "";

  els.markdownOut.textContent = markdown;
  els.previewEmpty.hidden = true;
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
  if (!file || state.processing) return;

  state.processing = true;
  setStatus("Processing…");
  destroyEditor();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.selectedBytes = bytes;
    const extension = extname(file.name);

    if (isPdf(file)) {
      setStatus("Parsing PDF blocks…");
      const cached = loadPdfBlocksLocal(file.name);
      const doc = cached ?? (await extractPdfBlocks(bytes, { sort: true }));
      if (!cached) savePdfBlocksLocal(file.name, doc);

      mountPdfEditor(bytes, doc, doc.title ?? null);
      const title = doc.title ? ` — ${doc.title}` : "";
      setStatus(`PDF ready${title}`, "ok");
      return;
    }

    const md = new MarkItDown();
    const result = await md.convertBytes(bytes, {
      extension,
      filename: file.name,
      mimetype: file.type || null,
    });
    applyResult(result.markdown, result.title, result.pdfBlocks);
    const title = result.title ? ` — ${result.title}` : "";
    setStatus(`Done${title} (${result.markdown.length.toLocaleString()} chars)`, "ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Failed: ${message}`, "err");
    resetOutput();
  } finally {
    state.processing = false;
    refreshFileSelect();
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

async function handleGenerateStudyPkc(): Promise<void> {
  const doc = state.canvasEditor?.getDocument() ?? state.lastResult?.pdfBlocks;
  if (!doc || !state.lastResult || state.generatingStudyPkc) return;

  state.generatingStudyPkc = true;
  updateDownloadButtons();
  els.studyPkcStatus.hidden = false;
  els.studyPkcStatus.textContent = "Generating study PKC…";
  els.studyPkcSummary.hidden = true;

  try {
    const result = await generateStudyPkc(doc, {
      title: state.lastResult.title,
      source: activeFile()?.name ?? state.lastResult.baseName,
      llmProvider: state.llmProvider,
      chatModelId: getActiveModelId() ?? LFM2_CHAT_MODEL_ID,
      embeddingModelId: DEFAULT_OFFLINE_MODEL_ID,
      onProgress: (msg) => {
        els.studyPkcStatus.hidden = false;
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
      `models: embedding=${models.embedding ?? "—"} chat=${models.chat ?? "—"}`,
    ];
    if (warnings?.length) {
      lines.push("", "warnings:", ...warnings.map((w) => `· ${w}`));
    }
    els.studyPkcSummary.textContent = lines.join("\n");
    els.studyPkcSummary.hidden = false;
    els.studyPkcStatus.textContent = result.warnings.length
      ? `Study PKC ready with ${result.warnings.length} warning(s)`
      : "Study PKC ready";
    setStatus(
      `Study PKC · ${stats.flashCardCount} flash · ${stats.mcqCount} MCQ · ${stats.embeddedChunkCount}/${stats.chunkCount} embedded`,
      "ok",
    );
  } catch (err) {
    state.lastStudyPkc = null;
    state.lastStudyDoc = null;
    els.studyPkcSummary.hidden = true;
    els.studyPkcStatus.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    setStatus(`Study PKC failed: ${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    state.generatingStudyPkc = false;
    updateDownloadButtons();
  }
}

export function updateGgufModelStatus(): void {
  const id = els.ggufModelSelect.value || getActiveModelId();
  const active = getActiveModelId();
  const providerNote = state.llmProvider
    ? "LLM provider ready"
    : "No LLM provider (download still works; AI fix needs llama-cpp-capacitor)";
  els.ggufModelStatus.textContent = `Selected: ${id} · Active: ${active} · ${providerNote}`;
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
    setStatus(`Downloaded ${modelId} (${info.sizeBytes.toLocaleString()} bytes)`, "ok");
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
    if (!state.lastResult) return;
    downloadBlob(
      new Blob([state.lastResult.markdown], { type: "text/markdown;charset=utf-8" }),
      `${state.lastResult.baseName}.md`,
    );
  });

  els.dlPkc.addEventListener("click", () => {
    if (!state.lastPkc || !state.lastResult) return;
    downloadBlob(
      new Blob([state.lastPkc], { type: "application/octet-stream" }),
      `${state.lastResult.baseName}.pkc`,
    );
  });

  els.dlStudyPkc.addEventListener("click", () => {
    if (!state.lastStudyPkc || !state.lastResult) return;
    downloadBlob(
      new Blob([state.lastStudyPkc], { type: "application/octet-stream" }),
      `${state.lastResult.baseName}.study.pkc`,
    );
  });

  els.dlJson.addEventListener("click", () => {
    const blocks = state.canvasEditor?.getDocument() ?? state.lastResult?.pdfBlocks;
    if (!blocks || !state.lastResult) return;
    downloadBlob(
      new Blob([JSON.stringify(blocks, null, 2)], { type: "application/json;charset=utf-8" }),
      `${state.lastResult.baseName}.blocks.json`,
    );
  });

  els.generateStudyPkcBtn.addEventListener("click", () => void handleGenerateStudyPkc());

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
    }
  });
}

export async function initConvert(): Promise<void> {
  refreshFileSelect();
  updateColorToggleUi();
  updateDownloadButtons();
  els.pkcToggle.checked = state.packPkcOnProcess;
  wireConvertUi();

  await tryCreateLlmProvider();
  await refreshGgufModelSelect();
  state.canvasEditor?.setLlmProvider(state.llmProvider);
  setStatus(
    state.llmProvider
      ? "Add a file to begin · LLM provider ready for AI fix"
      : "Add a file to begin · download models anytime; AI fix needs llama-cpp-capacitor",
  );
}
