import * as cheerio from 'cheerio';
import type { CheerioAPI } from "cheerio";
import { isNonArticleImage } from "../lib/image-url.ts";

export function isPlaceholderPoster(value:string,baseUrl?:string):boolean{
  try{const url=new URL(value,baseUrl);return isNonArticleImage(value)||url.hostname==='img.spacergif.org'&&url.pathname.endsWith('/spacer.png');}catch{return true;}
}

/** Normalize before div-to-p conversion, while native fallback blocks are still inside their video. */
export function prepareVideoMarkup(html:string,baseUrl?:string):string{
  if(!/<video\b/i.test(html))return html;
  const $=cheerio.load(html,null,false);
  const address=(value:string|undefined)=>{if(!value?.trim())return null;try{const url=new URL(value,baseUrl);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}};
  const placeholder=(value:string)=>isPlaceholderPoster(value,baseUrl);
  $('video').each((_,node)=>{
    const video=$(node),poster=video.attr('poster')?.trim()||video.attr('data-poster')?.trim();
    if(!poster||placeholder(poster)){
      const style=video.attr('style')??'',match=/(?:^|;)\s*background(?:-image)?\s*:[^;]*?url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/i.exec(style);
      const cover=address(match?.[1]??match?.[2]??match?.[3]);
      if(cover&&!placeholder(cover))video.attr('poster',cover);else video.removeAttr('poster data-poster');
    }
    const playable=address(video.attr('src')?.trim()||video.attr('data-src')?.trim())
      ||video.children('source').toArray().some(source=>address($(source).attr('src')?.trim()||$(source).attr('data-src')?.trim()));
    if(playable)for(const element of video.find('p,div,section').toArray().reverse())$(element).replaceWith(` ${$(element).html()??''} `);
  });
  return $.html();
}

/** Only video sources survive; a rejected poster must not leave a player with nothing to show. */
export function normalizeVideos($: CheerioAPI): void {
  $("source").each((_, el) => {
    const source = $(el);
    if (!source.parent().is("video") || !source.attr("src")?.trim()) source.remove();
  });
  $("video").each((_, el) => {
    const video = $(el);
    const poster = video.attr("poster");
    if (poster && isPlaceholderPoster(poster)) video.removeAttr("poster");
    if (video.attr("src")?.trim() || video.children("source[src]").length) {
      video.attr({ controls: "", playsinline: "", preload: "none" });
    } else {
      video.removeAttr("controls playsinline preload");
      if (!video.attr("poster")) {
        // Unwrap safe fallback content without joining the surrounding words.
        if (el.prev) video.before(" ");
        if (el.next) video.after(" ");
        video.replaceWith(video.contents());
      }
    }
  });
}
