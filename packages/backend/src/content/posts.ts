import * as cheerio from "cheerio";
import type {MediaItem} from "./materials.ts";
import {sanitizeBody,textToHtml} from "./sanitize.ts";

/** The original post's text and attachments enter the same permission-checked body as other articles. */
export function postBodyHtml(text:string,media:MediaItem[]=[]):string {
  const $=cheerio.load(textToHtml(text),null,false);
  for(const item of media){
    if(item.kind==="image"){
      const image=$("<img>").attr({src:item.url,alt:item.alt??""});
      if(item.width)image.attr("width",String(item.width));if(item.height)image.attr("height",String(item.height));
      $.root().append(image);
    }else $.root().append($("<p>").append($("<a>").attr("href",item.url).text("视频请查看原文")));
  }
  return sanitizeBody($.html());
}
