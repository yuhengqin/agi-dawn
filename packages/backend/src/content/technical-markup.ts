import * as cheerio from "cheerio";
import sanitizeHtml from "sanitize-html";
import type { BodyIssue } from "@agidawn/contracts/site";
import {cleanKatex} from './math.ts';

const SVG_TAGS=["svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","defs","linearGradient","radialGradient","stop","marker","clipPath","title","desc","use"];
const SVG_ATTRIBUTES=["xmlns","viewBox","width","height","x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","d","points","transform","fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","font-family","font-size","font-weight","text-anchor","dominant-baseline","id","offset","stop-color","stop-opacity","markerWidth","markerHeight","refX","refY","orient","marker-end","marker-start","clip-path","href"];

/** A heading's permalink glyph is a control, while labelled drawings and figure legends remain content. */
function isHeadingPermalinkIcon(element:ReturnType<cheerio.CheerioAPI>,baseUrl:string):boolean {
  const id=element.closest("h1,h2,h3,h4,h5,h6").attr("id"),href=element.closest("a[href]").attr("href");
  if(!id||!href||element.text().trim()||element.closest('figure,[role="img"]').length||element.is("[aria-label],[aria-labelledby],[aria-describedby]"))return false;
  if(href===`#${id}`)return true;
  try {
    const page=new URL(baseUrl),target=new URL(href,page);
    if(decodeURIComponent(target.hash.slice(1))!==id)return false;
    page.hash="";target.hash="";
    return page.href===target.href;
  } catch {return false;}
}

/** Static drawings become isolated images; unsupported representations remain explicitly partial. */
export function normalizeTechnicalMarkup(html:string,baseUrl:string,trackIssues=false):{html:string;issues:BodyIssue[]} {
  const $=cheerio.load(html,null,false);
  const issues:BodyIssue[]=[];
  const mark=(element:ReturnType<cheerio.CheerioAPI>,issue:BodyIssue)=>{
    const index=issues.push(issue)-1;
    if(trackIssues)element.attr('data-reader-issues',[element.attr('data-reader-issues'),index].filter(value=>value!==undefined).join(','));
  };
  $('figure[data-reader-figure-loss="true"]').each((_,node)=>{
    mark($(node),{kind:'missing-figure',message:'图表未能完整保存，请对照原文。'});
  });
  $("pre").each((_,node)=>{
    const pre=$(node),code=pre.find("code").first();
    const declared=pre.attr("data-language")??/(?:^|\s)language-([\w-]+)/.exec(code.attr("class")??"")?.[1]
      ??/(?:^|\s)language-([\w-]+)/.exec(pre.attr("class")??"")?.[1];
    const value=declared?.trim().toLowerCase().replace(/\s+/g,"-")??"";
    const lang=value==="c++"?"cpp":value==="c#"?"csharp":value==="f#"?"fsharp":value;
    if(/^[\w-]{1,40}$/.test(lang)){pre.attr("data-language",lang);code.addClass(`language-${lang}`);}
    else pre.removeAttr("data-language");
    if(!["code","prompt"].includes(pre.attr("data-code-kind")??""))pre.removeAttr("data-code-kind");
  });
  $(".katex").each((_,node)=>{
    const original=$(node),math=original.find("math").first();
    if(math.length){original.replaceWith(math.clone());return;}
    const holder=original.closest('[data-reader-math="katex"]').length?original.closest('[data-reader-math="katex"]')
      :original.parent().is('.katex-display')?original.parent():original;
    const clean=cleanKatex($.html(holder));
    if(clean)holder.replaceWith(clean);
    else{const note=$('<span>').append($('<a>').attr('href',baseUrl).text('公式未能保存，查看原文'));mark(note,{kind:'missing-formula',message:'部分公式未能保存，请对照原文。'});holder.replaceWith(note);}
  });
  $("svg").each((_,node)=>{
    const original=$(node);
    if(original.closest('[data-reader-math="katex"]').length)return;
    if(original.closest("nav,header,footer,button").length||isHeadingPermalinkIcon(original,baseUrl)) {original.remove();return;}
    // XML attributes stay literal here; the HTML parser otherwise reserializes href as xlink:href.
    const drawing=cheerio.load($.html(original),{xmlMode:true}),svg=drawing('svg').first();
    if(!svg.attr("viewBox")&&!svg.attr("width")&&!svg.attr("height")&&!svg.attr("aria-label")&&!svg.attr("role")&&!svg.text().trim()){original.remove();return;}
    const label=svg.attr("aria-label")??svg.find("title").first().text()??"";
    const imageIssues:BodyIssue[]=[];
    const unsupported=svg.find("*").toArray().some(el=>["foreignobject","image","animate","animatetransform","set"].includes(el.name.toLowerCase()))||svg.html()!.length>1024*1024;
    if(unsupported) {
      const replacement=$("<p>").text(label||"图表需在原文查看");
      if(!label)replacement.attr('data-reader-embed','true');
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
    const pixels=(value:string|undefined)=>value&&/^\d+(?:\.\d+)?(?:px)?$/.test(value)?parseFloat(value):0;
    const width=pixels(svg.attr('width')),height=pixels(svg.attr('height'));
    if(width>0)image.attr('width',String(width));if(height>0)image.attr('height',String(height));
    const parent=original.parent();
    if(original.closest('figure').length&&parent.is('span')&&!original.text().trim()&&parent.clone().find('svg').remove().end().text().trim()&&width>0&&height>0&&Math.max(width,height)<=32)image.attr('data-reader-inline','true');
    for(const issue of imageIssues)mark(original.closest('figure').length?original.closest('figure'):image,issue);
    original.replaceWith(image);
  });
  $('script[type^="math/tex"],mjx-container:not(:has(math))').each((_,node)=>{
    const replacement=$("<code>").text($(node).text());
    mark(replacement,{kind:"missing-formula",message:"部分公式保留为源文本，请对照原文。"});
    $(node).replaceWith(replacement);
  });
  $("iframe,object,embed").each((_,node)=>{const replacement=$("<p>").attr('data-reader-embed','true').append($('<a>').attr('href',baseUrl).text('互动内容请访问原文查看。'));mark(replacement,{kind:"unsupported-embed",message:"互动内容无法离线保存，请访问原文。"});$(node).replaceWith(replacement);});
  return {html:$.html(),issues};
}
