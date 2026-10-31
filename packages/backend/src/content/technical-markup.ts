import * as cheerio from "cheerio";
import sanitizeHtml from "sanitize-html";
import type { BodyIssue } from "@agidawn/contracts/site";

const SVG_TAGS=["svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","defs","linearGradient","radialGradient","stop","marker","clipPath","title","desc","use"];
const SVG_ATTRIBUTES=["xmlns","viewBox","width","height","x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","d","points","transform","fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","font-family","font-size","font-weight","text-anchor","dominant-baseline","id","offset","stop-color","stop-opacity","markerWidth","markerHeight","refX","refY","orient","marker-end","marker-start","clip-path","href"];

/** Static drawings become isolated images; unsupported representations remain explicitly partial. */
export function normalizeTechnicalMarkup(html:string,_baseUrl:string,trackIssues=false):{html:string;issues:BodyIssue[]} {
  const $=cheerio.load(html,null,false);
  const issues:BodyIssue[]=[];
  const mark=(element:ReturnType<cheerio.CheerioAPI>,issue:BodyIssue)=>{
    const index=issues.push(issue)-1;
    if(trackIssues)element.attr('data-reader-issues',[element.attr('data-reader-issues'),index].filter(value=>value!==undefined).join(','));
  };
  $("pre[data-language]").each((_,node)=>{
    const pre=$(node),lang=pre.attr("data-language")??"";
    if(/^[\w-]{1,40}$/.test(lang)) pre.find("code").first().addClass(`language-${lang}`);
  });
  $(".katex").each((_,node)=>{
    const math=$(node).find("math").first();
    if(math.length) $(node).replaceWith(math.clone());
  });
  $("svg").each((_,node)=>{
    const original=$(node);
    if(original.closest("nav,header,footer,button").length) {original.remove();return;}
    // XML attributes stay literal here; the HTML parser otherwise reserializes href as xlink:href.
    const drawing=cheerio.load($.html(original),{xmlMode:true}),svg=drawing('svg').first();
    if(!svg.attr("viewBox")&&!svg.attr("width")&&!svg.attr("height")&&!svg.attr("aria-label")&&!svg.attr("role")&&!svg.text().trim()){original.remove();return;}
    const label=svg.attr("aria-label")??svg.find("title").first().text()??"";
    const imageIssues:BodyIssue[]=[];
    const unsupported=svg.find("*").toArray().some(el=>["foreignobject","image","animate","animatetransform","set"].includes(el.name.toLowerCase()))||svg.html()!.length>1024*1024;
    if(unsupported) {
      const replacement=$("<p>").text(label||"图表需在原文查看");
      mark(replacement,{kind:"missing-figure",message:"图表包含无法静态保存的内容，请对照原文。"});
      original.replaceWith(replacement);return;
    }
    if(svg.find("[class],style").length||svg.attr("class")) imageIssues.push({kind:"missing-figure",message:"图表依赖原站样式，保存的图形可能不完整。"});
    svg.find("script,style,foreignObject").remove();
    svg.find("*").addBack().each((_,el)=>{
      const element=drawing(el),style=element.attr("style")??"";
      for(const part of style.split(";")) {
        const [key,...rest]=part.split(":");const value=rest.join(":").trim();
        if(["fill","stroke","stroke-width","font-family","font-size","font-weight","text-anchor","opacity"].includes(key?.trim()??"")&&!/url|[<>]/i.test(value)) element.attr(key!.trim(),value);
      }
      for(const name of ["fill","stroke","clip-path","marker-end","marker-start"]) {
        const value=element.attr(name);if(value&&/url/i.test(value)&&!/^url\(#[\w-]+\)$/.test(value)) element.removeAttr(name);
      }
      const href=element.attr("href")??element.attr("xlink:href");
      if(href&&/^#[\w-]+$/.test(href)){element.attr('href',href);element.removeAttr('xlink:href');}
      if(href&&!/^#[\w-]+$/.test(href)) {element.removeAttr("href");element.removeAttr("xlink:href");imageIssues.push({kind:"missing-figure",message:"图表的外部引用未保存。"});}
    });
    svg.attr("xmlns","http://www.w3.org/2000/svg");
    const clean=sanitizeHtml(drawing.xml(svg),{allowedTags:SVG_TAGS,allowedAttributes:{"*":SVG_ATTRIBUTES},allowedSchemes:[],nonTextTags:["script","style"],parser:{lowerCaseTags:false,lowerCaseAttributeNames:false}});
    const image=$("<img>").attr("src",`data:image/svg+xml;base64,${Buffer.from(clean).toString("base64")}`).attr("alt",label||"文章图表");
    for(const issue of imageIssues)mark(image,issue);
    original.replaceWith(image);
  });
  $('script[type^="math/tex"],mjx-container:not(:has(math))').each((_,node)=>{
    const replacement=$("<code>").text($(node).text());
    mark(replacement,{kind:"missing-formula",message:"部分公式保留为源文本，请对照原文。"});
    $(node).replaceWith(replacement);
  });
  $("iframe,object,embed").each((_,node)=>{const replacement=$("<p>").text('互动内容请访问原文查看。');mark(replacement,{kind:"unsupported-embed",message:"互动内容无法离线保存，请访问原文。"});$(node).replaceWith(replacement);});
  return {html:$.html(),issues};
}
