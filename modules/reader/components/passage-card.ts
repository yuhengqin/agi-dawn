import {encode} from 'uqr';
import {SITE} from '@agidawn/site';

export function passageQr(url:string){
  const {data,size}=encode(url,{border:4,ecc:'M'});
  const canvas=document.createElement('canvas'),scale=6;
  canvas.width=canvas.height=size*scale;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('当前浏览器无法绘制图片。');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#18232b';
  data.forEach((row,y)=>row.forEach((on,x)=>{if(on)ctx.fillRect(x*scale,y*scale,scale,scale);}));
  return canvas;
}

/** Canvas uses measured glyph widths so mixed Chinese and Latin text stays inside the card. */
function linesOf(ctx:CanvasRenderingContext2D,text:string,width:number,limit:number){
  const lines:string[]=[];
  let line='';
  for(const {segment} of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text)){
    if(segment==='\n'||(line&&ctx.measureText(line+segment).width>width)){
      lines.push(line);
      if(lines.length===limit){
        const last=lines[limit-1]!;
        lines[limit-1]=Array.from(last).slice(0,-1).join('')+'…';return {lines,shortened:true};
      }
      line='';
    }
    if(segment!=='\n')line+=segment;
  }
  if(line)lines.push(line);
  return {lines,shortened:false};
}

export function passageCard(quote:string,title:string,credit:string,url:string){
  const canvas=document.createElement('canvas');
  canvas.width=960;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('当前浏览器无法绘制分享图。');
  const serif='Georgia, "Songti SC", "Noto Serif CJK SC", serif',sans='system-ui, sans-serif';
  ctx.font='38px '+serif;
  const excerpt=linesOf(ctx,quote.trim(),816,18);
  ctx.font='600 30px '+sans;
  const heading=linesOf(ctx,title,590,3).lines;
  ctx.font='24px '+sans;
  const credits=linesOf(ctx,credit,590,2).lines;
  const rule=184+Math.max(2,excerpt.lines.length)*62;
  canvas.height=rule+Math.max(208,90+heading.length*42+credits.length*33);
  ctx.fillStyle='#faf9f6';ctx.fillRect(0,0,960,canvas.height);
  ctx.fillStyle='#0062df';ctx.font='600 25px '+sans;ctx.fillText(SITE.name,72,78);
  ctx.fillStyle='#202a30';ctx.font='38px '+serif;
  excerpt.lines.forEach((line,i)=>ctx.fillText(line,72,166+i*62));
  ctx.fillStyle='#d1d9d5';ctx.fillRect(72,rule,816,2);
  ctx.fillStyle='#303c42';ctx.font='600 30px '+sans;
  heading.forEach((line,i)=>ctx.fillText(line,72,rule+65+i*42));
  ctx.fillStyle='#59656b';ctx.font='24px '+sans;
  credits.forEach((line,i)=>ctx.fillText(line,72,rule+73+heading.length*42+i*33));
  const qr=passageQr(url);
  ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,724,rule+24,164,164);
  return {src:canvas.toDataURL('image/png'),shortened:excerpt.shortened};
}
