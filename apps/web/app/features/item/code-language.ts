const LABELS: Record<string, string> = {
  bash: "Shell", sh: "Shell", shell: "Shell", zsh: "Shell",
  text: "Text", plaintext: "Text", "plain-text": "Text",
  javascript: "JavaScript", js: "JavaScript", typescript: "TypeScript", ts: "TypeScript",
  python: "Python", py: "Python", json: "JSON", css: "CSS", sql: "SQL",
  markdown: "Markdown", md: "Markdown", xml: "HTML / XML", html: "HTML / XML", yaml: "YAML", yml: "YAML",
  go: "Go", golang: "Go", rust: "Rust", rs: "Rust", java: "Java",
  c: "C", h: "C", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++",
  csharp: "C#", cs: "C#", ruby: "Ruby", rb: "Ruby",
  kotlin: "Kotlin", kt: "Kotlin", swift: "Swift", diff: "Diff",
  dockerfile: "Dockerfile", docker: "Dockerfile",
  protobuf: "Protobuf", proto: "Protobuf", toml: "TOML", ini: "INI",
};

export const languageLabel = (language: string) => Object.hasOwn(LABELS, language) ? LABELS[language]! : language;
export const isPlainLanguage = (language: string | undefined) => !!language && ["text", "plaintext", "plain-text"].includes(language);

export function declaredLanguage(pre: HTMLPreElement): string | undefined {
  const value = pre.dataset.language ?? /(?:^|\s)language-([\w-]+)/.exec(pre.querySelector("code")?.className ?? "")?.[1]
    ?? /(?:^|\s)language-([\w-]+)/.exec(pre.className)?.[1];
  return value?.trim().toLowerCase() || undefined;
}
