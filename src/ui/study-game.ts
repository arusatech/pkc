import {
  isPlayableStudyGame,
  resolvePlayableGameHtml,
  type PkcStudyDocument,
  type StudyGame,
} from "@annadata/pack-it-pkc";

export type StudyGameSource = "preview" | "chat";

export interface StudyGameController {
  open(source?: StudyGameSource): void;
  close(): void;
  isOpen(): boolean;
  syncActionButtons(): void;
}

function playableGames(doc: PkcStudyDocument | null): StudyGame[] {
  return (doc?.games ?? []).filter(isPlayableStudyGame);
}

/**
 * Host shell for Study PKC game cartridges.
 * Assembles module html/css/js (or documentHtml / legacy player.html) into a
 * sandboxed iframe. Works for chess, custom, and any kind with a module.
 */
export function createStudyGame(opts: {
  getDoc: (source: StudyGameSource) => PkcStudyDocument | null;
  onOpen?: () => void;
  onClose?: () => void;
}): StudyGameController {
  const root = document.getElementById("study-game")!;
  const titleEl = document.getElementById("study-game-title")!;
  const frame = document.getElementById("study-game-frame") as HTMLIFrameElement;
  const fallbackEl = document.getElementById("study-game-fallback")!;
  const closeBtn = document.getElementById("study-game-close") as HTMLButtonElement;
  const playBtn = document.getElementById("study-play-btn") as HTMLButtonElement;
  const chatPlayBtn = document.getElementById("chat-play-btn") as HTMLButtonElement | null;

  let open = false;
  let source: StudyGameSource = "preview";

  function syncActionButtons(): void {
    const previewHas = playableGames(opts.getDoc("preview")).length > 0;
    const chatHas = playableGames(opts.getDoc("chat")).length > 0;
    playBtn.disabled = !previewHas;
    if (chatPlayBtn) chatPlayBtn.disabled = !chatHas;
  }

  function clearFrame(): void {
    frame.removeAttribute("srcdoc");
    frame.removeAttribute("src");
    frame.hidden = true;
    fallbackEl.hidden = true;
  }

  function mountPlayer(spec: StudyGame): void {
    titleEl.textContent = spec.title || "Game";
    let html: string | null = null;
    try {
      html = resolvePlayableGameHtml(spec);
    } catch (err) {
      console.warn("[study-game] assemble failed", err);
    }
    if (html) {
      fallbackEl.hidden = true;
      frame.hidden = false;
      // Prefer srcdoc alone — a lingering about:blank src can leave a blank frame.
      frame.removeAttribute("src");
      frame.srcdoc = html;
      return;
    }
    frame.hidden = true;
    clearFrame();
    fallbackEl.hidden = false;
    fallbackEl.textContent =
      "This pack has no playable game module. Author `games[].module` with html/css/js " +
      "(or documentHtml), e.g. createCustomStudyPkc() / createChessStudyPkc().";
  }

  function openGame(nextSource: StudyGameSource = "preview"): void {
    source = nextSource;
    const games = playableGames(opts.getDoc(source));
    if (games.length === 0) return;
    mountPlayer(games[0]!);
    open = true;
    root.hidden = false;
    opts.onOpen?.();
  }

  function closeGame(): void {
    open = false;
    root.hidden = true;
    clearFrame();
    opts.onClose?.();
  }

  function onMessage(event: MessageEvent): void {
    if (!open) return;
    if (frame.contentWindow && event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if ((data as { source?: string }).source !== "pkc-game") return;
    const type = (data as { type?: string }).type;
    if (type === "close") {
      closeGame();
      return;
    }
    if (type === "ready") {
      const title = (data as { title?: string }).title;
      if (title) titleEl.textContent = title;
      return;
    }
    if (type === "error") {
      const message = (data as { message?: string }).message;
      console.warn("[study-game] cartridge error", message ?? data);
    }
  }

  playBtn.addEventListener("click", () => openGame("preview"));
  closeBtn.addEventListener("click", () => closeGame());
  window.addEventListener("message", onMessage);

  syncActionButtons();

  return {
    open: openGame,
    close: closeGame,
    isOpen: () => open,
    syncActionButtons,
  };
}
