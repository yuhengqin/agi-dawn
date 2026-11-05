// An article body as the server sent it (sanitised HTML, in the first HTML response), enhanced after
// hydration: code blocks get a head with the language and a copy button and are coloured on demand,
// and pictures that are not links open in the viewer, stepping through the body's pictures.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lightbox, type LightboxImage } from "../../components/ui/Lightbox";
import { IconCheck, IconChevronDown, IconCopy } from "../../components/icons";
import { copyText } from "../../lib/clipboard";
import { declaredLanguage, isPlainLanguage, languageLabel } from "./code-language";

/** Pictures worth enlarging: not inside a link, not tiny icons. */
function canZoom(img: HTMLImageElement): boolean {
  return img.dataset.readerInline !== 'true' && !img.closest("a") && !(img.naturalWidth && img.naturalWidth < 120);
}

function zoomable(root: HTMLElement): HTMLImageElement[] {
  return [...root.querySelectorAll<HTMLImageElement>("img")].filter(canZoom);
}

interface CodeControls {
  id: string;
  source: string;
  body: HTMLElement;
  tools: HTMLElement;
}

function CodeBlockTools({ source, body }: CodeControls) {
  const [collapsed, setCollapsed] = useState(body.hidden);
  const [status, setStatus] = useState<"" | "copied" | "error">("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);
  const copy = async () => {
    let ok = true;
    try { await copyText(source); } catch { ok = false; }
    if (!active.current) return;
    clearTimeout(timer.current);
    setStatus(ok ? "copied" : "error");
    timer.current = setTimeout(() => setStatus(""), ok ? 1800 : 2400);
  };
  return <>
    <button type="button" className="code-block-toggle" aria-label={collapsed ? "展开代码" : "折叠代码"} aria-expanded={!collapsed} aria-controls={body.id}
      onClick={() => { body.hidden = !collapsed; setCollapsed(!collapsed); }}><IconChevronDown size={16}/></button>
    <button type="button" className="code-block-copy" aria-label="复制代码" data-status={status || undefined} onClick={() => void copy()}>
      {status === "copied" ? <IconCheck size={16}/> : <IconCopy size={16}/>}
      <span className="code-block-status" role="status">{status === "copied" ? "已复制" : status === "error" ? "请手动复制" : ""}</span>
    </button>
  </>;
}

function enhanceCode(root: HTMLElement, prefix: string): { controls: CodeControls[]; dispose: () => void } {
  const blocks = [...root.querySelectorAll<HTMLPreElement>("pre")].filter((pre) => pre.textContent?.trim());
  const controls: CodeControls[] = [];
  if (!blocks.length) return { controls, dispose: () => {} };
  let disposed = false;
  let highlighter: Promise<typeof import("./highlight")> | undefined;
  const pending = new Map<Element, { code: HTMLElement; source: string; label: HTMLElement; language: string | undefined }>();
  // Plain code and copying are available immediately. Colour only code near the reader, and
  // download the language parser only when there is something there to colour.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const block = pending.get(entry.target);
      if (!block) continue;
      pending.delete(entry.target);
      observer.unobserve(entry.target);
      colour(block.code, block.source, block.label, block.language);
    }
  }, { rootMargin: "200px 0px" });
  const observe = (pre: HTMLPreElement, code: HTMLElement, source: string, label: HTMLElement, language: string | undefined) => {
    pending.set(pre, { code, source, label, language });
    observer.observe(pre);
  };
  for (const [index, pre] of blocks.entries()) {
    const code = pre.querySelector("code") ?? pre;
    const source = code.textContent ?? "";
    const language = declaredLanguage(pre);
    const prompt = pre.dataset.codeKind === "prompt";
    const wrapped = pre.closest<HTMLElement>(".code-block");
    if (wrapped) {
      // Enhanced by an earlier run of this effect: only the colours may still be missing.
      const label = wrapped.querySelector<HTMLElement>(".code-block-label");
      const body = wrapped.querySelector<HTMLElement>(".code-block-body")!;
      controls.push({ id: body.id, source, body, tools: wrapped.querySelector<HTMLElement>(".code-block-actions")! });
      if (!prompt && !isPlainLanguage(language) && !code.classList.contains("hljs") && label) observe(pre, code, source, label, language);
      continue;
    }
    const shell = document.createElement("div");
    shell.className = "code-block";
    const head = document.createElement("div");
    head.className = "code-block-head";
    const identity = document.createElement("span");
    identity.className = "code-block-identity";
    const dots = document.createElement("span");
    dots.className = "code-block-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) dots.append(document.createElement("i"));
    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = prompt ? `提示词${language ? " · " + languageLabel(language) : ""}` : language ? languageLabel(language) : "代码";
    const tools = document.createElement("span");
    tools.className = "code-block-actions";
    identity.append(dots, label);
    head.append(identity, tools);
    const body = document.createElement("div");
    body.className = "code-block-body";
    body.id = `${prefix}-code-${index}`;
    const gutter = document.createElement("span");
    gutter.className = "code-block-lines";
    gutter.setAttribute("aria-hidden", "true");
    const count = source.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length;
    gutter.textContent = Array.from({ length: count }, (_, i) => String(i + 1).padStart(2, "0")).join("\n");
    pre.parentNode?.insertBefore(shell, pre);
    body.append(gutter, pre);
    shell.append(head, body);
    controls.push({ id: body.id, source, body, tools });
    if (!prompt && !isPlainLanguage(language)) observe(pre, code, source, label, language);
  }
  function colour(code: HTMLElement, source: string, label: HTMLElement, language: string | undefined) {
    void (highlighter ??= import("./highlight"))
      .then(({ highlightCode }) => {
        if (disposed || !code.isConnected || code.classList.contains("hljs")) return;
        const coloured = highlightCode(source, language);
        if (!coloured) return;
        // highlight.js escapes the text it is given; its output is only that text and its own spans.
        code.innerHTML = coloured.html;
        code.classList.add("hljs");
        if (!language) label.textContent = coloured.label;
      })
      .catch(() => {});
  }
  return { controls, dispose: () => {
    disposed = true;
    observer.disconnect();
    pending.clear();
  } };
}

