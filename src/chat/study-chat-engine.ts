/**
 * Re-export Study PKC chat/RAG from pack-it-pkc (canonical implementation).
 * Prefer importing from `@annadata/pack-it-pkc` in new code.
 */
export {
  loadPkcForChat,
  answerStudyQuestion,
  retrieveStudyContext,
  collectStudySearchChunks,
  buildStudyRagChatPrompt,
  extractStudyReplyFromContext,
  clampStudyChatReply,
  buildStudyContextFallbackReply,
  STUDY_CHAT_NO_CONTEXT_FALLBACK,
  type AnswerStudyQuestionOptions,
  type AnswerStudyQuestionResult,
} from "@annadata/pack-it-pkc";
