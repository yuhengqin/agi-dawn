import { normalizeTechnicalMarkup } from "./technical-markup.ts";
import { preserveWidgets, type ContentDocument as Doc, type ContentElement as El, type PreserveRule } from "./components.ts";
import { bodyAdapters, type BodyAdapterName } from "./adapters/index.ts";

export interface ContentRules {
  preserve?: PreserveRule[];
  removeSelector?: string;
  bodyAdapter?: BodyAdapterName;
}

/** Restore completed streaming boundaries without evaluating publisher scripts. */
function settleStreamedContent(document: Doc) {
  for (const script of document.querySelectorAll("script:not([src])")) {
    const type = script.getAttribute("type")?.toLowerCase();
    if (type && type !== "text/javascript" && type !== "application/javascript") continue;
    const text = script.textContent ?? "";
    const call = /\$RC\("(B:[\w:.-]+)","(S:[\w:.-]+)"\)\s*;?\s*$/.exec(text);
    if (!call) continue;
    const before = text.slice(0, call.index).trim();
    if (before && !(/^\$R[BCV]=/.test(before) && before.includes("$RC=function(") && before.endsWith("};"))) continue;
    const boundary = document.getElementById(call[1]!), segment = document.getElementById(call[2]!);
    const start = boundary?.previousSibling, parent = boundary?.parentNode;
    if (!boundary || boundary.localName !== "template" || !segment?.hasAttribute("hidden") || !parent
      || !start || start.nodeType !== 8 || !["$?", "$~"].includes(start.textContent ?? "") || segment.contains(boundary)) continue;
    let end = boundary.nextSibling, depth = 0;
    while (end) {
      if (end.nodeType === 8) {
        const marker = end.textContent;
        if (marker === "/$") {
          if (depth === 0) break;
          depth -= 1;
        } else if (["$", "$?", "$!", "$~"].includes(marker ?? "")) depth += 1;
      }
      end = end.nextSibling;
    }
    if (!end) continue;
    let fallback = boundary.nextSibling;
    parent.removeChild(boundary);
    while (fallback && fallback !== end) {
      const next = fallback.nextSibling;
      parent.removeChild(fallback);
      fallback = next;
    }
    while (segment.firstChild) parent.insertBefore(segment.firstChild, end);
    segment.remove();
    start.textContent = "$";
  }
}

/** Normalize visibility keywords and !important for Readability's literal style checks. */
function settleInlineVisibility(document: Doc) {
  for (const el of document.querySelectorAll("[style]")) {
    const style = el.getAttribute("style") ?? "";
    if (!/display|visibility/i.test(style)) continue;
    const applied = new Map<string, { value: string; important: boolean }>();
    for (const declaration of style.split(";")) {
      const colon = declaration.indexOf(":"), name = declaration.slice(0, colon).trim().toLowerCase();
      if (colon < 0 || (name !== "display" && name !== "visibility")) continue;
      const raw = declaration.slice(colon + 1).trim().toLowerCase(), important = /!\s*important$/.test(raw);
      const value = raw.replace(/!\s*important$/, "").trim();
      if (value && (important || !applied.get(name)?.important)) applied.set(name, { value, important });
    }
    el.setAttribute("style", [...applied].map(([name, { value }]) => `${name}:${value}`).join(";"));
  }
}

const collapsed = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const words = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

function hiddenIn(el: El, figure: El): boolean {
  for (let node: El | null = el; node && node !== figure; node = node.parentElement) {
    if (node.hasAttribute("hidden") || /(?:^|;)(?:display:none|visibility:hidden)(?:;|$)/.test(node.getAttribute("style") ?? "")) return true;
  }
  return false;
}

function onlyDrawings(holder: El): boolean {
  const copy = holder.cloneNode(true) as El;
  for (const svg of copy.querySelectorAll("svg")) svg.remove();
  return !collapsed(copy.textContent) && !copy.querySelector("img, picture, video");
}

function drawingText(document: Doc, el: El): string[] {
  const ids: string[] = el.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  const labelledBy = ids.map(id => collapsed(document.getElementById(id)?.textContent)).filter(Boolean);
  if (labelledBy.length) return labelledBy;
  const label = collapsed(el.getAttribute("aria-label"));
  if (label) return [label];
  if (el.localName !== "svg") return [];
  return ["title", "desc"].map(name => collapsed([...el.children].find(child => child.localName === name)?.textContent)).filter(Boolean);
}

