import type {CheerioAPI} from 'cheerio';
import {collapseWhitespace} from '../lib/text.ts';
import {isChineseBody} from './reading.ts';

// These component strings remain English in the publisher's Chinese storage article.
const chineseLabels=new Map([
  ['Figure 02a · Logical partition key limits','图 02a · 逻辑分区键上限'],
  ['Different clients, the same partition key','不同客户端，相同的分区键'],
  ['Figure 02b · Noisy neighbors','图 02b · 邻居干扰'],
  ['Different users, the same physical partition','不同用户，相同的物理分区'],
  ['Figure 02C · Weak partitions','图 02C · 弱分区'],
  ['The limit falls below demand','容量上限低于需求'],
  ['A partition splits when it reaches its storage limit. Each child receives half the throughput capacity.','分区达到存储上限时会拆分，每个子分区获得一半的吞吐容量。'],
  ['Figure 03 · Lack of stable aggregate growth','图 03 · 总体增长不稳定'],
  ['The same workload, different headroom','相同工作负载，不同容量余量'],
  ['1K RU/s during load testing → 1M RU/s at launch','负载测试时为 1K RU/s → 上线时为 1M RU/s'],
  ['Figure 04 · Improving performance at a global scale','图 04 · 提升全球规模下的性能'],
  ['Global traffic','全球流量'],
  ['Compute and storage capacity were often located in different regions, making cross-region requests unavoidable.','计算和存储容量往往位于不同区域，跨区域请求因此难以避免。'],
  ['Figure 05 · Improving performance at a global scale','图 05 · 提升全球规模下的性能'],
  ['p50 latency for reads','读取延迟的 p50'],
  ['Three major design changes improved read latency','三项主要设计变更降低了读取延迟。'],
]);

/** Publisher widgets need a readable fallback when their drawing has not survived extraction. */
export function normalizeOpenAIFigures($:CheerioAPI,page:URL):boolean{
  const path=page.pathname.replace(/^\/[^/]+(?=\/index\/)/,'').replace(/\/+$/,''),git=path==='/index/scaling-git-at-openai';
  const storage=/^\/index\/scaling-storage-one-billion-users-part-(?:one|two)$/.test(path);
  let changed=false;
  if(storage&&isChineseBody($.html()))$('figcaption p,figcaption h2,figcaption h3,figcaption h4').each((_,node)=>{
    const element=$(node),translated=chineseLabels.get(collapseWhitespace(element.text()));
    if(translated&&!element.find('a,code,img,video,math').length){element.text(translated);changed=true;}
  });
  const roots=new Set<import('domhandler').AnyNode>();
  if(git||storage)$('figcaption').filter((_,node)=>$(node).find('h2,h3,h4,p[data-reader-outline-slot="true"]').length>0).each((_,node)=>{
    const root=$(node).parents('figure').last()[0];if(root)roots.add(root);
  });
  const headings=$('figcaption h2,figcaption h3,figcaption h4').toArray();
  for(const root of roots)for(const heading of $(root).find('h2,h3,h4').toArray())if(!headings.includes(heading))headings.push(heading);
  for(const node of headings){
    // A paragraph keeps the old heading's ordinal slot without remaining a section heading.
    const label=$('<p>').attr('data-reader-outline-slot','true').append($('<strong>').append($(node).contents()));
    $(node).replaceWith(label);changed=true;
  }
  for(const node of roots){
    const figure=$(node);
    if(figure.find('video,picture,table,pre,math,[data-reader-math]').length)continue;
    const visibleSvg=figure.find('svg').toArray().some(svg=>{
      const size=($(svg).attr('viewBox')??$(svg).attr('viewbox')??'').trim().split(/[\s,]+/).map(Number);
      return size.length!==4||Math.max(size[2]!,size[3]!)>32;
    });
    const visibleImage=figure.find('img').toArray().some(node=>{
      const image=$(node),width=Number(image.attr('width')),height=Number(image.attr('height'));
      if(image.attr('data-reader-inline')==='true'||width>0&&height>0&&Math.max(width,height)<=32)return false;
      const source=image.attr('src')??'';
      if(source.startsWith('data:image/svg+xml;base64,')){
        const xml=Buffer.from(source.slice(source.indexOf(',')+1),'base64').toString('utf8'),box=/\bviewBox=["']([^"']+)["']/i.exec(xml);
        const size=box?.[1]?.trim().split(/[\s,]+/).map(Number);
        if(size?.length===4&&Math.max(size[2]!,size[3]!)<=32){image.attr('data-reader-inline','true');changed=true;return false;}
      }
      return true;
    });
    if(visibleImage||visibleSvg)continue;
    const notice=$('<p>').append($('<a>').attr('href',page.href).text('此图未保存，查看原文'));
    if(git){
      // Preserve all caption prose, including the surrounding explanation of nested widgets.
      const captions=figure.find('figcaption');if(captions.find('figure').length)continue;
      const prose=captions.toArray().flatMap(caption=>$(caption).contents().toArray());
      figure.after(prose);figure.empty().append(notice);
    }else{
      figure.find('p').filter((_,paragraph)=>{
        const p=$(paragraph);return p.children('a').length===1&&p.text().trim()==='此图未保存，查看原文';
      }).remove();
      figure.find('figure[data-reader-figure-status="missing"]').removeAttr('data-reader-figure-status');
      figure.find('p').filter((_,paragraph)=>{
        const p=$(paragraph);return !p.closest('figcaption').length&&!p.find('a,code,img').length&&/^0(?:\.0)?\s*\/\s*40\s*(?:个示意单位|illustrative units)$/i.test(p.text().trim());
      }).remove();
      figure.prepend(notice);
    }
    figure.attr('data-reader-figure-status','missing').removeAttr('data-reader-figure-loss');changed=true;
  }
  return changed;
}
