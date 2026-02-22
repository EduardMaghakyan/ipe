import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

// Fine-grained imports — only the languages and themes we need
import themeDark from "@shikijs/themes/github-dark";
import themeLight from "@shikijs/themes/github-light";
import langTypescript from "@shikijs/langs/typescript";
import langJavascript from "@shikijs/langs/javascript";
import langPython from "@shikijs/langs/python";
import langGo from "@shikijs/langs/go";
import langCss from "@shikijs/langs/css";
import langSql from "@shikijs/langs/sql";
import langJson from "@shikijs/langs/json";
import langYaml from "@shikijs/langs/yaml";
import langHtml from "@shikijs/langs/html";
import langRust from "@shikijs/langs/rust";
import langDiff from "@shikijs/langs/diff";
import langBash from "@shikijs/langs/bash";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  css: "css",
  scss: "css",
  less: "css",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  svelte: "html",
  vue: "html",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "text",
  txt: "text",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [themeDark, themeLight],
      langs: [
        langTypescript,
        langJavascript,
        langPython,
        langGo,
        langCss,
        langSql,
        langJson,
        langYaml,
        langHtml,
        langRust,
        langDiff,
        langBash,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

export function langFromPath(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return EXT_TO_LANG[ext] ?? "text";
}

export async function highlightCode(
  code: string,
  lang: string,
  theme: "dark" | "light",
): Promise<string> {
  const shikiTheme = theme === "dark" ? "github-dark" : "github-light";
  const highlighter = await getHighlighter();

  const resolvedLang = highlighter.getLoadedLanguages().includes(lang)
    ? lang
    : "text";

  return highlighter.codeToHtml(code, {
    lang: resolvedLang,
    theme: shikiTheme,
  });
}
