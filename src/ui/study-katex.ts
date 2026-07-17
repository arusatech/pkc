/**
 * Study / chat KaTeX + mhchem rendering.
 * Uses the same preprocess path as Blocks → formula (polish + prepareContentForAutoRender).
 */

import {
  polishStudyChatReply,
  prepareContentForAutoRender,
  renderToHtml,
} from "@annadata/pack-it-pkc";
import katex from "katex";
import "katex/contrib/mhchem";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function containsMathOrChemistry(text: string): boolean {
  return (
    /\$\$[\s\S]+?\$\$/.test(text) ||
    /\$[^$\n]+\$/.test(text) ||
    /\\\([\s\S]+?\\\)/.test(text) ||
    /\\\[[\s\S]+?\\\]/.test(text) ||
    /\\ce\s*\{/.test(text) ||
    /\\pu\s*\{/.test(text)
  );
}

function renderTex(tex: string, displayMode: boolean): string {
  try {
    // Prefer pack-it katex helper (same opts as formula blocks) when possible.
    const html = renderToHtml(tex, { displayMode });
    if (html) return html;
  } catch {
    /* fall through */
  }
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      errorColor: "#cc0000",
      displayMode,
    });
  } catch {
    return escapeHtml(tex);
  }
}

/**
 * Escape plain text, or typeset chemistry/math like Blocks formula preview.
 * Always runs polishStudyChatReply first so chat and formula blocks stay consistent.
 */
export function formatStudyHtml(text: string): string {
  if (!text) return "";

  // Same preprocess as Blocks formula tagging (ions, units, strip bad \\ce{prose}).
  const polished = polishStudyChatReply(text);
  const prepared = prepareContentForAutoRender(polished);
  if (!prepared) return "";

  if (!containsMathOrChemistry(prepared)) {
    return escapeHtml(prepared).replace(/\n/g, "<br />");
  }

  return prepared
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g)
    .map((part) => {
      if (!part) return "";
      if (part.startsWith("$$") && part.endsWith("$$")) {
        return renderTexSafe(part.slice(2, -2), true);
      }
      if (part.startsWith("$") && part.endsWith("$")) {
        return renderTexSafe(part.slice(1, -1), false);
      }
      return escapeHtml(part).replace(/\n/g, "<br />");
    })
    .join("");
}

/** Skip clearly broken \\ce{ / \\pu{ fragments instead of showing katex-error spans. */
function renderTexSafe(tex: string, displayMode: boolean): string {
  const t = tex.trim();
  if (!t) return "";
  // Unbalanced braces → don't feed KaTeX
  let depth = 0;
  for (const ch of t) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) return escapeHtml(t);
  }
  if (depth !== 0) return escapeHtml(t.replace(/^\\(?:ce|pu)\{/, "").trim());
  // Truncated reaction: "\\ce{Zn(s) +"
  if (/\\ce\{[^}]*[+\-]$/.test(t) || /\\ce\{[^}]*$/.test(t) && !t.endsWith("}")) {
    return escapeHtml(t.replace(/^\\ce\{/, "").replace(/\}$/, ""));
  }
  return renderTex(t, displayMode);
}
