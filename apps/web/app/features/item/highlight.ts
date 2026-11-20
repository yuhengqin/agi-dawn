// Syntax colours for code in article bodies, loaded only on pages that have code. Sanitised bodies keep
// code as plain text; the language is guessed here and the colours are dropped when the guess is weak.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { isPlainLanguage, languageLabel } from "./code-language";

const LABELS: Record<string, string> = {
  bash: "Shell", c: "C", cpp: "C++", csharp: "C#", css: "CSS", diff: "Diff", dockerfile: "Dockerfile",
  go: "Go", ini: "INI", java: "Java", javascript: "JavaScript", json: "JSON", kotlin: "Kotlin",
  markdown: "Markdown", python: "Python", ruby: "Ruby", rust: "Rust", sql: "SQL",
  typescript: "TypeScript", xml: "HTML / XML", yaml: "YAML",
};
for (const [name, language] of Object.entries({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown, python, ruby, rust, sql, typescript, xml, yaml,
})) hljs.registerLanguage(name, language);

/** Coloured HTML (escaped text and hljs spans only) and a language label, or null when unsure. */
export function highlightCode(source: string, declared?: string): { html: string; label: string } | null {
  const text = source.replace(/\r\n?/g, "\n");
  const length = text.trim().length;
  if (!length || length > 12_000 || isPlainLanguage(declared)) return null;
  if (declared) {
    const aliases: Record<string, string> = {
      shell: "bash", sh: "bash", zsh: "bash",
      js: "javascript", ts: "typescript", py: "python",
      html: "xml", md: "markdown", yml: "yaml",
      golang: "go", rs: "rust", cc: "cpp", cxx: "cpp", hpp: "cpp", h: "c",
      kt: "kotlin", cs: "csharp", rb: "ruby", docker: "dockerfile", toml: "ini",
    };
    const language = Object.hasOwn(aliases, declared) ? aliases[declared]! : declared;
    if (!hljs.getLanguage(language)) return null;
    return { html: hljs.highlight(text, { language, ignoreIllegals: true }).value, label: languageLabel(declared) };
  }
  if (length < 40) return null;
  const result = hljs.highlightAuto(text, Object.keys(LABELS));
  if (!result.language || result.relevance < 4) return null;
  const clear = result.relevance >= 6 && result.relevance - (result.secondBest?.relevance ?? 0) >= 2;
  return { html: result.value, label: clear ? (LABELS[result.language] ?? "代码") : "代码" };
}
