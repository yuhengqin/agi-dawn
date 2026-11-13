import { componentHidden, componentTable, componentText, replaceComponent, type ContentDocument, type ContentElement } from "../components.ts";

const children = (element: ContentElement, tag: string) => [...element.children].filter(child => child.localName === tag);
const score = (value: string) => /^\d+(?:\.\d+)?$/.test(value) && Number(value) <= 100;
interface TableData { headers: string[]; rows: string[][] }

function completionData(holder: ContentElement): TableData | null {
  const list = holder.querySelector('ol[role="list"]');
  if (!list || componentHidden(list)) return null;
  const values = (name: string, mean: string, completed: string) =>
    name && score(mean) && /^\d+$/.test(completed) && Number(completed) <= 100 ? [name, mean, completed] : [];
  const rows = children(list, "li").filter(row => !componentHidden(row)).map(row => {
    const paragraphs = [...row.querySelectorAll("p")];
    const name = componentText(paragraphs[0]);
    const mean = /^mean\s+(\d+(?:\.\d+)?)$/.exec(componentText(paragraphs[1]))?.[1] ?? "";
    const completed = componentText(children(row, "span").at(-1));
    return paragraphs.length === 2 ? values(name, mean, completed) : [];
  });
  if (!rows.length || rows.some(row => row.length !== 3)) return null;
  for (const grid of holder.querySelectorAll('div[style*="grid-template-columns"]')) {
    const labels = children(grid, "div").filter(row => !componentHidden(row));
    if (!labels.some(row => children(row, "span").length)) continue; // the dot grid has no data labels
    const desktopRows = labels.map(row => {
      const spans = children(row, "span");
      const mean = /^(?:mean\s+)?(\d+(?:\.\d+)?)(?:\s+(high))?$/.exec(componentText(spans[2]));
      const name = componentText(spans[1]) + (mean?.[2] ? ` ${mean[2]}` : "");
      return spans.length === 3 && mean ? values(name, mean[1]!, componentText(spans[0])) : [];
    });
    if (JSON.stringify(desktopRows) !== JSON.stringify(rows)) return null;
  }
  return { headers: ["Agent", "Mean rubric score", "Tasks fully completed"], rows };
}

/** Both display versions must express the same data before either can be discarded. */
function svgData(holder: ContentElement, read: (svg: ContentElement) => TableData | null): TableData | null {
  const svgs = [...holder.querySelectorAll("svg")];
  const data = svgs.map(read), first = data[0];
  return first && data.every(value => value && JSON.stringify(value) === JSON.stringify(first)) ? first : null;
}

function effortData(holder: ContentElement): TableData | null {
  return svgData(holder, svg => {
    const labels = children(svg, "text").map(componentText);
    if (labels.join(",") !== "low,medium,high,xhigh,max") return null;
    const groups = children(svg, "g").filter(group => !componentHidden(group)).map(group => children(group, "text").map(componentText));
    const rows = groups.filter(row => row.length && !score(row[0]!));
    if (!rows.length || rows.some(row => row.length !== labels.length + 1 || row.slice(1).some(value => value !== "n/a" && !score(value)))) return null;
    // The narrow source chart abbreviates this label; its values must still agree exactly.
    for (const row of rows) if (row[0] === "Python") row[0] = "Python library";
    return { headers: ["Harness", ...labels], rows };
  });
}

function judgeData(holder: ContentElement, heading: ContentElement): TableData | null {
  const legend = heading.lastElementChild;
  const labels = legend ? children(legend, "span").map(componentText) : [];
  if (labels.length !== 2 || labels.some(label => !label) || labels[0] === labels[1]) return null;
  return svgData(holder, svg => {
    const groups = children(svg, "g").filter(group => !componentHidden(group)).map(group => children(group, "text").map(componentText)).filter(row => row.length);
    const rows = groups.map(row => {
      const pair = /^(\d+(?:\.\d+)?)\s*→\s*(\d+(?:\.\d+)?)$/.exec(row[1] ?? "");
      return row.length === 2 && row[0] && pair && score(pair[1]!) && score(pair[2]!) ? [row[0], pair[1]!, pair[2]!] : [];
    });
    return rows.length && rows.every(row => row.length === 3) ? { headers: ["Agent", ...labels], rows } : null;
  });
}

const chartStrategies = [
  { title: "Tasks fully completed, out of 100", read: completionData },
  { title: "Same model, three harnesses", read: effortData },
  { title: "Same attempts, two judges", read: judgeData },
];

/** Explicit source adapter: it recognises Browser Use structure, never computes page CSS. */
export function adaptBrowserUse(document: ContentDocument): void {
  for(const first of document.querySelectorAll('img')){
    const second=first.nextElementSibling;
    if(!first.parentElement||second?.localName!=='img'||!first.getAttribute('alt')||first.getAttribute('alt')!==second.getAttribute('alt'))continue;
    const a=new Set((first.getAttribute('class')??'').split(/\s+/)),b=new Set((second.getAttribute('class')??'').split(/\s+/));
    if(a.has('hidden')&&a.has('sm:block')&&b.has('sm:hidden')||a.has('dark:hidden')&&b.has('hidden')&&b.has('dark:block'))second.remove();
    else if(b.has('hidden')&&b.has('sm:block')&&a.has('sm:hidden')||b.has('dark:hidden')&&a.has('hidden')&&a.has('dark:block'))first.remove();
  }
  for (const authors of document.querySelectorAll('ul[aria-label="Authors"]')) {
    const names = children(authors, "li").filter(author => !componentHidden(author)).map(componentText);
    if (!names.length || names.some(name => !name)) continue;
    const meta = authors.nextElementSibling;
    if (meta?.localName === "p" && meta.querySelector("time")) meta.textContent = componentText(meta);
    const paragraph = document.createElement("p");
    paragraph.textContent = `Authors: ${names.join("; ")}`;
    replaceComponent(authors, paragraph);
  }
  for (const figure of document.querySelectorAll('figure[class*="odysseys2_root__"]')) {
    const heading = figure.firstElementChild, holder = figure.querySelector('[role="img"]');
    if (!heading || !holder) continue;
    const title = componentText(heading.firstElementChild);
    const strategy = chartStrategies.find(candidate => title.endsWith(candidate.title));
    if (!strategy) continue;
    const data = strategy.read(holder, heading);
    const table = data && componentTable(document, data.headers, data.rows);
    if (!table) {
      figure.setAttribute("data-reader-figure-loss", "true");
      continue;
    }
    replaceComponent(holder, table);
    const paragraph = document.createElement("p");
    paragraph.textContent = title;
    replaceComponent(heading, paragraph);
  }
}
