import {
  answerStudyQuestion,
  getActiveModelId,
  loadPkcForChat,
  type PkcStudyDocument,
} from "@annadata/pack-it-pkc";
import { state } from "../convert/app-state";
import { formatStudyHtml } from "./study-katex";
import type { StudyQuizController } from "./study-quiz";

type ChatRole = "user" | "assistant" | "system";

export function initChatPanel(opts: {
  getStudyQuiz: () => StudyQuizController | null;
  onStatus: (msg: string, kind?: "ok" | "err") => void;
  onImported: (doc: PkcStudyDocument) => void;
}): void {
  const pickBtn = document.getElementById("chat-pick-pkc") as HTMLButtonElement;
  const fileInput = document.getElementById("chat-pkc-input") as HTMLInputElement;
  const nameEl = document.getElementById("chat-pkc-name")!;
  const studyActions = document.getElementById("chat-study-actions")!;
  const flashBtn = document.getElementById("chat-flash-btn") as HTMLButtonElement;
  const mcqBtn = document.getElementById("chat-mcq-btn") as HTMLButtonElement;
  const messagesEl = document.getElementById("chat-messages")!;
  const emptyEl = document.getElementById("chat-empty")!;
  const input = document.getElementById("chat-input") as HTMLTextAreaElement;
  const sendBtn = document.getElementById("chat-send") as HTMLButtonElement;

  let sending = false;

  function syncStudyActions(): void {
    const doc = state.chatStudyDoc;
    const hasDoc = !!doc;
    studyActions.hidden = !hasDoc;
    flashBtn.disabled = !hasDoc || (doc?.flashCards.length ?? 0) === 0;
    mcqBtn.disabled = !hasDoc || (doc?.mcqs.length ?? 0) === 0;
    input.disabled = !hasDoc || sending;
    sendBtn.disabled = !hasDoc || sending || !input.value.trim();
    if (hasDoc && state.chatPkcName) {
      nameEl.hidden = false;
      nameEl.textContent = state.chatPkcName;
    } else {
      nameEl.hidden = true;
      nameEl.textContent = "";
    }
  }

  function appendMessage(role: ChatRole, text: string): HTMLElement {
    emptyEl.hidden = true;
    const row = document.createElement("div");
    row.className = `chat-bubble chat-bubble-${role}`;
    if (role === "assistant") {
      row.innerHTML = formatStudyHtml(text);
    } else {
      row.textContent = text;
    }
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function resetThread(): void {
    messagesEl.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "Import a PKC or Study PKC file to start chatting.";
    messagesEl.appendChild(emptyEl);
  }

  async function importFile(file: File): Promise<void> {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const doc = loadPkcForChat(buf);
      state.chatStudyDoc = doc;
      state.chatStudyPkc = buf;
      state.chatPkcName = file.name;
      opts.onImported(doc);
      syncStudyActions();
      resetThread();
      const isPlain =
        doc.stats.flashCardCount === 0 &&
        doc.stats.mcqCount === 0 &&
        (doc.warnings?.some((w) => w.includes("plain PKC")) ?? false);
      appendMessage(
        "system",
        isPlain
          ? `Loaded “${file.name}” (plain PKC) · ${doc.stats.chunkCount} text chunks · chat ready`
          : `Loaded “${file.name}” · ${doc.stats.flashCardCount} flash · ${doc.stats.mcqCount} MCQ · ${doc.stats.chunkCount} chunks`,
      );
      opts.onStatus(`Chat PKC loaded: ${file.name}`, "ok");
    } catch (err) {
      opts.onStatus(
        `Failed to import PKC: ${err instanceof Error ? err.message : String(err)}`,
        "err",
      );
    }
  }

  async function send(): Promise<void> {
    const doc = state.chatStudyDoc;
    const text = input.value.trim();
    if (!doc || !text || sending) return;

    sending = true;
    syncStudyActions();
    input.value = "";
    appendMessage("user", text);
    const pending = appendMessage("assistant", "Thinking…");

    try {
      const result = await answerStudyQuestion({
        doc,
        query: text,
        provider: state.llmProvider,
        chatModelId: getActiveModelId(),
        onStatus: (msg) => opts.onStatus(msg),
      });
      pending.innerHTML = formatStudyHtml(result.text);
    } catch (err) {
      pending.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      sending = false;
      syncStudyActions();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void importFile(file);
  });

  flashBtn.addEventListener("click", () => opts.getStudyQuiz()?.open("flash", "chat"));
  mcqBtn.addEventListener("click", () => opts.getStudyQuiz()?.open("mcq", "chat"));

  sendBtn.addEventListener("click", () => void send());
  input.addEventListener("input", () => {
    sendBtn.disabled = !state.chatStudyDoc || sending || !input.value.trim();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  });

  syncStudyActions();
}
