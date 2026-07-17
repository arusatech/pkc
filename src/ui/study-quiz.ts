import type { FlashCard, Mcq, PkcStudyDocument } from "@annadata/pack-it-pkc";
import { formatStudyHtml } from "@annadata/pack-it-pkc";

export type StudyQuizKind = "flash" | "mcq";

export type StudyQuizSource = "preview" | "chat";

export interface StudyQuizController {
  open(kind: StudyQuizKind, source?: StudyQuizSource): void;
  close(): void;
  isOpen(): boolean;
  syncActionButtons(): void;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createStudyQuiz(opts: {
  getDoc: (source: StudyQuizSource) => PkcStudyDocument | null;
  saveDoc: (doc: PkcStudyDocument, source: StudyQuizSource) => void;
  onOpen?: (kind: StudyQuizKind) => void;
  onClose?: () => void;
}): StudyQuizController {
  const root = document.getElementById("study-quiz")!;
  const titleEl = document.getElementById("study-quiz-title")!;
  const countEl = document.getElementById("study-quiz-count")!;
  const viewEl = document.getElementById("study-quiz-view")!;
  const editEl = document.getElementById("study-quiz-edit-pane")!;
  const prevBtn = document.getElementById("study-quiz-prev") as HTMLButtonElement;
  const nextBtn = document.getElementById("study-quiz-next") as HTMLButtonElement;
  const revealBtn = document.getElementById("study-quiz-reveal") as HTMLButtonElement;
  const editBtn = document.getElementById("study-quiz-edit") as HTMLButtonElement;
  const deleteBtn = document.getElementById("study-quiz-delete") as HTMLButtonElement;
  const saveBtn = document.getElementById("study-quiz-save") as HTMLButtonElement;
  const cancelBtn = document.getElementById("study-quiz-cancel") as HTMLButtonElement;
  const closeBtn = document.getElementById("study-quiz-close") as HTMLButtonElement;
  const flashBtn = document.getElementById("study-flash-btn") as HTMLButtonElement;
  const mcqBtn = document.getElementById("study-mcq-btn") as HTMLButtonElement;
  const statusBar = document.getElementById("study-status-bar")!;

  let kind: StudyQuizKind = "flash";
  let source: StudyQuizSource = "preview";
  let index = 0;
  let revealed = false;
  let editing = false;
  let open = false;

  function activeDoc(): PkcStudyDocument | null {
    return opts.getDoc(source);
  }

  function cards(): FlashCard[] {
    return activeDoc()?.flashCards ?? [];
  }

  function mcqs(): Mcq[] {
    return activeDoc()?.mcqs ?? [];
  }

  function len(): number {
    return kind === "flash" ? cards().length : mcqs().length;
  }

  function clampIndex(): void {
    const n = len();
    if (n <= 0) index = 0;
    else index = Math.max(0, Math.min(index, n - 1));
  }

  function syncActionButtons(): void {
    const doc = opts.getDoc("preview");
    const hasFlash = (doc?.flashCards.length ?? 0) > 0;
    const hasMcq = (doc?.mcqs.length ?? 0) > 0;
    flashBtn.disabled = !hasFlash;
    mcqBtn.disabled = !hasMcq;
    statusBar.hidden = !doc;
  }

  function setEditUi(on: boolean): void {
    editing = on;
    viewEl.hidden = on;
    editEl.hidden = !on;
    editBtn.hidden = on;
    deleteBtn.hidden = on;
    saveBtn.hidden = !on;
    cancelBtn.hidden = !on;
    revealBtn.hidden = on;
    prevBtn.disabled = on;
    nextBtn.disabled = on;
  }

  function renderFlashView(card: FlashCard): void {
    viewEl.innerHTML = `
      <div class="study-card ${revealed ? "revealed" : ""}">
        <div class="study-card-label">Prompt</div>
        <div class="study-card-body">${formatStudyHtml(card.info)}</div>
        <div class="study-card-label answer-label">Answer</div>
        <div class="study-card-body answer-body">${
          revealed ? formatStudyHtml(card.solution.text) : "<em>Hidden — click Reveal</em>"
        }</div>
      </div>`;
  }

  function renderMcqView(item: Mcq): void {
    const letters = ["A", "B", "C", "D"];
    const optsHtml = item.options
      .map((opt, i) => {
        const isAns = revealed && i === item.answerIndex;
        return `<li class="study-mcq-option${isAns ? " correct" : ""}"><span class="study-mcq-letter">${letters[i]}</span><span>${formatStudyHtml(opt)}</span></li>`;
      })
      .join("");
    viewEl.innerHTML = `
      <div class="study-card ${revealed ? "revealed" : ""}">
        <div class="study-card-label">Question</div>
        <div class="study-card-body">${formatStudyHtml(item.question)}</div>
        <ol class="study-mcq-options">${optsHtml}</ol>
        ${
          revealed && item.explanation
            ? `<div class="study-card-label">Explanation</div><div class="study-card-body">${formatStudyHtml(item.explanation)}</div>`
            : ""
        }
        ${
          revealed
            ? `<p class="study-mcq-answer-hint">Correct: ${letters[item.answerIndex]}</p>`
            : `<p class="study-mcq-answer-hint muted">Answer hidden — click Reveal</p>`
        }
      </div>`;
  }

  function renderEditFlash(card: FlashCard): void {
    editEl.innerHTML = `
      <label class="study-edit-field">
        <span>Prompt</span>
        <textarea id="sq-flash-info" rows="5">${esc(card.info)}</textarea>
      </label>
      <label class="study-edit-field">
        <span>Answer</span>
        <textarea id="sq-flash-solution" rows="5">${esc(card.solution.text)}</textarea>
      </label>`;
  }

  function renderEditMcq(item: Mcq): void {
    const letters = ["A", "B", "C", "D"];
    const optionFields = item.options
      .map(
        (opt, i) => `
      <label class="study-edit-field">
        <span>Option ${letters[i]}</span>
        <input id="sq-mcq-opt-${i}" type="text" value="${esc(opt)}" />
      </label>`,
      )
      .join("");
    editEl.innerHTML = `
      <label class="study-edit-field">
        <span>Question</span>
        <textarea id="sq-mcq-question" rows="3">${esc(item.question)}</textarea>
      </label>
      ${optionFields}
      <label class="study-edit-field">
        <span>Correct answer</span>
        <select id="sq-mcq-answer">
          ${letters
            .map(
              (l, i) =>
                `<option value="${i}"${i === item.answerIndex ? " selected" : ""}>${l}</option>`,
            )
            .join("")}
        </select>
      </label>
      <label class="study-edit-field">
        <span>Explanation</span>
        <textarea id="sq-mcq-explanation" rows="3">${esc(item.explanation ?? "")}</textarea>
      </label>`;
  }

  function render(): void {
    clampIndex();
    const n = len();
    titleEl.textContent = kind === "flash" ? "Flash Card" : "MCQ";
    countEl.textContent = n === 0 ? "0 / 0" : `${index + 1} / ${n}`;
    prevBtn.disabled = editing || index <= 0;
    nextBtn.disabled = editing || index >= n - 1;
    revealBtn.disabled = n === 0 || editing;
    editBtn.disabled = n === 0 || editing;
    deleteBtn.disabled = n === 0 || editing;
    revealBtn.textContent = revealed ? "Hide" : "Reveal";

    if (n === 0) {
      viewEl.innerHTML = `<p class="study-quiz-empty">No ${kind === "flash" ? "flash cards" : "MCQs"} in this Study PKC.</p>`;
      editEl.innerHTML = "";
      setEditUi(false);
      return;
    }

    if (editing) {
      if (kind === "flash") renderEditFlash(cards()[index]!);
      else renderEditMcq(mcqs()[index]!);
      return;
    }

    if (kind === "flash") renderFlashView(cards()[index]!);
    else renderMcqView(mcqs()[index]!);
  }

  function saveEdits(): void {
    const doc = activeDoc();
    if (!doc || len() === 0) return;

    if (kind === "flash") {
      const info = (document.getElementById("sq-flash-info") as HTMLTextAreaElement).value;
      const solution = (document.getElementById("sq-flash-solution") as HTMLTextAreaElement).value;
      const nextCards = doc.flashCards.map((c, i) =>
        i === index
          ? {
              ...c,
              info,
              solution: { ...c.solution, text: solution },
            }
          : c,
      );
      opts.saveDoc(
        {
          ...doc,
          flashCards: nextCards,
          stats: { ...doc.stats, flashCardCount: nextCards.length },
        },
        source,
      );
    } else {
      const question = (document.getElementById("sq-mcq-question") as HTMLTextAreaElement).value;
      const options = [0, 1, 2, 3].map((i) =>
        (document.getElementById(`sq-mcq-opt-${i}`) as HTMLInputElement).value,
      ) as [string, string, string, string];
      const answerIndex = Number(
        (document.getElementById("sq-mcq-answer") as HTMLSelectElement).value,
      ) as 0 | 1 | 2 | 3;
      const explanation = (
        document.getElementById("sq-mcq-explanation") as HTMLTextAreaElement
      ).value.trim();
      const nextMcqs = doc.mcqs.map((m, i) =>
        i === index
          ? {
              ...m,
              question,
              options,
              answerIndex,
              explanation: explanation || undefined,
            }
          : m,
      );
      opts.saveDoc(
        {
          ...doc,
          mcqs: nextMcqs,
          stats: { ...doc.stats, mcqCount: nextMcqs.length },
        },
        source,
      );
    }

    setEditUi(false);
    revealed = true;
    render();
    syncActionButtons();
  }

  function deleteCurrent(): void {
    const doc = activeDoc();
    if (!doc || editing || len() === 0) return;

    const label = kind === "flash" ? "flash card" : "MCQ";
    if (!window.confirm(`Delete this ${label}?`)) return;

    if (kind === "flash") {
      const nextCards = doc.flashCards.filter((_, i) => i !== index);
      opts.saveDoc(
        {
          ...doc,
          flashCards: nextCards,
          stats: { ...doc.stats, flashCardCount: nextCards.length },
        },
        source,
      );
    } else {
      const nextMcqs = doc.mcqs.filter((_, i) => i !== index);
      opts.saveDoc(
        {
          ...doc,
          mcqs: nextMcqs,
          stats: { ...doc.stats, mcqCount: nextMcqs.length },
        },
        source,
      );
    }

    revealed = false;
    clampIndex();
    render();
    syncActionButtons();
  }

  function openKind(next: StudyQuizKind, nextSource: StudyQuizSource = "preview"): void {
    source = nextSource;
    const doc = activeDoc();
    if (!doc) return;
    kind = next;
    index = 0;
    revealed = false;
    open = true;
    root.hidden = false;
    setEditUi(false);
    render();
    opts.onOpen?.(next);
  }

  function close(): void {
    if (!open) return;
    open = false;
    editing = false;
    root.hidden = true;
    viewEl.innerHTML = "";
    editEl.innerHTML = "";
    opts.onClose?.();
  }

  prevBtn.addEventListener("click", () => {
    if (editing || index <= 0) return;
    index -= 1;
    revealed = false;
    render();
  });
  nextBtn.addEventListener("click", () => {
    if (editing || index >= len() - 1) return;
    index += 1;
    revealed = false;
    render();
  });
  revealBtn.addEventListener("click", () => {
    if (editing || len() === 0) return;
    revealed = !revealed;
    render();
  });
  editBtn.addEventListener("click", () => {
    if (len() === 0) return;
    setEditUi(true);
    render();
  });
  deleteBtn.addEventListener("click", () => deleteCurrent());
  saveBtn.addEventListener("click", () => saveEdits());
  cancelBtn.addEventListener("click", () => {
    setEditUi(false);
    render();
  });
  closeBtn.addEventListener("click", () => close());
  flashBtn.addEventListener("click", () => openKind("flash", "preview"));
  mcqBtn.addEventListener("click", () => openKind("mcq", "preview"));

  syncActionButtons();

  return {
    open: openKind,
    close,
    isOpen: () => open,
    syncActionButtons,
  };
}
