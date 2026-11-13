import type { parseHTML } from "linkedom";

export type ContentDocument = ReturnType<typeof parseHTML>["document"];
export type ContentElement = NonNullable<ReturnType<ContentDocument["querySelector"]>>;

/** Source declarations recognise widgets; converters produce portable article markup. */
export interface PreserveRule {
  selector: string;
  as: "pre" | "table";
  code?: string;
  caption?: string;
  kind?: "code" | "prompt";
  language?: string;
}

export function replaceComponent(original: ContentElement, replacement: ContentElement): void {
  for (const name of ["hidden", "aria-hidden", "style"]) {
    const value = original.getAttribute(name);
    if (value !== null) replacement.setAttribute(name, value);
  }
  original.replaceWith(replacement);
}

/** Inline visibility has already been normalized by the page preparation stage. */
export function componentHidden(element: ContentElement): boolean {
  return element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true"
    || /(?:^|;)(?:display:none|visibility:hidden)(?:;|$)/.test(element.getAttribute("style") ?? "");
}

/** Labels are read across inline spans; code uses its original whitespace instead. */
export function componentText(element: ContentElement | null | undefined): string {
  if (!element || componentHidden(element)) return "";
  const copy = element.cloneNode(true) as ContentElement;
  for (const hidden of copy.querySelectorAll('script, style, [hidden], [aria-hidden="true"]')) hidden.remove();
  for (const styled of copy.querySelectorAll("[style]")) if (componentHidden(styled)) styled.remove();
  for (const br of copy.querySelectorAll("br")) br.replaceWith(" ");
  for (const span of copy.querySelectorAll("span,tspan")) { span.before(" "); span.after(" "); }
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Reject partial rows; write cells as text so source labels cannot introduce markup. */
export function componentTable(document: ContentDocument, headers: string[], rows: string[][]): ContentElement | null {
  if (headers.length < 2 || !rows.length || rows.some(row => row.length !== headers.length || row.some(cell => !cell.trim()))) return null;
  const table = document.createElement("table"), head = document.createElement("thead"), body = document.createElement("tbody");
  const row = (values: string[], heading: boolean) => {
    const tr = document.createElement("tr");
    values.forEach((value, index) => {
      const cell = document.createElement(heading || index === 0 ? "th" : "td");
      cell.textContent = value;
      tr.append(cell);
    });
    return tr;
  };
  head.append(row(headers, true));
  rows.forEach(values => body.append(row(values, false)));
  table.append(head, body);
  return table;
}

function shownText(el: ContentElement, trim = true): string {
  const copy = el.cloneNode(true) as ContentElement;
  for (const hidden of copy.querySelectorAll('script, style, [aria-hidden="true"]')) hidden.remove();
  const text = copy.textContent ?? "";
  return trim ? text.trim() : text;
}

function codeBlock(document: ContentDocument, el: ContentElement, rule: PreserveRule): ContentElement | null {
  const text = rule.code ? el.querySelector(rule.code) : el;
  if (!text) return null;
  const pre = document.createElement("pre"), code = document.createElement("code");
  const lines=[...text.children],first=Number(lines[0]?.firstElementChild?.textContent);
  const numbered=lines.length>0&&first>=0&&lines.every((line,index)=>line.children.length===2
    &&line.firstElementChild?.localName==='span'&&line.lastElementChild?.localName==='div'
    &&line.firstElementChild.textContent?.trim()===String(first+index));
  code.textContent = numbered?lines.map(line=>shownText(line.lastElementChild!,false)).join('\n')
    :shownText(text, text.localName !== "pre" && text.localName !== "code");
  if (rule.kind) pre.setAttribute("data-code-kind", rule.kind);
  const labelLanguage = rule.language ? el.querySelector(rule.language) : null;
  const language = (labelLanguage ? shownText(labelLanguage) : null) || text.getAttribute("data-language") || el.getAttribute("data-language")
    || /(?:^|\s)language-([\w-]+)/.exec(text.getAttribute("class") ?? "")?.[1];
  if (language) pre.setAttribute("data-language", language);
  pre.append(code);
  const label = rule.caption ? el.querySelector(rule.caption) : null;
  const caption = label ? shownText(label) : "";
  if (!caption) return pre;
  const block = document.createElement("div"), p = document.createElement("p");
  p.textContent = caption;
  block.append(p, pre);
  return block;
}

function descriptionTable(document: ContentDocument, el: ContentElement): ContentElement | null {
  if(el.getAttribute('role')==='table')return ariaTable(document,el);
  const columns = [...el.children].map(column => {
    const list = column.querySelector("dl");
    const heading = [...column.children].find(child => child !== list && child.getAttribute("aria-hidden") !== "true" && shownText(child));
    return {
      label: heading ? shownText(heading) : "",
      rows: list ? [...list.querySelectorAll("dt")].map(term => ({
        label: shownText(term),
        value: term.nextElementSibling?.localName === "dd" ? shownText(term.nextElementSibling) : "",
      })) : [],
    };
  });
  const rows = columns[0]?.rows;
  if (!rows?.length || columns.some(column => !column.label || column.rows.length !== rows.length
    || column.rows.some((row, i) => !row.label || !row.value || row.label !== rows[i]!.label))) return null;
  return componentTable(document, ["", ...columns.map(column => column.label)],
    rows.map((entry, i) => [entry.label, ...columns.map(column => column.rows[i]!.value)]));
}

/** Explicit table roles preserve the source's rows before layout containers are pruned. */
function ariaTable(document:ContentDocument,el:ContentElement):ContentElement|null{
  const visible=(node:ContentElement)=>{for(let at:ContentElement|null=node;at&&at!==el;at=at.parentElement)if(componentHidden(at))return false;return true;};
  const rows=[...el.querySelectorAll('[role="row"]')].filter(row=>row.closest('[role="table"]')===el&&visible(row));
  const cells=rows.map(row=>[...row.querySelectorAll('[role="columnheader"],[role="rowheader"],[role="cell"]')].filter(cell=>cell.closest('[role="row"]')===row&&visible(cell)));
  const width=cells[0]?.length??0;
  if(cells.flat().some(cell=>['aria-colspan','aria-rowspan','aria-colindex'].some(name=>cell.hasAttribute(name)&&cell.getAttribute(name)!=='1'))
    ||rows.some(row=>row.hasAttribute('aria-rowindex')))return null;
  if(width<2||cells.length<2||cells.some(row=>row.length!==width))return null;
  const hasHead=cells[0]!.every(cell=>cell.getAttribute('role')==='columnheader');
  const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');
  // Readability otherwise treats a small headerless table as layout despite the explicit source role.
  table.setAttribute('summary',el.getAttribute('aria-label')||'Article data table');
  cells.forEach((row,index)=>{const tr=document.createElement('tr');row.forEach(value=>{
    const cell=document.createElement(value.getAttribute('role')==='cell'?'td':'th'),copy=value.cloneNode(true) as ContentElement;
    for(const child of copy.querySelectorAll('[hidden],[aria-hidden="true"],script,style'))child.remove();
    for(const child of copy.querySelectorAll('[style]'))if(componentHidden(child))child.remove();
    cell.innerHTML=copy.innerHTML;tr.append(cell);
  });(index===0&&hasHead?head:body).append(tr);});
  if(hasHead)table.append(head);table.append(body);return table;
}

const converters = { pre: codeBlock, table: descriptionTable };

export function preserveWidgets(document: ContentDocument, rules: PreserveRule[]): void {
  for (const rule of rules) {
    for (const el of document.querySelectorAll(rule.selector)) {
      const content = converters[rule.as](document, el, rule);
      if (content) replaceComponent(el, content);
    }
  }
}