export function ArticleBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const [codeControls, setCodeControls] = useState<CodeControls[]>([]);
  const [images, setImages] = useState<LightboxImage[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  // Toolbars change the body's height: install them before history scroll restoration.
  // Highlighting still runs only when a code block approaches the viewport.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const enhanced = enhanceCode(ref.current, prefix);
    setCodeControls(enhanced.controls);
    return enhanced.dispose;
  }, [html, prefix]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mark = (img: HTMLImageElement) => {
      // Older snapshots did not retain SVG legends' inline identity; their saved dimensions still do.
      if(img.closest('figure span')&&img.parentElement?.textContent?.trim()&&img.naturalWidth>0&&img.naturalHeight>0&&Math.max(img.naturalWidth,img.naturalHeight)<=32)img.dataset.readerInline='true';
      if (canZoom(img)) {
        img.classList.add("zoomable");
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", img.alt ? `查看大图：${img.alt}` : "查看大图");
      } else if (img.classList.contains("zoomable")) {
        img.classList.remove("zoomable");
        img.removeAttribute("tabindex");
        img.removeAttribute("role");
        img.removeAttribute("aria-label");
      }
    };
    for (const img of root.querySelectorAll("img")) mark(img);
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLImageElement) mark(e.target);
    };
    const showImage = (e: MouseEvent | KeyboardEvent) => {
      const img = e.target instanceof HTMLImageElement ? e.target : null;
      if (!img || !img.classList.contains("zoomable")) return;
      const list = zoomable(root);
      const index = list.indexOf(img);
      if (index < 0) return;
      e.preventDefault();
      setImages(list.map((i) => ({ src: i.src, alt: i.alt })));
      setOpen(index);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") showImage(e);
    };
    root.addEventListener("load", onLoad, true);
    root.addEventListener("click", showImage);
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("load", onLoad, true);
      root.removeEventListener("click", showImage);
      root.removeEventListener("keydown", onKeyDown);
    };
  }, [html]);
  return (
    <>
      <div ref={ref} className="prose article-prose" dangerouslySetInnerHTML={{ __html: html }} />
      {codeControls.map(control => createPortal(<CodeBlockTools {...control}/>, control.tools, control.id))}
      <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </>
  );
}
