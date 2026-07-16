import type {
  PdfDocumentBlocks,
  GgufInferenceProvider,
  PkcStudyDocument,
} from "@annadata/pack-it-pkc";
import type { PdfCanvasEditor } from "@annadata/pack-it-pkc/pdf/editor";

export interface ConversionResult {
  markdown: string;
  title: string | null | undefined;
  baseName: string;
  pdfBlocks?: PdfDocumentBlocks;
}

export interface QueuedFile {
  id: string;
  file: File;
}

export const state = {
  fileQueue: [] as QueuedFile[],
  activeFileId: null as string | null,
  selectedBytes: null as Uint8Array | null,
  lastResult: null as ConversionResult | null,
  lastPkc: null as Uint8Array | null,
  lastStudyPkc: null as Uint8Array | null,
  lastStudyDoc: null as PkcStudyDocument | null,
  /** Chat-imported Study PKC (may differ from convert-side lastStudy*). */
  chatStudyPkc: null as Uint8Array | null,
  chatStudyDoc: null as PkcStudyDocument | null,
  chatPkcName: null as string | null,
  canvasEditor: null as PdfCanvasEditor | null,
  imageColorMode: false,
  processing: false,
  generatingStudyPkc: false,
  ggufDownloading: false,
  llmProvider: null as GgufInferenceProvider | null,
  packPkcOnProcess: true,
};

export function activeFile(): File | null {
  return state.fileQueue.find((q) => q.id === state.activeFileId)?.file ?? null;
}

export function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

export function basename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function isPdf(file: File): boolean {
  return extname(file.name) === ".pdf" || file.type === "application/pdf";
}

/** Plain `.pkc` or Study `.study.pkc` / `.pkc` with study magic payload. */
export function isPkcFile(file: File): boolean {
  const ext = extname(file.name);
  return ext === ".pkc" || file.name.toLowerCase().endsWith(".study.pkc");
}