/** Keep self-contained drawings; deduplicate accessible descriptions for styled versions. */
function describeFigureDrawings(document: Doc) {
  const figures = new Map<El, { shown: string; texts: Map<string, El> }>();
  for (const svg of document.querySelectorAll("figure svg")) {
    const figure = svg.closest("figure");
    if (!figure) continue;
    // Readability may discard aria-hidden drawing holders. Keep the quality marker on
    // the visible figure, even when its alternative text already occurs in the caption.
    const styled=!!svg.querySelector('style,[class]')||svg.hasAttribute('class')||/var\(/.test(svg.outerHTML);
    if(styled)figure.setAttribute('data-reader-figure-loss','true');
    const holder = svg.closest('[role="img"]');
    const held = holder && holder !== figure && figure.contains(holder) ? holder : null;
    const drawing = held && onlyDrawings(held) ? held : svg;
    const lines = held ? drawingText(document, held) : [];
    if (!lines.length) lines.push(...drawingText(document, svg));
    const text = lines.join(" ");
    if (!text) continue;
    let seen = figures.get(figure);
    if (!seen) {
      const copy = figure.cloneNode(true) as El;
      for (const el of copy.querySelectorAll('svg, [role="img"], [hidden], [style], [aria-hidden="true"]')) {
        if (el.localName === "svg" || (el.getAttribute("role") === "img" && onlyDrawings(el)) || el.getAttribute("aria-hidden") === "true" || hiddenIn(el, copy)) el.remove();
      }
      seen = { shown: words(copy.textContent ?? ""), texts: new Map() };
      figures.set(figure, seen);
    }
    if (seen.shown.includes(words(text))) continue;
    const earlier = seen.texts.get(text);
    if (earlier && (!hiddenIn(earlier, figure) || hiddenIn(drawing, figure))) {
      drawing.remove();
      continue;
    }
    const p = document.createElement("p");
    lines.forEach((line, i) => p.append(...(i ? [document.createElement("br"), line] : [line])));
    for (const name of ["hidden", "style"]) {
      const value = drawing.getAttribute(name);
      if (value !== null) p.setAttribute(name, value);
    }
    if (!drawing.querySelector("style,[class]") && !drawing.hasAttribute("class") && !/var\(/.test(drawing.outerHTML)) drawing.after(p);
    else { p.setAttribute("data-reader-figure-loss", "true"); drawing.replaceWith(p); }
    earlier?.remove();
    seen.texts.set(text, p);
  }
}

/** Sources recognise components before generic extraction discards their layout and controls. */
export function preparePageContent(document: Doc, url: string, rules: ContentRules) {
  settleStreamedContent(document);
  if (rules.removeSelector) for (const el of document.querySelectorAll(rules.removeSelector)) el.remove();
  settleInlineVisibility(document);
  if (rules.bodyAdapter) bodyAdapters[rules.bodyAdapter](document);
  preserveWidgets(document, rules.preserve ?? []);
  for(const figure of document.querySelectorAll('figure')){
    if(figure.querySelector('table,pre,blockquote,video,picture,img:not([data-reader-inline])'))continue;
    const chart=figure.querySelector('canvas,[role="img"],[class*="chart"],[class*="diagram"],[class*="graph"],[class*="plot"]');
    if(chart&&!figure.querySelector('svg')){
      figure.setAttribute('data-reader-figure-loss','true');
      const alternative=drawingText(document,chart).join(' ');
      if(alternative&&!words(figure.textContent??'').includes(words(alternative))){const note=document.createElement('p');note.textContent=alternative;figure.prepend(note);}
      for(const control of figure.querySelectorAll('canvas,button,input,select,[role="button"]'))control.remove();
      // Keep ordinary explanations/captions out of Readability's conditional div pruning.
      for(const holder of [...figure.querySelectorAll('div')].reverse()){
        if(hiddenIn(holder,figure))holder.remove();else holder.replaceWith(...holder.childNodes);
      }
    }
  }
  describeFigureDrawings(document);
  const technical = normalizeTechnicalMarkup(document.body.innerHTML, url, true);
  document.body.innerHTML = technical.html;
  return technical;
}
