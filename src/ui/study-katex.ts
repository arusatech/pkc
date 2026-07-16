/**
 * Study-card KaTeX / mhchem rendering (inline chemistry like \\ce{Zn…}).
 */

import katex from "katex";
// Side-effect: registers \\ce / \\pu for KaTeX.
import "katex/contrib/mhchem";

const KATEX_OPTS = {
  throwOnError: false,
  errorColor: "#cc0000",
} as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wrap each bare \\ce{…} / \\pu{…} in $…$ so KaTeX can typeset it. */
function wrapMhchemBlocksInMathDelimiters(text: string): string {
  if (!/\\ce\s*\{|\\pu\s*\{/.test(text)) return text;

  const normalized = text.replace(/\\ce\s*\{/g, "\\ce{").replace(/\\pu\s*\{/g, "\\pu{");
  if (/\$\\ce\{|\$\\pu\{/.test(normalized)) return normalized;

  const MACROS = ["\\ce{", "\\pu{"] as const;
  let result = "";
  let i = 0;

  while (i < normalized.length) {
    if (normalized[i] === "$") {
      const close = normalized.indexOf("$", i + 1);
      if (close > i) {
        result += normalized.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }

    let earliest = -1;
    let macroLen = 0;
    for (const m of MACROS) {
      const idx = normalized.indexOf(m, i);
      if (idx >= 0 && (earliest < 0 || idx < earliest)) {
        earliest = idx;
        macroLen = m.length;
      }
    }

    if (earliest < 0) {
      result += normalized.slice(i);
      break;
    }

    result += normalized.slice(i, earliest);
    const braceStart = earliest + macroLen - 1;
    let depth = 0;
    let j = braceStart;
    for (; j < normalized.length; j++) {
      const ch = normalized[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      result += normalized.slice(earliest);
      break;
    }

    result += `$${normalized.slice(earliest, j + 1)}$`;
    i = j + 1;
  }

  return result;
}

function prepareForRender(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return "";

  trimmed = trimmed.replace(/\\ce\s*\{/g, "\\ce{").replace(/\\pu\s*\{/g, "\\pu{");

  if (/^\\ce\{[\s\S]*\}$/.test(trimmed) && !/\$/.test(trimmed)) {
    return `$${trimmed}$`;
  }
  if (/^\\pu\{[\s\S]*\}$/.test(trimmed) && !/\$/.test(trimmed)) {
    return `$${trimmed}$`;
  }
  if (/\\ce\{|\\pu\{/.test(trimmed)) {
    return wrapMhchemBlocksInMathDelimiters(trimmed);
  }
  if ((/\^{|\_{/.test(trimmed) || /\\frac|\\sqrt/.test(trimmed)) && !/\$/.test(trimmed)) {
    return `$${trimmed}$`;
  }
  return trimmed;
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
    return katex.renderToString(tex, {
      ...KATEX_OPTS,
      displayMode,
    });
  } catch {
    return escapeHtml(tex);
  }
}

/** Escape plain text, or typeset $…$ / \\ce{…} via KaTeX + mhchem. */
export function formatStudyHtml(text: string): string {
  if (!text) return "";
  const prepared = prepareForRender(text);
  if (!prepared) return "";
  if (!containsMathOrChemistry(prepared)) return escapeHtml(prepared);

  return prepared
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g)
    .map((part) => {
      if (!part) return "";
      if (part.startsWith("$$") && part.endsWith("$$")) {
        return renderTex(part.slice(2, -2), true);
      }
      if (part.startsWith("$") && part.endsWith("$")) {
        return renderTex(part.slice(1, -1), false);
      }
      return escapeHtml(part);
    })
    .join("");
}
