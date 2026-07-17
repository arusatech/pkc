import {
  answerStudyQuestion,
  formatStudyHtml,
  getActiveModelId,
  loadPkcForChat,
  type PkcStudyDocument,
  type StudyChatImage,
} from "@annadata/pack-it-pkc";
import { state } from "../convert/app-state";
import type { StudyQuizController } from "./study-quiz";
import type { StudyGameController } from "./study-game";

type ChatRole = "user" | "assistant" | "system";

function renderAssistantHtml(text: string, images?: StudyChatImage[]): string {
  const body = formatStudyHtml(text);
  if (!images?.length) return body;
  const figs = images
    .map((img) => {
      const caption = img.caption
        ? `<figcaption class="chat-fig-caption">${escapeAttr(img.caption)}</figcaption>`
        : "";
      return `<figure class="chat-figure"><img src="${escapeAttr(img.src)}" alt="${escapeAttr(img.caption || "Figure")}" loading="lazy" />${caption}</figure>`;
    })
    .join("");
  return `${body}<div class="chat-figures">${figs}</div>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function initChatPanel(opts: {
  getStudyQuiz: () => StudyQuizController | null;
  getStudyGame: () => StudyGameController | null;
  onStatus: (msg: string, kind?: "ok" | "err") => void;
  onImported: (doc: PkcStudyDocument) => void;
}): void {
  const pickBtn = document.getElementById("chat-pick-pkc") as HTMLButtonElement;
  const fileInput = document.getElementById("chat-pkc-input") as HTMLInputElement;
  const nameEl = document.getElementById("chat-pkc-name")!;
  const studyActions = document.getElementById("chat-study-actions")!;
  const flashBtn = document.getElementById("chat-flash-btn") as HTMLButtonElement;
  const mcqBtn = document.getElementById("chat-mcq-btn") as HTMLButtonElement;
  const playBtn = document.getElementById("chat-play-btn") as HTMLButtonElement;
  const messagesEl = document.getElementById("chat-messages")!;
  const emptyEl = document.getElementById("chat-empty")!;
  const input = document.getElementById("chat-input") as HTMLTextAreaElement;
  const sendBtn = document.getElementById("chat-send") as HTMLButtonElement;

  let sending = false;

  function syncStudyActions(): void {
    const doc = state.chatStudyDoc;
    const hasDoc = !!doc;
    const gameCount = doc?.games?.length ?? doc?.stats.gameCount ?? 0;
    studyActions.hidden = !hasDoc;
    flashBtn.disabled = !hasDoc || (doc?.flashCards.length ?? 0) === 0;
    mcqBtn.disabled = !hasDoc || (doc?.mcqs.length ?? 0) === 0;
    playBtn.disabled = !hasDoc || gameCount === 0;
    input.disabled = !hasDoc || sending;
    sendBtn.disabled = !hasDoc || sending || !input.value.trim();
    if (hasDoc && state.chatPkcName) {
      nameEl.hidden = false;
      nameEl.textContent = state.chatPkcName;
    } else {
      nameEl.hidden = true;
      nameEl.textContent = "";
    }
    opts.getStudyGame()?.syncActionButtons();
  }

  function appendMessage(
    role: ChatRole,
    text: string,
    images?: StudyChatImage[],
  ): HTMLElement {
    emptyEl.hidden = true;
    const row = document.createElement("div");
    row.className = `chat-bubble chat-bubble-${role}`;
    if (role === "assistant") {
      row.innerHTML = renderAssistantHtml(text, images);
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
      const gameCount = doc.stats.gameCount ?? doc.games?.length ?? 0;
      const isPlain =
        doc.stats.flashCardCount === 0 &&
        doc.stats.mcqCount === 0 &&
        gameCount === 0 &&
        (doc.warnings?.some((w) => w.includes("plain PKC")) ?? false);
      const imageCount = (doc.blocks ?? []).filter(
        (b) => b.kind === "image" && b.dataUrl?.startsWith("data:image/"),
      ).length;
      const gameBit = gameCount > 0 ? ` · ${gameCount} game${gameCount === 1 ? "" : "s"}` : "";
      appendMessage(
        "system",
        isPlain
          ? `Loaded “${file.name}” (plain PKC) · ${doc.stats.chunkCount} text chunks · chat ready`
          : `Loaded “${file.name}” · ${doc.stats.flashCardCount} flash · ${doc.stats.mcqCount} MCQ${gameBit} · ${doc.stats.chunkCount} chunks${imageCount ? ` · ${imageCount} figures` : ""}`,
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
      pending.innerHTML = renderAssistantHtml(result.text, result.images);
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
  playBtn.addEventListener("click", () => opts.getStudyGame()?.open("chat"));

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
