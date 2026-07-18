import { mergeStudyPkcFiles, unpackStudyPkc } from "@annadata/pack-it-pkc";
import { basename } from "../convert/app-state";

export type MergePanelCallbacks = {
  setStatus: (message: string, kind?: "ok" | "err" | "") => void;
  /** Enqueue the merged Study PKC file into the main convert queue. */
  onMergedFile: (file: File, summary: string) => void;
};

type StagedMergeFile = {
  id: string;
  file: File;
  bytes: Uint8Array;
  flashCount: number;
  mcqCount: number;
};

function looksLikePkcName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".pkc") || lower.endsWith(".study.pkc");
}

/**
 * Merge staging panel: Add Study PKC files one-by-one, then Merge into one pack.
 */
export function initMergePanel(opts: MergePanelCallbacks): void {
  const addBtn = document.getElementById("merge-add-btn") as HTMLButtonElement;
  const runBtn = document.getElementById("merge-run-btn") as HTMLButtonElement;
  const clearBtn = document.getElementById("merge-clear-btn") as HTMLButtonElement;
  const fileInput = document.getElementById("merge-file-input") as HTMLInputElement;
  const listEl = document.getElementById("merge-file-list")!;
  const emptyEl = document.getElementById("merge-empty")!;
  const hintEl = document.getElementById("merge-hint")!;
  const nameEl = document.getElementById("merge-output-name") as HTMLInputElement;

  const staged: StagedMergeFile[] = [];
  let merging = false;

  function syncUi(): void {
    listEl.innerHTML = "";
    for (const item of staged) {
      const li = document.createElement("li");
      li.className = "merge-file-item";
      li.dataset.id = item.id;

      const meta = document.createElement("div");
      meta.className = "merge-file-meta";
      const name = document.createElement("span");
      name.className = "merge-file-name";
      name.textContent = item.file.name;
      const stats = document.createElement("span");
      stats.className = "merge-file-stats";
      stats.textContent = `flash ${item.flashCount} · mcq ${item.mcqCount}`;
      meta.append(name, stats);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-chip merge-remove-btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        const idx = staged.findIndex((s) => s.id === item.id);
        if (idx >= 0) staged.splice(idx, 1);
        syncUi();
      });

      li.append(meta, remove);
      listEl.appendChild(li);
    }

    emptyEl.hidden = staged.length > 0;
    listEl.hidden = staged.length === 0;
    runBtn.disabled = staged.length < 2 || merging;
    clearBtn.disabled = staged.length === 0 || merging;
    addBtn.disabled = merging;

    if (staged.length === 0) {
      hintEl.textContent = "Need at least 2 Study PKC files to merge.";
      if (!nameEl.value.trim() && document.activeElement !== nameEl) {
        nameEl.placeholder = "Leave blank → first file’s name";
      }
    } else if (staged.length === 1) {
      hintEl.textContent = "Add at least one more Study PKC, then click Merge.";
      nameEl.placeholder = `Leave blank → ${basename(staged[0]!.file.name.replace(/\.study$/i, ""))}`;
    } else {
      hintEl.textContent = `${staged.length} files ready · flash/MCQ will be combined.`;
      nameEl.placeholder = `Leave blank → ${basename(staged[0]!.file.name.replace(/\.study$/i, ""))}`;
    }
  }

  async function stageFile(file: File): Promise<void> {
    if (!looksLikePkcName(file.name)) {
      opts.setStatus(`“${file.name}” is not a .pkc / .study.pkc file`, "err");
      return;
    }
    if (staged.some((s) => s.file.name === file.name && s.file.size === file.size)) {
      opts.setStatus(`Already added: ${file.name}`, "err");
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let flashCount = 0;
    let mcqCount = 0;
    try {
      const doc = unpackStudyPkc(bytes);
      flashCount = doc.flashCards?.length ?? 0;
      mcqCount = doc.mcqs?.length ?? 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.setStatus(`Not a Study PKC: ${file.name} — ${message}`, "err");
      return;
    }

    staged.push({
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      bytes,
      flashCount,
      mcqCount,
    });
    syncUi();
    opts.setStatus(`Added ${file.name} (${staged.length} file${staged.length === 1 ? "" : "s"})`, "ok");
  }

  async function runMerge(): Promise<void> {
    if (staged.length < 2 || merging) return;
    merging = true;
    syncUi();

    const defaultBase = basename(staged[0]!.file.name.replace(/\.study$/i, ""));
    const outputBaseName = nameEl.value.trim() || defaultBase;

    opts.setStatus(`Merging ${staged.length} Study PKC files…`);
    try {
      const { document, pkc, filename } = mergeStudyPkcFiles(
        staged.map((s) => ({ label: s.file.name, bytes: s.bytes })),
        {
          outputBaseName,
          title: defaultBase || "Merged study",
          source: staged.map((s) => s.file.name).join(" + "),
        },
      );

      const mergedFile = new File([Uint8Array.from(pkc)], filename, {
        type: "application/octet-stream",
      });
      const summary = `Merged → ${filename} · flash ${document.stats.flashCardCount} · mcq ${document.stats.mcqCount} · games ${document.stats.gameCount}`;

      staged.length = 0;
      nameEl.value = "";
      syncUi();
      opts.onMergedFile(mergedFile, summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.setStatus(`Merge failed: ${message}`, "err");
    } finally {
      merging = false;
      syncUi();
    }
  }

  addBtn.addEventListener("click", () => fileInput.click());
  runBtn.addEventListener("click", () => void runMerge());
  clearBtn.addEventListener("click", () => {
    staged.length = 0;
    nameEl.value = "";
    syncUi();
    opts.setStatus("Merge list cleared");
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void stageFile(file);
  });

  syncUi();
}
