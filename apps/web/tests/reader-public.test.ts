import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, webkit, expect } from "./browser.ts";
import { fakeApi, feedItem, itemDetail, readerPage, startWebServer, visit, type WebServer } from "./web-server.ts";
import type { Page } from "@playwright/test";

// Observe what is actually drawn, including an animation's temporary image, without depending on its implementation.
async function sampleViewerMotion(page:Page,selector:string){
  return page.evaluate(async selector=>{
    const samples:{ms:number;box:{x:number;y:number;width:number;height:number}|null;focused:boolean;visibleSources:string[]}[]=[];
    if(selector==='Escape'){
      const target=document.activeElement!;
      for(const type of ['keydown','keyup'])target.dispatchEvent(new KeyboardEvent(type,{key:'Escape',code:'Escape',bubbles:true}));
    }else (document.querySelector(selector) as HTMLElement).click();
    const start=performance.now();
    await new Promise<void>(resolve=>{
      const frame=()=>{
        const dialog=document.querySelector('[role="dialog"]');
        const images=[...dialog?.querySelectorAll('img')??[]].filter(img=>img.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
        const rect=images.map(img=>img.getBoundingClientRect()).sort((a,b)=>b.width-a.width)[0];
        const ms=performance.now()-start;
        const visibleSources=[...document.querySelectorAll<HTMLImageElement>('img[role="button"]')].filter(img=>img.checkVisibility({checkVisibilityCSS:true})).map(img=>img.alt);
        samples.push({ms,box:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,focused:!!document.activeElement?.closest('[role="dialog"]'),visibleSources});
        if(ms<430)requestAnimationFrame(frame);else resolve();
      };
      requestAnimationFrame(frame);
    });
    return samples;
  },selector);
}

test('article like controls share pending requests and recover together after a failure',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,release=()=>{},begun=()=>{},fail=false,liked=false;
  let pending=Promise.resolve(),started=Promise.resolve();const methods:string[]=[];
  const gate=()=>{pending=new Promise<void>(resolve=>release=resolve);started=new Promise<void>(resolve=>begun=resolve);};
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/items/shared-like')return itemDetail({id:'shared-like',title:'Shared likes',bodyHtml:'<p>Short article.</p>'});
      if(url.pathname==='/api/site/engagement')return {items:[{id:'shared-like',views:1,likes:liked?1:0,liked}]};
      if(url.pathname==='/api/site/items/shared-like/view')return {id:'shared-like',views:1,likes:liked?1:0,liked};
      if(url.pathname==='/api/site/items/shared-like/like'){
        methods.push(req.method!);begun();await pending;if(fail){res.statusCode=503;return {};}
        liked=req.method==='PUT';return {id:'shared-like',views:1,likes:liked?1:0,liked};
      }
    }));
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await visit(page,web.origin+'/items/shared-like');
    const top=page.getByRole('button',{name:/^(?:取消)?点赞$/}),bottom=page.getByRole('contentinfo',{name:'文章后续阅读'}).getByRole('button');
    gate();await bottom.click();await started;await expect(top).toBeDisabled();await expect(bottom).toBeDisabled();assert.deepEqual(methods,['PUT']);
    release();await expect(top).toHaveAttribute('aria-pressed','true');await expect(bottom).toHaveAttribute('aria-pressed','true');await expect(top).toBeEnabled();
    gate();await top.click();await started;await expect(bottom).toBeDisabled();release();
    await expect(top).toHaveAttribute('aria-pressed','false');await expect(bottom).toHaveAttribute('aria-pressed','false');assert.deepEqual(methods,['PUT','DELETE']);
    fail=true;gate();await bottom.click();await started;await expect(top).toBeDisabled();release();
    await expect(page.getByRole('status')).toContainText('点赞未能保存');await expect(top).toBeEnabled();await expect(bottom).toBeEnabled();
    await expect(top).toHaveAttribute('aria-pressed','false');await expect(bottom).toHaveAttribute('aria-pressed','false');
    fail=false;gate();await top.click();await started;release();await expect(top).toHaveAttribute('aria-pressed','true');await expect(bottom).toHaveAttribute('aria-pressed','true');
  }finally{release();await browser.close();await web?.stop();}
});

test('desktop reading improvements expose search evidence, immediate presets and an article footer',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const item=feedItem({id:'experience',title:'Agent cost guide',readingMinutes:4,matches:[{field:'body',language:'translation',snippet:'The cost of each task is visible here.'}],bodyState:{status:'partial',bodyRevision:1,refreshPending:false,issues:[{kind:'missing-figure',message:'部分图表未保存，请查看原文。'}]}});
  const article=itemDetail({...item,body:{html:'<h2 id="sec-1">Section</h2><p>Readable article.</p>',outline:[{id:'sec-1',text:'Section',level:2}],language:'translation',complete:true,readingMinutes:4},intro:null,related:[feedItem({id:'related',title:'Another useful article'})]});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage([item],url);
      if(url.pathname==='/api/site/items/experience')return article;
      if(url.pathname==='/api/site/engagement')return {items:[{id:item.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname==='/api/auth/session')return {authenticated:false};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900}});await visit(page,web.origin+'/?q=cost');
    await expect(page.locator('main h2 mark')).toHaveText('cost');
    await expect(page.getByText('正文译文命中：',{exact:false})).toContainText('cost of each task');
    await expect(page.getByText('约 4 分钟',{exact:true})).toBeVisible();
    await expect(page.getByText('正文不完整',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toHaveText('');
    await expect(page.getByText('阅读 0',{exact:true})).toHaveCount(0);
    await page.locator('summary').filter({hasText:'不限日期'}).click();await page.getByRole('button',{name:'近7天',exact:true}).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);await expect(page.getByRole('button',{name:'应用日期',exact:true})).toBeHidden();
    await page.locator('main ol > li').first().click({position:{x:10,y:5}});await expect(page).toHaveURL(web.origin+'/items/experience?q=cost&match=body%3Atranslation');
    await expect(page.getByText('中文译文',{exact:true})).toBeVisible();
    await expect(page.getByRole('contentinfo',{name:'文章后续阅读'})).toContainText('Another useful article');
    await expect(page.getByRole('contentinfo',{name:'文章后续阅读'}).getByRole('link',{name:'文末打开原文',exact:true})).toBeVisible();
  }finally{await browser.close();await web?.stop();}
});

test('Geoffrey Huntley articles omit repeated footer actions while keeping the header and further reading',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const article=itemDetail({id:'huntley-footer',title:'Huntley article',source:{id:'geoffrey-huntley',name:'Geoffrey Huntley'},author:'Geoffrey Huntley',
    topics:[{slug:'mcp',name:'MCP'}],related:[feedItem({id:'related',title:'Another useful article'})]});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/items/huntley-footer')return article;
      if(url.pathname==='/api/site/engagement')return {items:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await visit(page,web.origin+'/items/huntley-footer');
    const footer=page.getByRole('contentinfo',{name:'文章后续阅读'});
    await expect(footer.getByRole('link',{name:'文末打开原文',exact:true})).toHaveCount(0);
    await expect(footer.getByRole('button')).toHaveCount(0);
    await expect(footer.getByText('Geoffrey Huntley',{exact:true})).toHaveCount(0);
    await expect(footer.getByRole('navigation',{name:'文末主题'}).getByRole('link',{name:'MCP',exact:true})).toBeVisible();
    await expect(footer.getByRole('link',{name:'Another useful article',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Geoffrey Huntley',exact:true})).toHaveAttribute('href','/?sourceId=geoffrey-huntley');
    await expect(page.getByRole('link',{name:'打开原文',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toHaveCount(1);
  }finally{await browser.close();await web?.stop();}
});

test('search details retain the query, locate visible matches across markup and explain original-only evidence',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const lead='<p>'+('Unrelated introduction. '.repeat(150))+'</p>';
  const articles=[
    itemDetail({id:'search-visible',title:'Visible evidence',summary:null,intro:null,bodyHtml:lead+'<p id="matched">人工<strong>智能</strong> supports an ag<em>ent</em>.</p><p>agents are different.</p><pre><code class="language-javascript">const agent = 1;</code></pre><p>人工</p><p>智能</p>'+'<p>More reading. '.repeat(90)+'</p>',matches:[{field:'body',language:'original',snippet:'人工智能 supports an agent.'}]}),
    itemDetail({id:'search-original',title:'Agent internals',metadataTranslation:{title:'智能体内部实现',summary:'中文摘要。'},translation:{bodyHtml:'<p>当前显示中文内容。</p>',outline:[],complete:true},matches:[{field:'body',language:'original',snippet:'An agent works here.'}]}),
    itemDetail({id:'search-withdrawn',title:'Withdrawn body',bodyHtml:null,bodyState:{status:'not-permitted',bodyRevision:null,refreshPending:false,issues:[]},matches:[{field:'body',language:'original',snippet:'An agent used to appear here.'}]}),
  ];
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage(articles,url);
      const article=articles.find(item=>url.pathname==='/api/site/items/'+item.id);if(article)return article;
      if(url.pathname==='/api/site/engagement'||url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await visit(page,web.origin+'/?q='+encodeURIComponent('人工智能 agent'));
    await page.getByRole('link',{name:'Visible evidence',exact:true}).click();
    await expect.poll(()=>new URL(page.url()).searchParams.get('q')).toBe('人工智能 agent');
    const context=page.getByRole('region',{name:'搜索定位',exact:true});
    await expect(context).toContainText('当前页面 3 处匹配');
    assert(await page.evaluate(()=>scrollY)<100,'search entry keeps the article heading in view');
    await context.getByRole('button',{name:'定位到首处匹配',exact:true}).click();
    await expect(page.locator('#matched')).toBeInViewport();assert(await page.evaluate(()=>scrollY)>200);
    await page.getByRole('button',{name:'复制代码',exact:true}).scrollIntoViewIfNeeded();
    await expect(page.locator('pre code')).toHaveClass(/hljs/);
    await expect.poll(()=>page.evaluate(()=>Array.from(CSS.highlights.get('article-search')??[]).map(range=>range.toString()))).toEqual(['人工智能','agent','agent']);
    await page.getByRole('button',{name:'折叠代码',exact:true}).click();await expect(context).toContainText('当前页面 2 处匹配');
    await page.getByRole('button',{name:'展开代码',exact:true}).click();await expect(context).toContainText('当前页面 3 处匹配');
    const position=await page.evaluate(()=>scrollY);await page.goBack();await expect(page.getByRole('searchbox')).toHaveValue('人工智能 agent');
    await expect.poll(()=>page.evaluate(()=>CSS.highlights.has('article-search'))).toBe(false);
    await page.goForward();await expect(context).toContainText('当前页面 3 处匹配');await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(position,0);
    await visit(page,web.origin+'/?q=agent');await page.getByRole('link',{name:'智能体内部实现',exact:true}).click();
    await expect(context).toContainText('正文原文');await expect(context).toContainText('当前显示中文译文');
    await expect(context.getByRole('link',{name:'打开搜索命中的原文',exact:true})).toHaveAttribute('href',articles[1]!.links.original);
    await expect(context.getByRole('button')).toHaveCount(0);await expect(page.getByRole('region',{name:'文章正文',exact:true})).not.toContainText('An agent');
    await visit(page,web.origin+'/items/search-withdrawn?q=agent&match=body%3Aoriginal');
    await expect(context).toContainText('当前页面未找到关键词');await expect(page.getByRole('region',{name:'文章正文',exact:true})).toHaveCount(0);
    await visit(page,web.origin+'/items/search-visible?q=Fixture&match=source%3Aoriginal');await context.getByRole('button',{name:'定位到首处匹配',exact:true}).click();
    const source=page.locator('header').getByRole('link',{name:'Fixture',exact:true});await expect(source).toBeFocused();assert.equal(await source.evaluate(link=>link.tabIndex),0);
    await visit(page,web.origin+'/items/search-visible');await expect(context).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>CSS.highlights.has('article-search'))).toBe(false);
  }finally{await browser.close();await web?.stop();}
});

test('image zoom steps start at the displayed size and preserve the viewed center',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="1600"><rect width="3840" height="1600" fill="white"/><text x="1920" y="800">Center</text></svg>').toString('base64');
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/zoom')return itemDetail({id:'zoom',title:'Zoom',bodyHtml:`<img src="${picture}" alt="Wide diagram"><img src="${picture}" alt="Repeated diagram">`});if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});await visit(page,web.origin+'/items/zoom');await page.getByRole('button',{name:'查看大图：Wide diagram',exact:true}).click();
    const dialog=page.getByRole('dialog'),image=dialog.getByRole('img'),stage=page.getByRole('region',{name:'可滚动图片',exact:true});
    const geometry=()=>image.evaluate(img=>{const r=img.getBoundingClientRect(),s=img.parentElement!.getBoundingClientRect();return {width:r.width,x:(s.left+s.width/2-r.left)/r.width,y:(s.top+s.height/2-r.top)/r.height};});
    const initial=await geometry();await dialog.getByRole('button',{name:'放大图片',exact:true}).click();
    await expect.poll(async()=>(await geometry()).width/initial.width).toBeCloseTo(1.25,2);
    await expect.poll(async()=>(await geometry()).x).toBeCloseTo(initial.x,2);await expect.poll(async()=>(await geometry()).y).toBeCloseTo(initial.y,2);
    await expect(dialog.getByRole('status',{name:'图片缩放比例',exact:true})).toHaveText(/44%/);
    await dialog.getByRole('button',{name:'放大图片',exact:true}).click();await stage.evaluate(el=>{el.scrollLeft=150;el.scrollTop=30;});
    const panned=await geometry();await dialog.getByRole('button',{name:'放大图片',exact:true}).click();
    await expect.poll(async()=>(await geometry()).x).toBeCloseTo(panned.x,2);await expect.poll(async()=>(await geometry()).y).toBeCloseTo(panned.y,2);
    await dialog.getByRole('button',{name:'缩小图片',exact:true}).click();await expect.poll(async()=>(await geometry()).width).toBeCloseTo(panned.width,0);
    await dialog.getByRole('button',{name:'原尺寸',exact:true}).click();await expect.poll(async()=>(await geometry()).width).toBeCloseTo(3840,0);await expect(dialog.getByRole('status',{name:'图片缩放比例',exact:true})).toHaveText('100%');
    await dialog.getByRole('button',{name:'适应窗口',exact:true}).click();await expect.poll(async()=>(await geometry()).width).toBeCloseTo(initial.width,0);await expect(dialog.getByRole('button',{name:'缩小图片',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'放大图片',exact:true}).click();await dialog.getByRole('button',{name:'下一张',exact:true}).click();
    await expect(dialog).toHaveAttribute('aria-label','图片 2 / 2');await expect(dialog.getByRole('button',{name:'放大图片',exact:true})).toBeEnabled();await expect.poll(async()=>(await geometry()).width).toBeCloseTo(initial.width,0);
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'查看大图：Wide diagram',exact:true})).toBeFocused();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])for(const reducedMotion of ['no-preference','reduce'] as const)test(`image viewer expands from the article and keeps its image and focus until it returns (${engine.name()}, ${reducedMotion})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1200"><rect width="2400" height="1200" fill="white"/></svg>').toString('base64');
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/image-motion')return itemDetail({id:'image-motion',title:'Image motion',bodyHtml:`<p><img src="${picture}" alt="Motion diagram"></p>`});if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion});await visit(page,web.origin+'/items/image-motion');
    const source=page.getByRole('button',{name:'查看大图：Motion diagram',exact:true});await source.scrollIntoViewIfNeeded();await source.focus();const origin=(await source.boundingBox())!;
    const opening=await sampleViewerMotion(page,'img[alt="Motion diagram"]');
    const dialog=page.getByRole('dialog'),image=dialog.getByRole('img');await expect(image).toBeVisible();const expanded=(await image.boundingBox())!;
    assert(expanded.width>origin.width+100);
    assert(opening.every(frame=>frame.box||frame.visibleSources.includes('Motion diagram')),'opening keeps an image visible while handing off to the interactive viewer');
    assert(opening.some(frame=>frame.box&&frame.box.width>origin.width+5&&frame.box.width<expanded.width-5),'opening visibly passes through sizes between the article image and the fitted image');
    const closing=await sampleViewerMotion(page,'Escape');
    const returning=closing.flatMap(frame=>frame.box?[frame.box.width]:[]);
    assert(returning.every((width,at)=>!at||width<=returning[at-1]!+1),'the expanded image does not flash back after returning to the article');
    assert(closing.every(frame=>frame.box||frame.visibleSources.includes('Motion diagram')),'closing keeps an image visible through the return handoff');
    assert(closing.some(frame=>frame.box&&frame.box.width>origin.width+5&&frame.box.width<expanded.width-5),'closing visibly shrinks the retained image back towards the article');
    assert(closing.filter(frame=>frame.ms>50&&frame.ms<130).every(frame=>frame.box&&frame.focused),'the image and modal focus remain during the return animation');
    await expect(dialog).toHaveCount(0);await expect(source).toBeVisible();await expect(source).toBeFocused();
    const returned=(await source.boundingBox())!;assert(Math.abs(returned.x-origin.x)<1&&Math.abs(returned.y-origin.y)<1,'returning does not shift the article');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`image viewer returns a panned image to the current thumbnail when sources repeat (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="1600"><rect width="3840" height="1600" fill="white"/></svg>').toString('base64');
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/image-return')return itemDetail({id:'image-return',title:'Image return',bodyHtml:`<div style="display:flex;gap:60px"><img style="width:240px" src="${picture}" alt="First thumbnail"><img style="width:240px" src="${picture}" alt="Second thumbnail"></div>`});if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});await visit(page,web.origin+'/items/image-return');
    const first=page.getByRole('button',{name:'查看大图：First thumbnail',exact:true}),second=page.getByRole('button',{name:'查看大图：Second thumbnail',exact:true});
    await first.click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'下一张',exact:true}).click();await expect(dialog).toHaveAttribute('aria-label','图片 2 / 2');
    await dialog.getByRole('button',{name:'原尺寸',exact:true}).click();const stage=page.getByRole('region',{name:'可滚动图片',exact:true});await stage.evaluate(el=>{el.scrollLeft=330;el.scrollTop=100;});
    const displayed=(await dialog.getByRole('img').boundingBox())!;const target=(await second.boundingBox())!;
    const closing=await sampleViewerMotion(page,'[role="dialog"] button[aria-label="关闭"]');
    const firstFrame=closing.find(frame=>frame.box)?.box;assert(firstFrame&&Math.abs(firstFrame.width-displayed.width)<100,'closing starts at the panned scale instead of resetting to fit');
    assert(closing.filter(frame=>frame.ms>50&&frame.ms<130).every(frame=>frame.focused),'closing retains modal focus when the zoom control becomes disabled');
    assert(closing.filter(frame=>frame.ms>50&&frame.ms<130).every(frame=>frame.visibleSources.includes('First thumbnail')&&!frame.visibleSources.includes('Second thumbnail')),'a switched return restores the earlier thumbnail while only its current target remains hidden');
    const nearTarget=closing.find(frame=>frame.ms>150&&frame.box&&Math.abs(frame.box.width-target.width)<15)?.box;
    assert(nearTarget&&Math.abs(nearTarget.x-target.x)<15&&Math.abs(nearTarget.y-target.y)<15,'the return ends at the current DOM thumbnail, including when URLs repeat');
    await expect(dialog).toHaveCount(0);await expect(first).toBeVisible();await expect(second).toBeVisible();await expect(first).toBeFocused();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`image viewer survives interrupted entrances, resize, repeated close and reduced motion (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><rect width="1800" height="1200" fill="white"/></svg>').toString('base64');
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/image-lifecycle')return itemDetail({id:'image-lifecycle',title:'Image lifecycle',bodyHtml:`<img src="${picture}" alt="Lifecycle diagram">`});if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});await visit(page,web.origin+'/items/image-lifecycle');
    const source=page.getByRole('button',{name:'查看大图：Lifecycle diagram',exact:true}),dialog=page.getByRole('dialog');
    for(let n=0;n<3;n++){
      await source.click();await page.keyboard.press('Escape');await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);await expect(source).toBeVisible();await expect(source).toBeFocused();
      await expect.poll(()=>page.evaluate(src=>[...document.images].filter(img=>img.src===src).length,picture)).toBe(1);
    }
    await source.click();await dialog.getByRole('button',{name:'原尺寸',exact:true}).click();
    await page.setViewportSize({width:1100,height:800});await expect(dialog).toBeVisible();
    await dialog.getByRole('button',{name:'适应窗口',exact:true}).click();
    await page.waitForTimeout(380);await expect(dialog.getByRole('img')).toBeVisible();
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(source).toBeVisible();
    await page.emulateMedia({reducedMotion:'reduce'});await source.press('Enter');
    await expect(dialog.getByRole('button',{name:'原尺寸',exact:true})).toBeEnabled();
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(source).toBeFocused();
  }finally{await browser.close();await web?.stop();}
});

test('image viewer fades when the current thumbnail is outside the viewport and releases a replaced article',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="white"/></svg>').toString('base64');
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/items/image-offscreen')return itemDetail({id:'image-offscreen',title:'Offscreen image',bodyHtml:`<img src="${picture}" alt="Visible diagram"><div style="height:2200px"></div><img src="${picture}" alt="Distant diagram">`});
      if(url.pathname==='/api/site/items/replacement')return itemDetail({id:'replacement',title:'Replacement article',bodyHtml:'<p>New article content.</p>'});
      if(url.pathname==='/api/site/engagement')return {items:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});await visit(page,web.origin+'/items/image-offscreen');
    const source=page.getByRole('button',{name:'查看大图：Visible diagram',exact:true}),dialog=page.getByRole('dialog');
    await source.click();await dialog.getByRole('button',{name:'下一张',exact:true}).click();const before=(await dialog.getByRole('img').boundingBox())!,scroll=await page.evaluate(()=>scrollY);
    const closing=await sampleViewerMotion(page,'[role="dialog"] button[aria-label="关闭"]');
    assert(closing.filter(frame=>frame.box).every(frame=>Math.abs(frame.box!.width-before.width)<1),'an offscreen return fades in place instead of flying through the article');
    await expect(dialog).toHaveCount(0);assert.equal(await page.evaluate(()=>scrollY),scroll);await expect(source).toBeVisible();
    await source.click();await dialog.getByRole('button',{name:'原尺寸',exact:true}).click();
    await page.evaluate(()=>{void (globalThis as unknown as {__reactRouterDataRouter:{navigate:(path:string)=>Promise<void>}}).__reactRouterDataRouter.navigate('/items/replacement');});
    await expect(page.getByRole('heading',{name:'Replacement article',exact:true})).toBeVisible();await expect(dialog).toHaveCount(0);
    await expect.poll(()=>page.evaluate(src=>[...document.images].filter(img=>img.src===src).length,picture)).toBe(0);
  }finally{await browser.close();await web?.stop();}
});

test('image viewer releases its source listeners after every close',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="900"><rect width="1800" height="900" fill="white"/></svg>').toString('base64');
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/image-listeners')return itemDetail({id:'image-listeners',title:'Listener cleanup',bodyHtml:`<img src="${picture}" alt="Listener diagram">`});if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:1000}});await visit(page,web.origin+'/items/image-listeners');
    const cdp=await page.context().newCDPSession(page);
    const countListeners=async()=>{
      const {result}=await cdp.send('Runtime.evaluate',{expression:'document.querySelector(\'img[alt="Listener diagram"]\')'});
      const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:result.objectId!});
      await cdp.send('Runtime.releaseObject',{objectId:result.objectId!});
      return listeners.filter(listener=>listener.type==='medium-zoom:close'||listener.type==='medium-zoom:closed').length;
    };
    const source=page.getByRole('button',{name:'查看大图：Listener diagram',exact:true});assert.equal(await countListeners(),0);
    for(let n=0;n<3;n++){
      await source.click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'原尺寸',exact:true}).click();
      await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(dialog).toHaveCount(0);
      assert.equal(await countListeners(),0,'completed sessions release their source event listeners');
    }
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`mixed-language search keeps hidden original evidence when the translation also matches (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const article=itemDetail({id:'mixed-search',title:'Mixed evidence',translation:{bodyHtml:'<p>AI 可以帮助完成任务。</p>',outline:[],complete:true},matches:[{field:'body',language:'translation',snippet:'AI 可以帮助完成任务。'},{field:'body',language:'original',snippet:'The foobar technique.'}]});
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/articles')return readerPage([article],url);if(url.pathname==='/api/site/items/'+article.id)return article;if(['/api/site/engagement','/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};if(url.pathname==='/api/site/topics')return {topics:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});await visit(page,web.origin+'/?q=AI+foobar');await page.getByRole('link',{name:article.title,exact:true}).click();
    const context=page.getByRole('region',{name:'搜索定位',exact:true});await expect(context).toContainText('当前页面 1 处匹配');await expect(context).toContainText('正文原文');await expect(context.getByRole('link',{name:'打开搜索命中的原文',exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'文章正文',exact:true})).not.toContainText('foobar');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`search location reveals a match at the far end of a scrolling code line (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const article=itemDetail({id:'wide-search',title:'Wide code',bodyHtml:'<pre><code class="language-text">'+('prefix '.repeat(150))+'needle</code></pre>'});
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/'+article.id)return article;if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});await visit(page,web.origin+'/items/wide-search?q=needle&match=body%3Aoriginal');
    const pre=page.locator('pre');assert.equal(await pre.evaluate(el=>el.scrollLeft),0);await page.getByRole('button',{name:'定位到首处匹配',exact:true}).click();
    await expect.poll(()=>pre.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    const visible=await page.evaluate(()=>{const match=Array.from(CSS.highlights.get('article-search')??[])[0];if(!(match instanceof Range))return false;const r=match.getBoundingClientRect(),p=document.querySelector('pre')!.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;});assert(visible,'the complete matched word is inside the horizontal viewport');
  }finally{await browser.close();await web?.stop();}
});

test('desktop floating reading tools leave the outline and pagination clickable',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const outline=Array.from({length:24},(_,n)=>({id:'sec-'+(n+1),text:'Section '+(n+1),level:n%4===1?3:2}));
  const article=itemDetail({id:'tool-clearance',title:'Tool clearance',outline,bodyHtml:outline.map(entry=>`<h${entry.level} id="${entry.id}">${entry.text}</h${entry.level}><p>${'Article paragraph. '.repeat(80)}</p>`).join('')});
  const articles=Array.from({length:60},(_,n)=>feedItem({id:'article-'+n,title:'Article '+n}));
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/items/tool-clearance')return article;
      if(url.pathname==='/api/site/articles')return readerPage(articles,url);
      if(url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname==='/api/site/engagement')return {items:[]};
      if(url.pathname==='/api/auth/session')return {authenticated:false};
    }));
    const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});await visit(page,web.origin+'/items/tool-clearance');
    for(const width of [720,800,1024,1280,1366,1440]){
      await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,1500));
      const nav=page.getByRole('navigation',{name:'本文目录',exact:true});
      const bodyBox=await page.getByRole('region',{name:'文章正文',exact:true}).boundingBox(),toolBox=await page.getByLabel('阅读显示设置',{exact:true}).boundingBox();
      assert(bodyBox&&toolBox&&bodyBox.x+bodyBox.width+8<=toolBox.x,'body leaves a separate column for floating tools at '+width);
      if(await nav.isVisible()){const navBox=await nav.boundingBox();assert(navBox&&toolBox&&navBox.x+navBox.width+8<=toolBox.x,'outline leaves a separate column for floating tools');await nav.getByRole('link',{name:'Section 20',exact:true}).click({trial:true,timeout:1500});}
    }
    await page.getByLabel('阅读显示设置',{exact:true}).click();await page.getByRole('group',{name:'正文宽度',exact:true}).getByRole('radio',{name:'宽',exact:true}).check();await page.keyboard.press('Escape');
    await page.getByRole('navigation',{name:'本文目录',exact:true}).getByRole('link',{name:'Section 20',exact:true}).click({trial:true,timeout:1500});
    await page.setViewportSize({width:1280,height:900});await visit(page,web.origin+'/');await page.evaluate(()=>scrollTo(0,1400));
    const search=page.getByRole('searchbox'),searchBox=await search.boundingBox();
    assert(searchBox&&searchBox.y>=0&&searchBox.y<100,'search remains available while browsing the middle of the list');
    const date=page.locator('summary').filter({hasText:'不限日期'});await date.click();
    await page.getByRole('button',{name:'应用日期',exact:true}).click({trial:true});
    await page.keyboard.press('Escape');await expect(date).toBeFocused();
    const entry=page.getByRole('link',{name:'Article 10',exact:true});
    await page.locator('main article').nth(9).getByRole('link',{name:'Fixture',exact:true}).evaluate(link=>link.focus({preventScroll:true}));
    await entry.evaluate(link=>scrollBy(0,link.getBoundingClientRect().top-12));await page.keyboard.press('Tab');
    await expect(entry).toBeFocused();
    await expect.poll(async()=>{
      const target=await entry.boundingBox(),toolbar=await page.getByRole('group',{name:'文章检索工具',exact:true}).boundingBox();
      return target&&toolbar?target.y-toolbar.y-toolbar.height:-1;
    }).toBeGreaterThanOrEqual(0);
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    await page.getByRole('combobox',{name:'每页篇数',exact:true}).click({trial:true,timeout:1500});
  }finally{await browser.close();await web?.stop();}
});

test('anonymous article navigation uses one quiet session probe and the viewer can enlarge and pan figures',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,me=0,probes=0;
  const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="658" height="1200"><rect width="658" height="1200" fill="white"/><text x="10" y="50">Technical diagram</text></svg>').toString('base64');
  try{
    web=await startWebServer(fakeApi((url,res)=>{
      if(/^\/api\/site\/items\/(?:first|second)$/.test(url.pathname))return itemDetail({id:url.pathname.split('/').at(-1)!,title:'Image reading',bodyHtml:`<p><img src="${picture}" alt="Tall diagram"></p>`});
      if(url.pathname==='/api/site/articles')return readerPage([feedItem({id:'first',title:'First article'}),feedItem({id:'second',title:'Second article'})],url);
      if(url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname==='/api/auth/session'){probes++;return {authenticated:false};}
      if(url.pathname==='/api/admin/me'){me++;res.statusCode=401;return {};}
      if(url.pathname==='/api/site/engagement')return {items:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900}});await visit(page,web.origin+'/');await page.getByRole('link',{name:'First article',exact:true}).click();await page.waitForLoadState('networkidle');
    await page.goBack();await page.getByRole('link',{name:'Second article',exact:true}).click();await page.waitForLoadState('networkidle');assert.equal(me,0);assert.equal(probes,1);
    await page.getByRole('button',{name:'查看大图：Tall diagram',exact:true}).click();
    const image=page.getByRole('dialog').getByRole('img'),before=await image.boundingBox();
    await page.getByRole('button',{name:'放大图片',exact:true}).click();
    await expect.poll(async()=>(await image.boundingBox())!.height).toBeGreaterThan(before!.height+100);
    const stage=page.getByRole('region',{name:'可滚动图片',exact:true});await expect(stage).toHaveAttribute('tabindex','0');
    const box=(await stage.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-120,{steps:6});await page.mouse.up();await expect.poll(()=>stage.evaluate(element=>element.scrollTop)).toBeGreaterThan(80);
    await page.getByRole('button',{name:'原尺寸',exact:true}).click();await expect.poll(()=>image.evaluate((element:HTMLImageElement)=>Math.abs(element.getBoundingClientRect().width-element.naturalWidth))).toBeLessThan(1);
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'查看大图：Tall diagram',exact:true})).toBeFocused();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`saved small figure legends remain inline and ordinary illustrations retain the viewer (${engine.name()})`,async()=>{
  const picture=(size:number)=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/3}"/></svg>`).toString('base64');
  const article=itemDetail({id:'inline-legend',title:'Inline legend',bodyHtml:`<figure><p><span id="legend-label"><img src="${picture(10)}" alt="Legend dot">Completed tasks</span></p></figure><p><img src="${picture(320)}" alt="Ordinary illustration"></p>`});
  const browser=await engine.launch();let web:WebServer|undefined;
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/'+article.id)return article;if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:1440,height:900}});await visit(page,web.origin+'/items/'+article.id);
    const dot=page.getByRole('img',{name:'Legend dot',exact:true});await expect.poll(()=>dot.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(10);
    await expect.poll(()=>dot.evaluate(img=>Math.abs(img.getBoundingClientRect().left-img.parentElement!.getBoundingClientRect().left))).toBeLessThan(3);
    await expect(page.getByRole('button',{name:'查看大图：Legend dot'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'查看大图：Ordinary illustration'})).toBeVisible();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`pagination shortcuts only act while a pagination link has focus (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const articles=Array.from({length:300},(_,i)=>feedItem({id:'shortcut-'+i,title:'Shortcut article '+i}));
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage(articles,url);
      if(url.pathname==='/api/site/engagement')return {items:(url.searchParams.get('ids')??'').split(',').map(id=>({id,views:0,likes:0,liked:false}))};
      if(url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    await visit(page,web.origin+'/?page=2');
    const nav=page.getByRole('navigation',{name:'文章分页',exact:true});
    for(const key of ['h','l','ArrowLeft','ArrowRight']){
      await page.getByRole('link',{name:'Shortcut article 25',exact:true}).press(key);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(web.origin+'/?page=2');
      await expect(nav.locator('[aria-current="page"]')).toHaveText('2');
    }
    for(const control of [page.getByRole('searchbox',{name:'搜索文章'}),page.getByRole('spinbutton',{name:'跳转页码'})]){
      await control.press('ArrowLeft');await control.press('ArrowRight');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(web.origin+'/?page=2');
    }
    await nav.getByRole('link',{name:'第 2 页',exact:true}).focus();
    for(const [key,to] of [['l',3],['h',2],['ArrowRight',3],['ArrowLeft',2]] as const){
      await page.keyboard.press(key);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(String(to));
      await expect(page).toHaveURL(web.origin+`/?page=${to}`);
      await expect(nav.getByRole('link',{name:`第 ${to} 页`,exact:true})).toBeFocused();
    }
    await nav.getByRole('link',{name:'第 2 页',exact:true}).press('Control+ArrowRight');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(web.origin+'/?page=2');
    await nav.getByRole('link',{name:'上一页',exact:true}).press('h');
    await expect(nav.locator('[aria-current="page"]')).toHaveText('1');
    await expect(nav.getByRole('link',{name:'第 1 页',exact:true})).toBeFocused();
    await page.keyboard.press('h');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(web.origin+'/');
    await page.keyboard.press('l');
    await expect(nav.locator('[aria-current="page"]')).toHaveText('2');
    await nav.getByRole('link',{name:'第 12 页',exact:true}).press('Enter');
    await expect(nav.locator('[aria-current="page"]')).toHaveText('12');
    await nav.getByRole('link',{name:'第 12 页',exact:true}).press('l');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(web.origin+'/?page=12');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`numbered pagination counts, jumps and switches page size without losing filters (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const articles=Array.from({length:165},(_,i)=>feedItem({id:'paged-'+i,title:'Paged article '+i}));
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles'){
        const q=url.searchParams.get('q');
        const items=q==='missing'?[]:q==='single'?articles.slice(0,10):q==='nine'||q==='ten'||q==='many'?Array.from({length:q==='nine'?225:q==='ten'?250:1000},(_,i)=>feedItem({id:'paged-'+i,title:'Paged article '+i})):articles;
        return readerPage(items,url);
      }
      if(url.pathname==='/api/site/engagement')return {items:(url.searchParams.get('ids')??'').split(',').map(id=>({id,views:0,likes:0,liked:false}))};
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:[{id:'source',name:'Source',url:null,description:null,articles:165,fulltext:false,latestAt:null}]};
      if(url.pathname==='/api/site/topics')return {topics:[{slug:'mcp',name:'MCP',group:'field',definition:'',brand:null,total:165,recent:1,indexable:true,latest:null}]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const filters='q=tools&category=coding&topic=mcp&sourceId=source&from=2026-10-01&to=2026-10-28';
    await visit(page,web.origin+'/?'+filters);
    await expect(page.getByRole('status',{name:'文章分页信息'})).toContainText('共 165 篇');
    await expect(page.locator('main ol article')).toHaveCount(25);
    const nav=page.getByRole('navigation',{name:'文章分页',exact:true});
    for(let number=1;number<=7;number++)await expect(nav.getByRole('link',{name:`第 ${number} 页`,exact:true})).toBeVisible();
    const controls=page.getByRole('group',{name:'文章分页控制',exact:true});
    await expect(controls.getByRole('combobox',{name:'每页篇数',exact:true})).toBeVisible();
    await expect(controls.getByRole('spinbutton',{name:'跳转页码',exact:true})).toHaveCount(0);
    await expect(controls.getByRole('button',{name:'跳转',exact:true})).toHaveCount(0);
    for(const width of [320,390]){
      await page.setViewportSize({width,height:800});await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
      for(let number=1;number<=7;number++)await expect(nav.getByRole('link',{name:`第 ${number} 页`,exact:true})).toBeVisible();
      await nav.getByRole('link',{name:'第 7 页',exact:true}).click({trial:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    await page.setViewportSize({width:1440,height:900});
    await nav.getByRole('link',{name:'第 3 页',exact:true}).click();
    await expect(page).toHaveURL(/page=3/);await expect(page.getByRole('link',{name:'Paged article 50',exact:true})).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveText('3');await expect(page).toHaveTitle(/第 3 页/);
    for(const [key,value] of new URLSearchParams(filters))assert.equal(new URL(page.url()).searchParams.get(key),value);
    await nav.getByRole('link',{name:'第 7 页',exact:true}).click();
    await expect(page).toHaveURL(/page=7/);await expect(page.locator('main ol article')).toHaveCount(15);
    await expect(nav.getByRole('link',{name:'下一页',exact:true})).toHaveCount(0);
    await page.getByRole('combobox',{name:'每页篇数',exact:true}).selectOption('50');
    await expect(page).toHaveURL(/limit=50/);assert(!new URL(page.url()).searchParams.has('page'));
    await expect(page.locator('main ol article')).toHaveCount(50);await expect(page.getByRole('link',{name:'Paged article 0',exact:true})).toBeVisible();
    await page.reload();await expect(page.getByRole('combobox',{name:'每页篇数',exact:true})).toHaveValue('50');
    await nav.getByRole('link',{name:'下一页',exact:true}).click();await expect(page).toHaveURL(/page=2/);
    await page.getByLabel('来源',{exact:true}).selectOption('');await expect(page).not.toHaveURL(/sourceId=/);
    assert(!new URL(page.url()).searchParams.has('page'));assert.equal(new URL(page.url()).searchParams.get('limit'),'50');
    await page.goBack();await expect(page).toHaveURL(/page=2/);await expect(page.getByRole('link',{name:'Paged article 50',exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'每页篇数',exact:true}).selectOption('100');await expect(page).toHaveURL(/limit=100/);
    await expect(page.locator('main ol article')).toHaveCount(100);
    await visit(page,web.origin+'/?'+filters+'&page=999&limit=50');
    await expect(page).toHaveURL(/page=4&limit=50/);await expect(page.locator('main ol article')).toHaveCount(15);
    await visit(page,web.origin+'/?'+filters+'&page=0&limit=50');
    await expect(page).toHaveURL(web.origin+'/?'+filters+'&limit=50');
    await visit(page,web.origin+'/?'+filters+'&page=1&limit=50');
    await expect(page).toHaveURL(web.origin+'/?'+filters+'&limit=50');
    await visit(page,web.origin+'/?q=missing&page=999&limit=100');
    await expect(page).toHaveURL(web.origin+'/?q=missing&limit=100');
    await expect(page.getByRole('status',{name:'文章分页信息'})).toContainText('共 0 篇');await expect(nav).toHaveCount(0);
    await expect(controls).toHaveCount(0);
    await visit(page,web.origin+'/?q=single&limit=100');
    await expect(page.locator('main ol article')).toHaveCount(10);await expect(nav).toHaveCount(0);
    await controls.getByRole('combobox',{name:'每页篇数',exact:true}).selectOption('25');await expect(page).toHaveURL(/limit=25/);
    assert.equal(new URL(page.url()).searchParams.get('q'),'single');
    for(const number of [1,9]){
      await visit(page,web.origin+`/?q=nine&page=${number}`);
      for(let target=1;target<=9;target++)await expect(nav.getByRole('link',{name:`第 ${target} 页`,exact:true})).toBeVisible();
      await expect(controls.getByRole('spinbutton',{name:'跳转页码',exact:true})).toHaveCount(0);
      await expect(controls.getByRole('button',{name:'跳转',exact:true})).toHaveCount(0);
    }
    for(const [q,totalPages,positions] of [['ten',10,[1,5,10]],['many',40,[1,20,40]]] as const){
      for(const number of positions){
        await visit(page,web.origin+`/?q=${q}&page=${number}`);
        await expect(nav.getByRole('link',{name:'第 1 页',exact:true})).toBeVisible();
        await expect(nav.getByRole('link',{name:`第 ${totalPages} 页`,exact:true})).toBeVisible();
        await expect(nav.locator('[aria-current="page"]')).toHaveText(String(number));
        await expect(controls.getByRole('spinbutton',{name:'跳转页码',exact:true})).toBeVisible();
        await expect(controls.getByRole('button',{name:'跳转',exact:true})).toBeVisible();
        if(number===20){
          for(const neighbor of [18,19,21,22])await expect(nav.getByRole('link',{name:`第 ${neighbor} 页`,exact:true})).toBeVisible();
          await nav.getByRole('link',{name:'向前跳转至第 15 页',exact:true}).click();
          await expect(nav.locator('[aria-current="page"]')).toHaveText('15');
          await nav.getByRole('link',{name:'向后跳转至第 20 页',exact:true}).click();
          await expect(nav.locator('[aria-current="page"]')).toHaveText('20');
          await page.keyboard.press('ArrowRight');
          await expect(nav.locator('[aria-current="page"]')).toHaveText('21');
          await page.keyboard.press('ArrowLeft');
          await expect(nav.locator('[aria-current="page"]')).toHaveText('20');
        }
      }
    }
    const manyFilters=filters.replace('q=tools','q=many');
    await visit(page,web.origin+'/?'+manyFilters);
    const jump=controls.getByRole('spinbutton',{name:'跳转页码',exact:true});
    await jump.fill('20');await controls.getByRole('combobox',{name:'每页篇数',exact:true}).focus();
    await expect(page).toHaveURL(web.origin+'/?'+manyFilters);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('1');await expect(jump).toHaveValue('20');
    await jump.press('Enter');await expect(page).toHaveURL(/page=20/);
    await expect(page.getByRole('link',{name:'Paged article 475',exact:true})).toBeVisible();
    await jump.fill('40');await controls.getByRole('button',{name:'跳转',exact:true}).click();
    await expect(page).toHaveURL(/page=40/);await expect(page.getByRole('link',{name:'Paged article 975',exact:true})).toBeVisible();
    for(const [key,value] of new URLSearchParams(manyFilters))assert.equal(new URL(page.url()).searchParams.get(key),value);
    await controls.getByRole('combobox',{name:'每页篇数',exact:true}).selectOption('100');
    await expect(page).toHaveURL(/limit=100/);await expect(jump).toHaveValue('1');
    await expect(nav.getByRole('link',{name:'第 10 页',exact:true})).toBeVisible();
    const plain=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:844}});
    await plain.goto(web.origin+'/?'+manyFilters);
    await plain.getByRole('combobox',{name:'每页篇数',exact:true}).selectOption('50');await plain.getByRole('button',{name:'应用数量',exact:true}).click();
    await expect(plain).toHaveURL(/limit=50/);await expect(plain.locator('main ol article')).toHaveCount(50);
    await plain.getByRole('spinbutton',{name:'跳转页码',exact:true}).fill('3');await plain.getByRole('button',{name:'跳转',exact:true}).click();
    await expect(plain).toHaveURL(/page=3/);await expect(plain.getByRole('link',{name:'Paged article 100',exact:true})).toBeVisible();
    for(const [key,value] of new URLSearchParams(manyFilters))assert.equal(new URL(plain.url()).searchParams.get(key),value);
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`empty date results recover without losing filters and use the latest matching Beijing date (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;const reads:URL[]=[];
  const latest=feedItem({id:'latest-matching',title:'Latest matching article',publishedAt:null,discoveredAt:'2026-11-02T16:30:00Z',timelineAt:'2026-11-02T16:30:00Z'});
  const filters={q:'tools',category:'coding',topic:'mcp',sourceId:'source',limit:'100'};
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles'){
        reads.push(url);
        const matches=Object.entries(filters).filter(([key])=>key!=='limit').every(([key,value])=>url.searchParams.get(key)===value);
        const dated=url.searchParams.has('from')||url.searchParams.has('to');
        return readerPage(matches&&(!dated||url.searchParams.get('from')==='2026-11-03'&&url.searchParams.get('to')==='2026-11-03')?[latest]:[],url);
      }
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:[{id:'source',name:'Source',url:null,description:null,articles:1,fulltext:false,latestAt:null}]};
      if(url.pathname==='/api/site/topics')return {topics:[{slug:'mcp',name:'MCP',group:'field',definition:'',brand:null,total:1,recent:1,indexable:true,latest:null}]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'America/Los_Angeles'});
    const selected=new URLSearchParams({...filters,from:'2026-11-04'}),origin=web.origin;
    await visit(page,origin+'/?'+selected);
    await expect(page.getByRole('heading',{name:'2026-11-04 起暂无文章',exact:true})).toBeVisible();
    await expect(page.getByRole('group',{name:'文章分页控制',exact:true})).toHaveCount(0);
    const clear=page.getByRole('link',{name:'不限日期，查看文章',exact:true});
    const recent=page.getByRole('link',{name:'查看 2026-11-03 的文章',exact:true});
    await expect(clear).toBeVisible();await expect(recent).toBeVisible();
    assert.equal(reads.length,2);
    assert.deepEqual(Object.fromEntries(reads[1]!.searchParams),{...filters,limit:'25'});
    await clear.click();await expect(page.getByRole('link',{name:latest.title,exact:true})).toBeVisible();
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),filters);
    await expect(page.getByRole('combobox',{name:'每页篇数',exact:true})).toHaveValue('100');assert.equal(reads.length,3);
    await page.goBack();await expect(page).toHaveURL(origin+'/?'+selected);
    await recent.focus();await recent.press('Enter');await expect(page.getByRole('link',{name:latest.title,exact:true})).toBeVisible();
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),{...filters,from:'2026-11-03',to:'2026-11-03'});
    const dateTrigger=page.locator('summary').filter({hasText:'2026-11-03 — 2026-11-03'});await expect(dateTrigger).toBeVisible();
    await page.goBack();await expect(page).toHaveURL(origin+'/?'+selected);
    const choose=page.getByRole('button',{name:'重新选择日期',exact:true});await choose.focus();await choose.press('Enter');
    const trigger=page.locator('summary').filter({hasText:'2026-11-04 起'});
    await expect(trigger).toBeFocused();await expect(page.getByLabel('起始日期',{exact:true})).toHaveValue('2026-11-04');
    await page.getByLabel('起始日期',{exact:true}).fill('2026-10-01');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
    await choose.click();await expect(page.getByLabel('起始日期',{exact:true})).toHaveValue('2026-11-04');await page.keyboard.press('Escape');
    await page.setViewportSize({width:1100,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const plain=await browser.newPage({javaScriptEnabled:false,viewport:{width:1440,height:900}});
    const response=await plain.goto(origin+'/?'+selected);assert.match(response!.headers()['cache-control']??'',/no-store/);
    await plain.getByRole('link',{name:'查看 2026-11-03 的文章',exact:true}).click();await expect(plain.getByRole('link',{name:latest.title,exact:true})).toBeVisible();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`empty date results distinguish ranges and omit unavailable date suggestions (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;let failSuggestion=false;const reads:URL[]=[];
  try{
    web=await startWebServer(fakeApi((url,res)=>{
      if(url.pathname==='/api/site/articles'){
        reads.push(url);if(failSuggestion&&!url.searchParams.has('from')&&!url.searchParams.has('to')){res.statusCode=503;return {code:'unavailable'};}
        return readerPage([],url);
      }
      if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    for(const [dates,heading] of [
      ['from=2026-11-04','2026-11-04 起暂无文章'],['to=2026-11-04','截至 2026-11-04 暂无文章'],
      ['from=2026-11-04&to=2026-11-04','2026-11-04 暂无文章'],['from=2026-11-01&to=2026-11-04','2026-11-01 至 2026-11-04 暂无文章'],
    ]){
      await visit(page,web.origin+'/?q=missing&'+dates);
      await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:'不限日期，查看文章',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:/^查看 .* 的文章$/})).toHaveCount(0);
      await expect(page.getByRole('group',{name:'文章分页控制',exact:true})).toHaveCount(0);
    }
    const before=reads.length;await visit(page,web.origin+'/?q=missing');assert.equal(reads.length,before+1);
    await expect(page.getByRole('link',{name:'不限日期，查看文章',exact:true})).toHaveCount(0);
    failSuggestion=true;
    await visit(page,web.origin+'/?from=2026-11-04');
    await expect(page.getByRole('link',{name:'不限日期，查看文章',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:/^查看 .* 的文章$/})).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'2026-11-04 起暂无文章',exact:true})).toBeVisible();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`reader search debounces, respects composition and clears only its query (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,slow=false;const searches:string[]=[];
  try{
    web=await startWebServer(fakeApi(async url=>{
      if(url.pathname==='/api/site/articles'){searches.push(url.searchParams.get('q')??'');if(slow)await new Promise(resolve=>setTimeout(resolve,700));return readerPage(Array.from({length:26},(_,i)=>feedItem({id:'search-'+i,title:'Search result '+i})),url);}
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage();await visit(page,web.origin+'/?category=coding&page=2');const input=page.getByRole('searchbox');
    await expect(page.getByRole('button',{name:'搜索',exact:true})).toBeEnabled();
    await input.fill('MCP');await expect(page).toHaveURL(/q=MCP/);await expect(input).toBeFocused();
    assert.equal(new URL(page.url()).searchParams.get('category'),'coding');assert(!new URL(page.url()).searchParams.has('page'));
    await input.dispatchEvent('compositionstart');await input.fill('智能');await page.waitForTimeout(450);assert.equal(new URL(page.url()).searchParams.get('q'),'MCP');
    await input.dispatchEvent('compositionend');await expect(page).toHaveURL(/q=%E6%99%BA%E8%83%BD/);
    await page.getByRole('button',{name:'清除搜索',exact:true}).click();await expect(page).not.toHaveURL(/q=/);await expect(input).toHaveValue('');
    assert.equal(new URL(page.url()).searchParams.get('category'),'coding');assert(searches.includes('智能'));
    await expect(page.getByLabel('当前筛选',{exact:true})).toHaveCount(0);
    slow=true;
    // Dispatch both actions in one turn so a loaded test host cannot consume the debounce window before the click.
    await page.evaluate(({input,link})=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'unfinished');
      input!.dispatchEvent(new Event('input',{bubbles:true}));(link as HTMLAnchorElement).click();
    },{input:await input.elementHandle(),link:await page.locator('aside').first().getByRole('link',{name:'全部类别',exact:true}).elementHandle()});
    await expect(page).toHaveURL(web.origin+'/');
    await expect(input).toHaveValue('');assert(!searches.includes('unfinished'));
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`reader filters compose pending searches, categories, topics, dates and page sizes (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,release=()=>{},begun=()=>{},finished=()=>{};
  let pending=Promise.resolve(),started=Promise.resolve(),ended=Promise.resolve(),hold:(url:URL)=>boolean=()=>false;
  const gate=(matches:(url:URL)=>boolean)=>{hold=matches;pending=new Promise<void>(resolve=>release=resolve);started=new Promise<void>(resolve=>begun=resolve);ended=new Promise<void>(resolve=>finished=resolve);};
  const base={category:'coding',topic:'mcp',from:'2026-10-01',to:'2026-10-28',limit:'50'};
  try{
    web=await startWebServer(fakeApi(async url=>{
      if(url.pathname==='/api/site/articles'){
        if(hold(url)){hold=()=>false;begun();await pending;finished();}
        return readerPage(Array.from({length:100},(_,i)=>feedItem({id:'pending-'+i,title:'Pending result '+i,source:{id:'first',name:'Source One'}})),url);
      }
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:['first','second'].map((id,i)=>({id,name:i?'Source Two':'Source One',url:null,description:null,articles:100,fulltext:false,latestAt:null}))};
      if(url.pathname==='/api/site/topics')return {topics:['mcp','agent'].map(slug=>({slug,name:slug==='mcp'?'MCP':'Agent',group:'field',definition:'',brand:null,total:100,recent:1,indexable:true,latest:null}))};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await visit(page,web.origin+'/?'+new URLSearchParams({...base,sourceId:'first',q:'old',page:'2'}));
    const input=page.getByRole('searchbox'),source=page.getByRole('combobox',{name:'来源',exact:true});
    const query=()=>Object.fromEntries(new URL(page.url()).searchParams);
    const settled=async(expected:Record<string,string>)=>{
      await expect.poll(query).toEqual(expected);
      await expect(page.getByRole('search').getByRole('status')).toBeEmpty();
      release();await ended;await expect.poll(query).toEqual(expected);
    };

    gate(url=>url.searchParams.get('q')==='Codex');
    await input.fill('Codex');await started;
    await source.selectOption('second');
    await settled({...base,sourceId:'second',q:'Codex'});await expect(input).toHaveValue('Codex');

    gate(url=>url.searchParams.get('sourceId')==='first');
    await source.selectOption('first');await started;
    await page.locator('aside').getByRole('link',{name:'全部类别',exact:true}).click();
    const uncategorized={topic:'mcp',from:'2026-10-01',to:'2026-10-28',limit:'50',sourceId:'first',q:'Codex'};
    await settled(uncategorized);

    gate(url=>url.searchParams.get('topic')==='agent');
    await page.getByRole('navigation',{name:'文章主题',exact:true}).getByRole('link',{name:'Agent',exact:true}).click();await started;
    await page.getByRole('link',{name:'移除来源：Source One',exact:true}).click();
    const topical={topic:'agent',from:'2026-10-01',to:'2026-10-28',limit:'50',q:'Codex'};
    await settled(topical);

    await page.locator('summary').filter({hasText:'2026-10-01'}).click();
    await page.getByLabel('起始日期',{exact:true}).fill('2026-10-03');
    gate(url=>url.searchParams.get('from')==='2026-10-03');
    await page.getByRole('button',{name:'应用日期',exact:true}).click();await started;
    await input.fill('updated');await input.press('Enter');
    const dated={topic:'agent',from:'2026-10-03',to:'2026-10-28',limit:'50',q:'updated'};
    await settled(dated);

    gate(url=>url.searchParams.get('q')==='latest');
    await input.fill('latest');await input.press('Enter');await started;
    await page.getByRole('combobox',{name:'每页篇数',exact:true}).selectOption('100');
    await settled({...dated,limit:'100',q:'latest'});

    gate(url=>url.searchParams.get('q')==='article-source');
    await input.fill('article-source');await input.press('Enter');await started;
    await page.locator('main article').first().getByRole('link',{name:'Source One',exact:true}).click();
    await settled({...dated,limit:'100',q:'article-source',sourceId:'first'});

    const date=page.getByRole('group',{name:'文章检索工具',exact:true}).locator('summary');
    await date.click();await page.getByLabel('起始日期',{exact:true}).fill('2026-10-05');
    gate(url=>url.searchParams.get('from')==='2026-10-05');
    await page.getByRole('button',{name:'应用日期',exact:true}).click();await started;
    await date.click();await expect(page.getByLabel('起始日期',{exact:true})).toHaveValue('2026-10-05');
    await page.getByLabel('结束日期',{exact:true}).fill('2026-10-29');
    await page.getByRole('button',{name:'应用日期',exact:true}).click();
    await settled({...dated,from:'2026-10-05',to:'2026-10-29',limit:'100',q:'article-source',sourceId:'first'});
  }finally{release();await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`reader search preserves text entered while a source request is finishing (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,release=()=>{},begun=()=>{},held=false;
  const pending=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>begun=resolve);
  try{
    web=await startWebServer(fakeApi(async url=>{
      if(url.pathname==='/api/site/articles'){
        if(url.searchParams.has('sourceId')&&!held){held=true;begun();await pending;}
        return readerPage([feedItem({id:'typing',title:'Typing result'})],url);
      }
      if(url.pathname==='/api/site/sources')return {items:[{id:'source',name:'Source',url:null,description:null,articles:1,fulltext:false,latestAt:null}]};
      if(url.pathname==='/api/site/categories')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage({viewport:{width:1280,height:800}});await visit(page,web.origin+'/?q=old&limit=50');
    await page.getByRole('combobox',{name:'来源',exact:true}).selectOption('source');await started;
    const input=page.getByRole('searchbox');
    // Hold the debounce while the earlier response commits; composition must not be overwritten either.
    await input.dispatchEvent('compositionstart');await input.fill('新输入');release();
    await expect(page).toHaveURL(/sourceId=source/);await expect(page.getByRole('search').getByRole('status')).toBeEmpty();
    await expect(input).toHaveValue('新输入');
    await input.dispatchEvent('compositionend');
    await expect.poll(()=>Object.fromEntries(new URL(page.url()).searchParams)).toEqual({q:'新输入',sourceId:'source',limit:'50'});
    await page.goBack();await expect(input).toHaveValue('old');await expect(page).not.toHaveURL(/sourceId=/);
  }finally{release();await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])for(const composing of [false,true])test(`reader search preserves ${composing?'composition':'typing'} started during history navigation (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,release=()=>{},begun=()=>{},hold=false;
  const pending=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>begun=resolve),searches:string[]=[];
  try{
    web=await startWebServer(fakeApi(async url=>{
      if(url.pathname==='/api/site/articles'){
        searches.push(url.searchParams.get('q')??'');
        if(hold&&!url.searchParams.has('sourceId')){hold=false;begun();await pending;}
        return readerPage([feedItem({id:'history-input',title:'History result'})],url);
      }
      if(url.pathname==='/api/site/sources')return {items:[{id:'source',name:'Source',url:null,description:null,articles:1,fulltext:false,latestAt:null}]};
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
    await page.clock.install({time:new Date('2026-11-06T08:00:00Z')});
    await visit(page,web.origin+'/?q=old&category=coding&limit=50');
    const input=page.getByRole('searchbox'),source=page.getByRole('combobox',{name:'来源',exact:true}),status=page.getByRole('search').getByRole('status');
    await source.selectOption('source');await expect(page).toHaveURL(/sourceId=source/);await expect(status).toBeEmpty();
    // Keep the response commit inside the debounce window without relying on host speed.
    await page.clock.pauseAt(new Date('2026-11-06T10:00:00Z'));
    hold=true;await page.evaluate(()=>history.back());await started;await expect(status).toHaveText('正在更新…');
    if(composing)await input.dispatchEvent('compositionstart');
    const value=composing?'新输入':'newword';await input.fill(value);release();
    await expect(source).toHaveValue('');await expect(status).toBeEmpty();await expect(input).toHaveValue(value);
    if(composing){
      await page.clock.runFor(400);assert(!searches.includes(value));
      await input.dispatchEvent('compositionend');
    }
    await page.clock.runFor(400);
    await expect.poll(()=>Object.fromEntries(new URL(page.url()).searchParams)).toEqual({q:value,category:'coding',limit:'50'});
    await expect(status).toBeEmpty();

    // A draft entered before the next history navigation must still be discarded.
    await input.fill('discard-before-history');await page.evaluate(()=>history.forward());
    await expect(source).toHaveValue('source');await expect(status).toBeEmpty();await expect(input).toHaveValue('old');
    await page.clock.runFor(400);assert(!searches.includes('discard-before-history'));
    await expect.poll(()=>Object.fromEntries(new URL(page.url()).searchParams)).toEqual({q:'old',category:'coding',limit:'50',sourceId:'source'});
  }finally{release();await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`reader search discards earlier drafts when history entries share a URL (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,release=()=>{},begun=()=>{},hold=false;
  const pending=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>begun=resolve),searches:string[]=[];
  try{
    web=await startWebServer(fakeApi(async url=>{
      if(url.pathname==='/api/site/articles'){
        searches.push(url.searchParams.get('q')??'');const returning=hold;
        if(hold){hold=false;begun();await pending;}
        return readerPage([feedItem({id:'same-history',title:returning?'Returned history':'Search result'})],url);
      }
      if(['/api/site/sources','/api/site/categories'].includes(url.pathname))return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
    await page.clock.install({time:new Date('2026-11-06T08:00:00Z')});await visit(page,web.origin+'/?q=old&limit=50');
    const input=page.getByRole('searchbox');await input.fill('temp');await input.press('Enter');await expect(page).toHaveURL(/q=temp/);
    await page.clock.pauseAt(new Date('2026-11-06T10:00:00Z'));
    // Replace the pushed search so two distinct history entries now have the same URL.
    await input.fill('old');await page.clock.runFor(400);await expect(page).toHaveURL(/q=old/);
    await expect(page.getByRole('search').getByRole('status')).toBeEmpty();
    await input.fill('discard-before-history');hold=true;await page.evaluate(()=>history.back());await started;release();
    await expect(page.getByRole('link',{name:'Returned history',exact:true})).toBeVisible();await expect(input).toHaveValue('old');
    await page.clock.runFor(400);assert(!searches.includes('discard-before-history'));
    await expect.poll(()=>Object.fromEntries(new URL(page.url()).searchParams)).toEqual({q:'old',limit:'50'});
  }finally{release();await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`empty reader results can remove only the source or keyword (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const filters={q:'missing',sourceId:'source',category:'coding',topic:'mcp',limit:'50'};
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage(url.searchParams.has('q')&&url.searchParams.has('sourceId')?[]:[feedItem({id:'recovered',title:'Recovered article'})],url);
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:[{id:'source',name:'Source',url:null,description:null,articles:1,fulltext:false,latestAt:null}]};
      if(url.pathname==='/api/site/topics')return {topics:[{slug:'mcp',name:'MCP',group:'field',definition:'',brand:null,total:1,recent:1,indexable:true,latest:null}]};
    }));
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const dateRanges:Record<string,string>[]=[{},{from:'2026-10-01',to:'2026-10-28'}];
    for(const dates of dateRanges){
      const selected={...filters,...dates};
      for(const [key,label] of [['sourceId','移除来源限制'],['q','清除关键词']]){
        await visit(page,web.origin+'/?'+new URLSearchParams(selected));
        await expect(page.getByRole('group',{name:'文章分页控制',exact:true})).toHaveCount(0);
        await page.getByRole('link',{name:label,exact:true}).click();
        await expect(page.getByRole('link',{name:'Recovered article',exact:true})).toBeVisible();
        const expected={...selected};delete expected[key as keyof typeof expected];
        assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),expected);
        await expect(page.getByRole('combobox',{name:'每页篇数',exact:true})).toHaveValue('50');
      }
    }
    const plain=await browser.newPage({javaScriptEnabled:false,viewport:{width:1280,height:800}});
    await plain.goto(web.origin+'/?'+new URLSearchParams(filters));await plain.getByRole('link',{name:'清除关键词',exact:true}).click();
    await expect(plain.getByRole('link',{name:'Recovered article',exact:true})).toBeVisible();
    assert.deepEqual(Object.fromEntries(new URL(plain.url()).searchParams),{sourceId:'source',category:'coding',topic:'mcp',limit:'50'});
  }finally{await browser.close();await web?.stop();}
});

async function datePickerServer(onRead:()=>void=()=>{}){
  return startWebServer(fakeApi(url=>{
    if(url.pathname==='/api/site/articles'){onRead();return readerPage(Array.from({length:26},(_,i)=>feedItem({id:'dates-'+i,title:'Date result '+i})),url);}
    if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};
    if(url.pathname==='/api/site/topics')return {topics:[]};
  }));
}

for(const engine of [chromium,webkit])test(`date drafts validate after editing, normalize input and retain keyboard navigation (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;let reads=0;
  try{
    web=await datePickerServer(()=>reads++);
    const page=await browser.newPage({timezoneId:'America/Los_Angeles'});await visit(page,web.origin+'/?q=tools&from=2026-10-01&to=2026-10-27');
    const trigger=page.locator('summary').filter({hasText:'2026-10-01'});await trigger.click();
    const fromInput=page.getByLabel('起始日期',{exact:true}),toInput=page.getByLabel('结束日期',{exact:true}),apply=page.getByRole('button',{name:'应用日期',exact:true});
    await fromInput.fill('2026-10-');await expect(page.getByRole('alert')).toHaveCount(0);await expect(apply).toBeDisabled();
    await fromInput.press('Tab');await expect(page.getByRole('alert')).toContainText('完整日期');await expect(fromInput).toHaveAttribute('aria-invalid','true');
    await fromInput.fill('2026-02-30');await fromInput.press('Tab');await expect(page.getByRole('alert')).toContainText('日期不存在');
    await expect(toInput).toHaveAttribute('aria-invalid','false');
    await expect(page.getByRole('button',{name:'应用日期',exact:true})).toBeDisabled();assert.equal(reads,1);
    await fromInput.fill('2026-10-28');await fromInput.press('Tab');await expect(page.getByRole('alert')).toContainText('起始日期不能晚于结束日期');
    await expect(page.getByRole('button',{name:'应用日期',exact:true})).toBeDisabled();assert.equal(reads,1);
    await page.getByRole('button',{name:'取消',exact:true}).click();await trigger.click();await expect(fromInput).toHaveValue('2026-10-01');
    await fromInput.fill('2026/10/3');await fromInput.press('Tab');await expect(fromInput).toHaveValue('2026-10-03');await expect(page.getByRole('alert')).toHaveCount(0);
    await toInput.fill('2026/10/8');await toInput.press('Enter');await expect(page).toHaveURL(/from=2026-10-03&to=2026-10-08/);
    await page.locator('summary').filter({hasText:'2026-10-03'}).click();await page.getByRole('button',{name:'近7天',exact:true}).click();
    await expect(page).not.toHaveURL(/from=2026-10-03/);
    const preset=new URL(page.url()),from=preset.searchParams.get('from')!,to=preset.searchParams.get('to')!;assert.equal((Date.parse(to)-Date.parse(from))/86400000,6);
    await page.locator('summary').filter({hasText:from}).click();
    await expect(page.getByRole('button',{name:'近7天',exact:true})).toHaveAttribute('aria-pressed','true');
    await toInput.fill('2026-10-');await expect(page.getByRole('button',{name:'近7天',exact:true})).toHaveAttribute('aria-pressed','false');
    await expect(page.getByRole('alert')).toHaveCount(0);await toInput.press('Tab');await expect(page.getByRole('alert')).toContainText('完整日期');await expect(apply).toBeDisabled();
    await page.keyboard.press('Escape');await expect(page.locator('summary').filter({hasText:from})).toBeFocused();
    await page.locator('summary').filter({hasText:from}).click();await fromInput.fill('2026-10-03');await toInput.fill('2026-10-08');await apply.click();
    await page.locator('summary').filter({hasText:'2026-10-03'}).click();await page.getByRole('button',{name:'2026年10月3日',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button',{name:'2026年10月4日',exact:true})).toBeFocused();await page.keyboard.press('PageUp');await expect(page.getByRole('button',{name:'2026年9月4日',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');await page.setViewportSize({width:320,height:700});await page.locator('summary').filter({hasText:'2026-10-03'}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await expect(page.getByRole('button',{name:'应用日期',exact:true})).toBeVisible();
    await fromInput.fill('2026-02-30');await page.getByRole('button',{name:'2026年10月5日',exact:true}).click();
    await expect(fromInput).toHaveValue('2026-10-05');await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('summary').filter({hasText:'2026-10-03'})).toBeFocused();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`date calendar edits drafts while explicit presets clear immediately (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,reads=0;
  try{
    web=await datePickerServer(()=>reads++);
    const page=await browser.newPage();const initial='/?q=tools&from=2026-10-01&to=2026-10-27&page=2';await visit(page,web.origin+initial);
    const trigger=page.locator('summary').filter({hasText:'2026-10-01'}),from=page.getByLabel('起始日期',{exact:true}),to=page.getByLabel('结束日期',{exact:true});
    const apply=page.getByRole('button',{name:'应用日期',exact:true}),all=page.getByRole('button',{name:'不限日期',exact:true});
    await trigger.click();await to.click();await page.getByRole('button',{name:'2026年10月8日',exact:true}).click();
    await expect(from).toHaveValue('2026-10-01');await expect(to).toHaveValue('2026-10-08');
    await from.click();await page.getByRole('button',{name:'2026年10月3日',exact:true}).click();await expect(to).toHaveValue('2026-10-08');
    await expect(page.getByRole('status',{name:'已选日期范围'})).toContainText('共6天');
    await page.getByRole('button',{name:'2026年10月10日',exact:true}).hover();
    await expect(page.getByRole('status',{name:'日期范围预览'})).toContainText('共8天');await expect(to).toHaveValue('2026-10-08');assert.equal(reads,1);
    await page.getByRole('button',{name:'2026年10月3日',exact:true}).click();await expect(page.getByRole('status',{name:'已选日期范围'})).toContainText('共1天');
    await apply.click();await expect(page).toHaveURL(/from=2026-10-03&to=2026-10-03/);assert(!new URL(page.url()).searchParams.has('page'));
    const current=page.locator('summary').filter({hasText:'2026-10-03'});await current.click();await all.click();await expect(page).toHaveURL(web.origin+'/?q=tools');
    await page.locator('summary').filter({hasText:'不限日期'}).click();await from.fill('2026-10-05');await expect(apply).toBeEnabled();await apply.click();
    await expect(page).toHaveURL(/from=2026-10-05/);
    assert.equal(new URL(page.url()).searchParams.get('from'),'2026-10-05');assert(!new URL(page.url()).searchParams.has('to'));
    await page.locator('summary').filter({hasText:'2026-10-05'}).click();await all.click();await expect(page).toHaveURL(web.origin+'/?q=tools');await page.locator('summary').filter({hasText:'不限日期'}).click();await to.fill('2026-10-08');await apply.click();
    await expect(page).toHaveURL(/to=2026-10-08/);
    assert.equal(new URL(page.url()).searchParams.get('to'),'2026-10-08');assert(!new URL(page.url()).searchParams.has('from'));
    await page.locator('summary').filter({hasText:'2026-10-08'}).click();await all.click();await expect(page).toHaveURL(web.origin+'/?q=tools');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`date month jumps retain drafts and today follows Beijing across time zones (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  try{
    web=await datePickerServer();const page=await browser.newPage({timezoneId:'America/Los_Angeles'});
    await page.clock.setFixedTime(new Date('2026-10-30T16:30:00Z'));await visit(page,web.origin+'/?from=2026-10-01');
    await page.locator('summary').filter({hasText:'2026-10-01'}).click();await page.getByRole('button',{name:'选择年月',exact:true}).click();
    await page.getByRole('spinbutton',{name:'年份',exact:true}).fill('2024');await page.getByRole('combobox',{name:'月份',exact:true}).selectOption('02');
    await page.locator('#reader-date-month').getByRole('button',{name:'跳转',exact:true}).click();await expect(page.getByRole('button',{name:'2024年2月29日',exact:true})).toBeVisible();
    await expect(page.getByLabel('起始日期',{exact:true})).toHaveValue('2026-10-01');await expect(page).toHaveURL(web.origin+'/?from=2026-10-01');
    await page.getByRole('button',{name:'选择年月',exact:true}).click();await page.getByRole('spinbutton',{name:'年份',exact:true}).fill('9999');await page.getByRole('combobox',{name:'月份',exact:true}).selectOption('12');
    await page.locator('#reader-date-month').getByRole('button',{name:'跳转',exact:true}).click();await expect(page.getByRole('button',{name:'9999年12月31日',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'下个月',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'设为今天',exact:true}).click();await expect(page.getByLabel('结束日期',{exact:true})).toHaveValue('2026-10-31');
    await expect(page.getByRole('button',{name:'2026年10月31日',exact:true})).toHaveAttribute('aria-current','date');
    await page.getByRole('button',{name:'应用日期',exact:true}).click();await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-31/);
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`not-found recovery searches public articles without stale filters (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const article=feedItem({id:'recovered-result',title:'找到的技术文章'});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage([article],url);
      if(url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {groups:[],topics:[]};
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const missing=web.origin+'/items/missing?q=old&category=stale&page=8';
    const response=await page.goto(missing);assert.equal(response!.status(),404);
    assert.match(response!.headers()['cache-control']!,/no-store/);
    await page.waitForFunction(()=>(globalThis as {__reactRouterDataRouter?:{state:{initialized:boolean}}}).__reactRouterDataRouter?.state.initialized);
    const input=page.getByRole('searchbox',{name:'搜索文章',exact:true});
    await input.fill('  Agent 中文 & tools  ');await expect(page).toHaveURL(missing);
    await input.press('Enter');
    await expect(page).toHaveURL(web.origin+'/?'+new URLSearchParams({q:'Agent 中文 & tools'}));
    await expect(page.getByRole('searchbox')).toHaveValue('Agent 中文 & tools');
    await expect(page.getByRole('link',{name:article.title,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();

    await visit(page,web.origin+'/does-not-exist');
    await page.getByRole('searchbox',{name:'搜索文章',exact:true}).fill('模型评测');
    await page.getByRole('search').getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page).toHaveURL(web.origin+'/?'+new URLSearchParams({q:'模型评测'}));
    await expect(page.getByRole('link',{name:article.title,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();

    await visit(page,missing);
    const main=page.getByRole('main');
    await expect(main.getByRole('link',{name:'给我们发邮件',exact:true})).toHaveAttribute('href','mailto:qin2522362171@gmail.com');
    await main.getByRole('link',{name:'探索主题',exact:true}).focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(web.origin+'/explore');
    await expect(page.getByRole('heading',{level:1,name:'探索',exact:true})).toBeVisible();
    await visit(page,missing);await page.getByRole('main').getByRole('link',{name:'浏览全部文章',exact:true}).click();
    await expect(page).toHaveURL(web.origin+'/');
    await expect(page.getByRole('link',{name:article.title,exact:true})).toBeVisible();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`not-found idle redirect respects activity, visibility and cancellation (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,releaseRoute=()=>{},begunRoute=()=>{},holdRoute=false,homeReads=0;
  const pendingRoute=new Promise<void>(resolve=>releaseRoute=resolve),startedRoute=new Promise<void>(resolve=>begunRoute=resolve);
  const article=feedItem({id:'idle-home',title:'自动返回后的文章'});
  try{
    web=await startWebServer(fakeApi(async(url,res)=>{
      if(url.pathname==='/api/site/articles'){homeReads++;return readerPage([article],url);}
      if(holdRoute&&(url.pathname==='/api/site/sources'||url.pathname==='/api/site/topics')){begunRoute();await pendingRoute;}
      if(url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/items/unavailable'){res.statusCode=500;return {};}
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await page.clock.install({time:new Date('2026-11-07T02:00:00Z')});
    await page.clock.pauseAt(new Date('2026-11-07T02:00:01Z'));
    await visit(page,web.origin+'/explore');await visit(page,web.origin+'/does-not-exist');
    const input=page.getByRole('searchbox',{name:'搜索文章',exact:true}),timer=page.getByRole('timer');
    await expect(timer).toContainText('8');
    await input.focus();await page.clock.runFor(7000);await expect(page).toHaveURL(web.origin+'/does-not-exist');
    await page.keyboard.press('ArrowLeft');await expect(timer).toContainText('8');await page.clock.runFor(7000);
    await input.fill('尚未提交');await expect(timer).toContainText('8');await page.clock.runFor(7000);
    await page.mouse.move(10,10);await expect(timer).toContainText('8');await page.clock.runFor(7999);
    await expect(page).toHaveURL(web.origin+'/does-not-exist');await expect(input).toHaveValue('尚未提交');
    await page.clock.runFor(1);await expect(page).toHaveURL(web.origin+'/');
    await expect(page.getByRole('link',{name:article.title,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();
    await page.goBack();await expect(page).toHaveURL(web.origin+'/explore');

    await visit(page,web.origin+'/items/missing');await expect(timer).toContainText('8');
    await page.clock.runFor(7000);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.runFor(30000);await expect(page).toHaveURL(web.origin+'/items/missing');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
    await expect(timer).toContainText('8');await page.clock.runFor(7999);await expect(page).toHaveURL(web.origin+'/items/missing');
    await page.getByRole('button',{name:'取消自动跳转',exact:true}).click();
    await expect(page.getByRole('status')).toHaveText('已取消自动跳转。');
    await page.clock.runFor(30000);await expect(page).toHaveURL(web.origin+'/items/missing');
    await input.fill('取消后仍可搜索');await input.press('Enter');
    await expect(page).toHaveURL(web.origin+'/?'+new URLSearchParams({q:'取消后仍可搜索'}));
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();
    await visit(page,web.origin+'/does-not-exist');await expect(timer).toContainText('8');
    holdRoute=true;const readsBeforeRoute=homeReads,moving=page.locator('aside').getByRole('link',{name:'探索',exact:true}).click();await startedRoute;
    await page.clock.runFor(20000);assert.equal(homeReads,readsBeforeRoute,'waiting for sidebar navigation must not trigger an idle navigation');
    releaseRoute();await moving;
    await expect(page.getByRole('heading',{level:1,name:'探索',exact:true})).toBeVisible();
    await page.clock.runFor(20000);await expect(page).toHaveURL(web.origin+'/explore');
    const unavailable=await page.goto(web.origin+'/items/unavailable');assert.equal(unavailable!.status(),503);
    await expect(page.getByRole('heading',{level:1,name:'暂时无法加载',exact:true})).toBeVisible();
    await expect(timer).toHaveCount(0);await page.clock.runFor(20000);
    await expect(page).toHaveURL(web.origin+'/items/unavailable');
  }finally{releaseRoute();await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`not-found idle redirect stops for pending document navigation (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,release=()=>{},begun=()=>{},releaseExplore=()=>{},begunExplore=()=>{},holdExplore=false,plainHomeReads=0;
  const pending=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>begun=resolve);
  const pendingExplore=new Promise<void>(resolve=>releaseExplore=resolve),startedExplore=new Promise<void>(resolve=>begunExplore=resolve);
  const article=feedItem({id:'idle-search',title:'等待后找到的文章'});
  try{
    web=await startWebServer(fakeApi(async(url,res)=>{
      if(url.pathname==='/api/site/articles'){
        if(url.searchParams.get('q')==='wait'){begun();await pending;}
        else plainHomeReads++;
        return readerPage([article],url);
      }
      if(holdExplore&&(url.pathname==='/api/site/sources'||url.pathname==='/api/site/topics')){begunExplore();await pendingExplore;}
      if(url.pathname==='/api/site/categories'||url.pathname==='/api/site/sources')return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/items/unavailable'){res.statusCode=500;return {};}
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await visit(page,web.origin+'/does-not-exist');await expect(page.getByRole('timer')).toContainText('8');
    const input=page.getByRole('searchbox',{name:'搜索文章',exact:true});await input.fill('wait');
    let submitError:unknown;const submitting=input.press('Enter').catch(error=>{submitError=error;});await started;
    // Clock commands can stall during native document navigation; observe the real timeout instead.
    await new Promise(resolve=>setTimeout(resolve,9000));assert.equal(plainHomeReads,0,'waiting for a search must not trigger an idle navigation');
    release();await submitting;assert.equal(submitError,undefined);
    await expect(page).toHaveURL(web.origin+'/?q=wait');await expect(page.getByRole('link',{name:article.title,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();

    await visit(page,web.origin+'/does-not-exist');await expect(page.getByRole('timer')).toContainText('8');
    holdExplore=true;let clickError:unknown;
    const clicking=page.getByRole('main').getByRole('link',{name:'探索主题',exact:true}).click().catch(error=>{clickError=error;});await startedExplore;
    await new Promise(resolve=>setTimeout(resolve,9000));assert.equal(plainHomeReads,0,'waiting for a recovery link must not trigger an idle navigation');
    releaseExplore();await clicking;assert.equal(clickError,undefined);
    await expect(page).toHaveURL(web.origin+'/explore');await expect(page.getByRole('heading',{level:1,name:'探索',exact:true})).toBeVisible();
  }finally{release();releaseExplore();await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`global categories persist and browser history restores complete list and article positions (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const article=itemDetail({id:'history-article',title:'History article',category:'coding',bodyHtml:'<pre><code>const value = 1;</code></pre>'.repeat(3)+'<p>'+('Long article paragraph.</p><p>'.repeat(100))+'</p>'});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage(Array.from({length:100},(_,i)=>feedItem({id:i===65?article.id:'history-'+i,title:i===65?article.title:'Article '+i})),url);
      if(url.pathname==='/api/site/items/'+article.id)return article;
      if(url.pathname==='/api/site/engagement')return {items:(url.searchParams.get('ids')??'').split(',').map(id=>({id,views:0,likes:0,liked:false}))};
      if(url.pathname==='/api/site/items/'+article.id+'/view')return {id:article.id,views:1,likes:0,liked:false};
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:[{id:'source',name:'Source',url:null,description:null,articles:40,fulltext:false}]};
      if(url.pathname==='/api/site/topics')return {groups:[],topics:[{slug:'topic',name:'Topic',group:'field',definition:'',brand:null,total:40,recent:1,indexable:true,latest:null}]};
    }));
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
    const list=web.origin+'/?q=tools&category=coding&topic=topic&sourceId=source&from=2026-10-01&to=2026-10-28&page=2&limit=50';await visit(page,list);
    const sidebar=page.locator('aside').first(),toggle=sidebar.getByRole('button',{name:/^类别/});await expect(toggle).toHaveAttribute('aria-expanded','true');
    await toggle.click();await expect(toggle).toHaveText('类别 · AI 编程');await toggle.click();
    const entry=page.getByRole('link',{name:article.title,exact:true});await entry.scrollIntoViewIfNeeded();const listY=await page.evaluate(()=>scrollY);assert(listY>500);
    await entry.click();await expect(page).toHaveURL(/items\/history-article/);await expect(sidebar.getByRole('link',{name:'AI 编程',exact:true})).toHaveAttribute('aria-current','page');await expect(page.getByRole('heading',{level:1,name:article.title,exact:true})).toBeFocused();
    await expect(page.locator('main').getByRole('link',{name:'文章',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:/返回文章/})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'复制代码',exact:true})).toHaveCount(3);await page.evaluate(()=>scrollTo(0,800));const articleY=await page.evaluate(()=>scrollY);await page.goBack();await expect(page).toHaveURL(list);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(listY,0);
    await expect(page.getByRole('searchbox')).toHaveValue('tools');await expect(page.getByLabel('来源',{exact:true})).toHaveValue('source');await expect(entry).toBeFocused();
    await page.goForward();await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(articleY,0);
    await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toHaveText('类别 · AI 编程');await sidebar.getByRole('link',{name:'探索',exact:true}).click();await expect(page).toHaveURL(web.origin+'/explore');await expect(page.getByRole('heading',{level:1,name:'探索',exact:true})).toBeVisible();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toHaveText('类别');
    await page.reload();await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();await expect(sidebar.getByRole('link',{name:'AI 编程',exact:true})).not.toHaveAttribute('aria-current','page');
    const fresh=await context.newPage();await visit(fresh,web.origin+'/more');await expect(fresh.locator('aside').first().getByRole('button',{name:'类别',exact:true})).toHaveAttribute('aria-expanded','true');
    const fallback=await browser.newContext({viewport:{width:390,height:667},reducedMotion:'reduce'});await fallback.addInitScript(()=>Object.defineProperty(document,'startViewTransition',{value:undefined}));
    const plain=await fallback.newPage();await visit(plain,list);const originalLink=plain.getByRole('link',{name:article.title,exact:true});await originalLink.focus();await originalLink.press('Enter');
    await expect(plain.getByRole('heading',{level:1,name:article.title,exact:true})).toBeFocused();await plain.getByRole('button',{name:'开启专注模式',exact:true}).click();await expect(plain.getByRole('button',{name:'退出专注模式',exact:true})).toHaveAttribute('aria-pressed','true');
    await plain.getByRole('button',{name:'退出专注模式',exact:true}).click();await plain.goBack();await expect(plain).toHaveURL(list);await expect(originalLink).toBeFocused();await fallback.close();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`anonymous likes persist with failure feedback and only visible details report views (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,liked=false,views=0,failLike=false,releaseView:(()=>void)|undefined;
  const article=itemDetail({id:'engagement-ui',title:'Interactive article'}),stats=()=>({id:article.id,views,likes:liked?1:0,liked});
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/articles')return readerPage([article],url);
      if(url.pathname==='/api/site/items/engagement-ui')return article;
      if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};
      if(url.pathname==='/api/site/topics')return {groups:[],topics:[]};
      if(url.pathname==='/api/site/engagement'){res.setHeader('Set-Cookie','reader_visitor=test; Path=/; HttpOnly; SameSite=Lax');return {items:[stats()]};}
      if(url.pathname==='/api/site/items/engagement-ui/like'){
        assert.match(req.headers.cookie??'',/reader_visitor=test/);assert.equal(req.headers.origin,web!.origin);
        if(failLike){res.statusCode=503;return {};}
        liked=req.method==='PUT';return stats();
      }
      if(url.pathname==='/api/site/items/engagement-ui/view'){
        const snapshot=stats();await new Promise<void>(resolve=>{releaseView=resolve;});views++;return {...snapshot,views};
      }
    }));
    const page=await browser.newPage();await visit(page,web.origin+'/');
    await expect(page.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();assert.equal(views,0);
    await page.getByRole('button',{name:'点赞',exact:true}).click();await expect(page.getByRole('button',{name:'取消点赞',exact:true})).toHaveText('1');
    await page.reload();await expect(page.getByRole('button',{name:'取消点赞',exact:true})).toHaveAttribute('aria-pressed','true');assert.equal(views,0);
    failLike=true;await page.getByRole('button',{name:'取消点赞',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'点赞未能保存'})).toBeVisible();await expect(page.getByRole('button',{name:'取消点赞',exact:true})).toHaveText('1');
    failLike=false;await page.getByRole('button',{name:'取消点赞',exact:true}).click();await expect(page.getByRole('button',{name:'点赞',exact:true})).toHaveText('');
    await page.addInitScript(()=>Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}));
    await visit(page,web.origin+'/items/engagement-ui');await expect(page.getByRole('button',{name:'点赞',exact:true})).toBeVisible();assert.equal(releaseView,undefined);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
    await expect.poll(()=>!!releaseView).toBe(true);
    await page.getByRole('button',{name:'点赞',exact:true}).click();await expect(page.getByRole('button',{name:'取消点赞',exact:true})).toHaveText('1');
    releaseView!();await expect(page.getByText('阅读 1',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'取消点赞',exact:true})).toHaveText('1');
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(views,1);
  }finally{releaseView?.();await browser.close();await web?.stop();}
});

test('simultaneous first tabs establish one anonymous browser identity',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,minted=0,releaseFirst:(()=>void)|undefined;
  const article=feedItem({id:'two-tabs',title:'Two tabs'});
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/articles')return readerPage([article],url);
      if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};
      if(url.pathname==='/api/site/topics')return {groups:[],topics:[]};
      if(url.pathname==='/api/site/engagement'){
        if(!req.headers.cookie?.includes('reader_visitor=')){
          const token=++minted;if(token===1)await new Promise<void>(resolve=>{releaseFirst=resolve;});
          res.setHeader('Set-Cookie',`reader_visitor=visitor-${token}; Path=/; HttpOnly; SameSite=Lax`);
        }
        return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      }
    }));
    const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
    await visit(a,web.origin+'/');await expect.poll(()=>!!releaseFirst).toBe(true);await visit(b,web.origin+'/');await b.waitForLoadState('networkidle');
    releaseFirst!();await expect(a.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();await expect(b.getByRole('button',{name:'点赞',exact:true})).toBeEnabled();
    assert.equal(minted,1);
  }finally{releaseFirst?.();await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`mobile categories and additional topics preserve independent selections (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const topics=Array.from({length:8},(_,i)=>({slug:'topic-'+i,name:'技术主题 '+i,group:'field',definition:'Topic',brand:null,total:1,recent:1,indexable:true,latest:null}));
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage([feedItem({id:'mobile-nav',title:'Navigation result'})],url);
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/topics')return {groups:[],topics};
      if(url.pathname==='/api/site/sources')return {items:[]};
    }));
    const page=await browser.newPage({viewport:{width:390,height:844}});await visit(page,web.origin+'/');
    await page.getByText('类别：全部类别',{exact:false}).click();await page.getByRole('navigation',{name:'文章类别'}).getByRole('link',{name:'AI 编程',exact:true}).click();await expect(page).toHaveURL(/category=coding/);
    await page.getByText('主题：全部主题',{exact:true}).click();await page.getByRole('navigation',{name:'全部技术主题'}).getByRole('link',{name:'技术主题 7',exact:true}).click();
    await expect(page).toHaveURL(/topic=topic-7/);let query=new URL(page.url()).searchParams;assert.equal(query.get('category'),'coding');assert.equal(query.get('topic'),'topic-7');
    await expect(page.getByText('主题：技术主题 7',{exact:true})).toBeVisible();
    await page.getByLabel('移除类别：AI 编程',{exact:true}).click();await expect(page).not.toHaveURL(/category=/);query=new URL(page.url()).searchParams;assert.equal(query.has('category'),false);assert.equal(query.get('topic'),'topic-7');
    await page.goBack();await expect(page.getByLabel('移除类别：AI 编程',{exact:true})).toBeVisible();
    for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`topic overlay dismisses, restores focus and closes after navigation (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const topics=Array.from({length:8},(_,i)=>({slug:'topic-'+i,name:'技术主题 '+i,group:'field',definition:'Topic',brand:null,total:1,recent:1,indexable:true,latest:null}));
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage([feedItem({id:'overlay',title:'Overlay result'})],url);
      if(url.pathname==='/api/site/topics')return {groups:[],topics};
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900}});await visit(page,web.origin+'/?category=coding');
    const trigger=page.locator('summary').filter({hasText:/更多主题|技术主题 7/}),panel=page.getByRole('navigation',{name:'全部技术主题'});
    for(const width of [961,1024,1920]){await page.setViewportSize({width,height:900});await trigger.click();await expect(panel).toBeVisible();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.keyboard.press('Escape');}
    await trigger.click();await expect(panel).toBeVisible();
    await page.getByRole('searchbox').click();await expect(panel).toBeHidden();
    await trigger.click();await trigger.click();await expect(panel).toBeHidden();
    await trigger.focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');
    await expect(panel.getByRole('link',{name:'全部主题',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();
    await trigger.click();await panel.getByRole('link',{name:'技术主题 7',exact:true}).click();
    await expect(page).toHaveURL(/topic=topic-7/);assert.equal(new URL(page.url()).searchParams.get('category'),'coding');await expect(panel).toBeHidden();
    await trigger.click();await panel.getByRole('link',{name:'技术主题 7',exact:true}).click();await expect(panel).toBeHidden();
    await trigger.click();await panel.getByRole('link',{name:'全部主题',exact:true}).click();
    await expect(page).not.toHaveURL(/topic=/);assert.equal(new URL(page.url()).searchParams.get('category'),'coding');
    await page.goBack();await expect(page).toHaveURL(/topic=topic-7/);await expect(panel).toBeHidden();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`article outline follows nested sections, closes on mobile and preserves back navigation (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const outline=[{id:'sec-1',text:'First chapter',level:2},{id:'sec-2',text:'First detail',level:3},{id:'sec-3',text:'Nested detail',level:4},{id:'sec-4',text:'Second detail',level:3},{id:'sec-5',text:'Second chapter',level:2},{id:'sec-6',text:'Last chapter',level:2}];
  const article=itemDetail({id:'outline-reading',title:'A long reading',outline,bodyHtml:outline.map(entry=>`<h${entry.level} id="${entry.id}">${entry.text}</h${entry.level}>`+`<p>${'Reading this section. '.repeat(90)}</p>`.repeat(3)).join('')});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage([article],url);
      if(url.pathname==='/api/site/items/'+article.id)return article;
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/items/'+article.id+'/view')return {id:article.id,views:1,likes:0,liked:false};
      if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});await visit(page,web.origin+'/?q=reading');await page.getByRole('link',{name:article.title,exact:true}).click();
    const toc=page.getByRole('navigation',{name:'本文目录',exact:true});
    await expect(toc.getByRole('link',{name:'Nested detail',exact:true})).toBeVisible();
    await toc.getByRole('button',{name:'收起：First detail',exact:true}).click();await expect(toc.getByRole('link',{name:'Nested detail',exact:true})).toBeHidden();
    await toc.getByRole('button',{name:'展开：First detail',exact:true}).click();
    await toc.getByRole('link',{name:'Nested detail',exact:true}).click();await expect(toc.getByRole('link',{name:'Nested detail',exact:true})).toHaveAttribute('aria-current','location');await expect(page.getByRole('heading',{name:'Nested detail',exact:true})).toBeFocused();
    await toc.getByRole('button',{name:'收起：First chapter',exact:true}).click();await expect(toc.getByRole('link',{name:'Nested detail',exact:true})).toBeHidden();
    await expect(toc.getByRole('link',{name:/First chapter.*当前章节/})).toHaveAttribute('aria-current','location');
    await page.mouse.wheel(0,80);await expect(toc.getByRole('button',{name:'展开：First chapter',exact:true})).toHaveAttribute('aria-expanded','false');
    await toc.getByRole('button',{name:'展开：First chapter',exact:true}).click();
    await page.getByRole('heading',{name:'Second chapter',exact:true}).evaluate(el=>el.scrollIntoView());await expect(toc.getByRole('link',{name:'Second chapter',exact:true})).toHaveAttribute('aria-current','location');
    await page.setViewportSize({width:390,height:844});await page.locator('summary[aria-label="展开文章目录"]').click();const mobile=page.getByRole('navigation',{name:'手机文章目录',exact:true});
    await mobile.getByRole('link',{name:'First chapter',exact:true}).click();await expect(mobile).toBeHidden();await expect(page.getByRole('heading',{name:'First chapter',exact:true})).toBeFocused();await expect(page.locator('summary[aria-label="展开文章目录"]')).toContainText('First chapter');
    await page.locator('summary[aria-label="展开文章目录"]').click();await page.keyboard.press('Escape');await expect(mobile).toBeHidden();await expect(page.locator('summary[aria-label="展开文章目录"]')).toBeFocused();
    await page.goBack();await expect(page).toHaveURL(web.origin+'/?q=reading');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`article progress and focus controls preserve the current section (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const outline=['Start','Middle','End'].map((text,i)=>({id:'sec-'+(i+1),text,level:2}));
  const body=(language:string,count:number)=>outline.map(entry=>`<h2 id="${entry.id}">${language} ${entry.text}</h2>`+`<p>${('Readable '+language+' content. ').repeat(60)}</p>`.repeat(count)).join('');
  const article=itemDetail({id:'progress-reading',title:'Reading progress',outline,bodyHtml:body('Original',9),translation:{bodyHtml:body('中文',4),outline:outline.map(entry=>({...entry,text:'中文 '+entry.text})),complete:true}});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/items/'+article.id)return article;
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/items/'+article.id+'/view')return {id:article.id,views:1,likes:0,liked:false};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});await visit(page,web.origin+'/items/'+article.id);
    const progress=page.getByRole('progressbar',{name:'正文阅读进度',exact:true}),region=page.getByRole('region',{name:'文章正文',exact:true});await expect(progress).toHaveAttribute('aria-valuenow','0');
    await page.evaluate(()=>{const from=document.getElementById('sec-2')!,to=document.getElementById('sec-3')!;scrollTo(0,scrollY+from.getBoundingClientRect().top+(to.getBoundingClientRect().top-from.getBoundingClientRect().top)*.35-parseFloat(getComputedStyle(from).scrollMarginTop));});
    const sectionRatio=()=>page.evaluate(()=>{const from=document.getElementById('sec-2')!,to=document.getElementById('sec-3')!;return (parseFloat(getComputedStyle(from).scrollMarginTop)-from.getBoundingClientRect().top)/(to.getBoundingClientRect().top-from.getBoundingClientRect().top);});
    await expect(page.getByRole('navigation',{name:'本文目录',exact:true}).getByRole('link',{name:'中文 Middle',exact:true})).toHaveAttribute('aria-current','location');
    await expect(region).toContainText('中文 Middle');
    await page.getByRole('button',{name:'开启专注模式',exact:true}).click();await expect(page.getByRole('navigation',{name:'本文目录',exact:true})).toBeHidden();await expect(page.getByRole('navigation',{name:'主导航',exact:true})).toBeHidden();await expect.poll(sectionRatio).toBeCloseTo(.35,1);
    await page.getByLabel('阅读显示设置',{exact:true}).click();await page.getByRole('group',{name:'正文字号',exact:true}).getByRole('radio',{name:'更大',exact:true}).check();await expect.poll(sectionRatio).toBeCloseTo(.35,1);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'退出专注模式',exact:true}).click();await expect(page.getByRole('navigation',{name:'本文目录',exact:true})).toBeVisible();await expect.poll(sectionRatio).toBeCloseTo(.35,1);
    await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'开启专注模式',exact:true}).focus();
    for(let i=0;i<4;i++)await page.keyboard.press('Enter');
    await expect(page.getByRole('button',{name:'开启专注模式',exact:true})).toHaveAttribute('aria-pressed','false');await expect.poll(sectionRatio).toBeCloseTo(.35,1);await page.emulateMedia({reducedMotion:'reduce'});
    const beforePageDown=await page.evaluate(()=>scrollY);await page.keyboard.press('PageDown');await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(beforePageDown+100);
    // Additional content after the article must not make a finished body look unfinished.
    await region.evaluate(el=>{const extra=document.createElement('div');extra.style.height='2400px';extra.textContent='Article tools below the body';el.closest('article')!.after(extra);});
    await region.evaluate(el=>scrollTo(0,scrollY+el.getBoundingClientRect().bottom-innerHeight));await expect(progress).toHaveAttribute('aria-valuenow','100');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`focus mode without an outline retains reading position and resets after leaving (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const paragraphs=(word:string,n:number)=>Array.from({length:n},()=>'<p>'+(`${word} content. `.repeat(80))+'</p>').join('');
  const article=itemDetail({id:'unmatched-reading',title:'Different chapter structures',bodyHtml:'<h2 id="sec-1">Original only heading</h2>'+paragraphs('Original',40),outline:[{id:'sec-1',text:'Original only heading',level:2}],translation:{bodyHtml:paragraphs('中文',16),outline:[],complete:false}});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/items/'+article.id)return article;
      if(url.pathname==='/api/site/articles')return readerPage([article],url);
      if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/items/'+article.id+'/view')return {id:article.id,views:1,likes:0,liked:false};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});await visit(page,web.origin+'/items/'+article.id);const body=page.getByRole('region',{name:'文章正文',exact:true});
    await expect(page.getByRole('progressbar',{name:'正文阅读进度'})).toHaveAttribute('aria-valuenow','0');
    await body.evaluate(el=>scrollTo(0,scrollY+el.getBoundingClientRect().top+el.getBoundingClientRect().height*.4-parseFloat(getComputedStyle(el).scrollMarginTop)));
    for(const label of ['开启专注模式','退出专注模式']){
      await page.getByRole('button',{name:label,exact:true}).click();
      await expect.poll(()=>body.evaluate(el=>(parseFloat(getComputedStyle(el).scrollMarginTop)-el.getBoundingClientRect().top)/el.getBoundingClientRect().height)).toBeCloseTo(.4,1);
    }
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'开启专注模式',exact:true}).click();await expect(page.getByRole('navigation',{name:'底部导航',exact:true})).toBeHidden();
    await page.getByRole('button',{name:'回到顶部',exact:true}).click();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
    await visit(page,web.origin+'/');await expect(page.getByRole('navigation',{name:'底部导航',exact:true})).toBeVisible();await page.getByRole('link',{name:article.title,exact:true}).click();await expect(page.getByRole('button',{name:'开启专注模式',exact:true})).toHaveAttribute('aria-pressed','false');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`short articles finish their visible body and summaries have no reading progress (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const short=itemDetail({id:'short-reading',title:'Short article',summary:null,bodyHtml:'<p>A complete short article.</p>'});
  const summary=itemDetail({id:'summary-only',title:'Summary only',bodyHtml:null,bodyState:{status:'not-permitted',bodyRevision:1,refreshPending:false,issues:[]}});
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/'+short.id)return short;if(url.pathname==='/api/site/items/'+summary.id)return summary;if(url.pathname==='/api/site/engagement')return {items:[]};}));
    const page=await browser.newPage({viewport:{width:390,height:844}});await visit(page,web.origin+'/items/'+short.id);
    await expect(page.getByRole('progressbar',{name:'正文阅读进度'})).toHaveAttribute('aria-valuenow','100');
    await visit(page,web.origin+'/items/'+summary.id);await expect(page.getByRole('progressbar',{name:'正文阅读进度'})).toHaveCount(0);await expect(page.getByRole('link',{name:'打开原文',exact:true})).toBeVisible();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`stored translation displays title, summary, body and outline with one original link (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,writes=0;
  const article=itemDetail({id:'translation-ui',title:'A translated article',summary:'An original summary.',metadataTranslation:{title:'翻译后的文章标题',summary:'已经翻译的文章摘要。'},body:{html:'<h2 id="sec-1">中文标题</h2><p>已经保存的中文译文。</p>',outline:[{id:'sec-1',text:'中文标题',level:2}],language:'translation',complete:false,readingMinutes:1}});
  try{
    web=await startWebServer(fakeApi((url,res,req)=>{if(url.pathname==='/api/site/articles')return readerPage([article,feedItem({id:'not-translated',title:'Untranslated title'})],url);if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};if(url.pathname==='/api/site/topics')return {topics:[]};if(url.pathname==='/api/site/items/translation-ui')return article;if(url.pathname==='/api/admin/me'){res.statusCode=401;return {};}if(req.method!=='GET'&&url.pathname!=='/api/site/track')writes++;}));
    const page=await browser.newPage({viewport:{width:390,height:800}});await visit(page,web.origin+'/');
    await expect(page.getByRole('link',{name:'翻译后的文章标题',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Untranslated title',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'翻译后的文章标题',exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toHaveText('翻译后的文章标题');await expect(page.getByText('已经翻译的文章摘要。',{exact:true})).toBeVisible();
    await expect(page.locator('article .prose')).toContainText('已经保存的中文译文');await expect(page.getByRole('status').filter({hasText:'译文尚不完整'})).toBeVisible();
    await expect(page.getByRole('group',{name:'文章语言'})).toHaveCount(0);
    const original=page.getByRole('link',{name:'打开原文',exact:true});await expect(original).toHaveCount(1);await expect(original).toHaveAttribute('href',article.links.original);await expect(original).toHaveAttribute('target','_blank');
    await page.setViewportSize({width:1440,height:900});await expect(page.getByRole('navigation',{name:'本文目录'}).getByRole('link',{name:'中文标题'})).toBeVisible();
    assert.equal(writes,0);
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`translated title and summary remain readable without a full text body (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const article=itemDetail({id:'metadata-only',title:'Original title',summary:'Original summary.',bodyHtml:null,metadataTranslation:{title:'只有摘要的文章',summary:'中文摘要。'},bodyState:{status:'not-permitted',bodyRevision:null,refreshPending:false,issues:[]}});
  try{
    web=await startWebServer(fakeApi(url=>{if(url.pathname==='/api/site/items/'+article.id)return article;}));
    const page=await browser.newPage({viewport:{width:390,height:800}});await visit(page,web.origin+'/items/'+article.id);
    await expect(page.getByRole('heading',{level:1})).toHaveText('只有摘要的文章');await expect(page.getByText('中文摘要。',{exact:true})).toBeVisible();
    await expect(page.getByRole('group',{name:'文章语言'})).toHaveCount(0);await expect(page.getByRole('link',{name:'打开原文',exact:true})).toHaveAttribute('href',article.links.original);
    await expect(page.getByRole('region',{name:'文章正文',exact:true})).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`reading display preferences apply, persist, synchronize and reset without changing article data (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;let writes=0;
  const article=itemDetail({id:'display-ui',title:'Reading display',bodyHtml:'<h2 id="sec-1">A saved section</h2><pre><code>const readable = true;</code></pre>'+Array.from({length:8},()=>'<p>'+('Readable article content. '.repeat(30))+'</p>').join(''),outline:[{id:'sec-1',text:'A saved section',level:2}]});
  try{
    web=await startWebServer(fakeApi((url,res,req)=>{
      if(url.pathname==='/api/site/items/display-ui')return article;
      // Normal view accounting must succeed without adding an error notice above the display controls.
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/items/display-ui/view')return {id:article.id,views:1,likes:0,liked:false};
      if(url.pathname==='/api/admin/me'){res.statusCode=401;return {};}
      if(req.method!=='GET'&&url.pathname!=='/api/site/track')writes++;
    }));
    const context=await browser.newContext({viewport:{width:1920,height:900}}),page=await context.newPage();await visit(page,web.origin+'/items/display-ui');const body=page.locator('article .prose');
    await page.getByLabel('阅读显示设置',{exact:true}).click();await expect(page.getByRole('button',{name:'恢复默认显示',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'恢复图表提示',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
    const font=()=>body.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),height=()=>body.evaluate(el=>parseFloat(getComputedStyle(el).lineHeight)),width=()=>body.evaluate(el=>el.getBoundingClientRect().width);
    const codeFont=()=>body.locator('pre code').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));await expect.poll(codeFont).toBe(13);
    await page.getByLabel('阅读显示设置',{exact:true}).click();await page.getByRole('group',{name:'正文字号',exact:true}).getByRole('radio',{name:'较大',exact:true}).check();await page.getByRole('group',{name:'正文行距',exact:true}).getByRole('radio',{name:'宽松',exact:true}).check();await page.getByRole('group',{name:'正文宽度',exact:true}).getByRole('radio',{name:'窄',exact:true}).check();await expect.poll(font).toBe(20);await expect.poll(height).toBe(40);assert(await width()<=641);const narrow=await width();
    await expect.poll(codeFont).toBe(14.5);
    const second=await context.newPage();await visit(second,web.origin+'/items/display-ui');assert.equal(await second.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),20);await second.getByLabel('阅读显示设置',{exact:true}).click();await second.getByRole('group',{name:'正文字号',exact:true}).getByRole('radio',{name:'更大',exact:true}).check();await second.getByRole('group',{name:'正文宽度',exact:true}).getByRole('radio',{name:'宽',exact:true}).check();await expect.poll(font).toBe(22);await expect.poll(width).toBeGreaterThan(narrow+100);
    await expect.poll(codeFont).toBe(16);assert.equal(await body.locator('.code-block-lines').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),16);
    await visit(page,page.url());await expect.poll(font).toBe(22);await expect.poll(height).toBe(44);await page.getByLabel('阅读显示设置',{exact:true}).click();await expect(page.getByRole('group',{name:'正文宽度',exact:true}).getByRole('radio',{name:'宽',exact:true})).toBeChecked();
    for(const size of [320,390,1440]){await page.setViewportSize({width:size,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.getByRole('button',{name:'恢复默认显示',exact:true}).click();await expect(page.getByRole('group',{name:'正文字号',exact:true}).getByRole('radio',{name:'默认',exact:true})).toBeChecked();await expect.poll(()=>second.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(18);assert.equal(writes,0);
    await expect.poll(codeFont).toBe(13);
    await page.evaluate(()=>localStorage.setItem('agi-dawn-reading-display-v1','{"size":"enormous","spacing":"loose","width":"wide"}'));await visit(page,page.url());await expect.poll(font).toBe(18);await expect.poll(height).toBe(36);
    await page.evaluate(()=>localStorage.setItem('agi-dawn-reading-display-v1','{'));await visit(page,page.url());await expect.poll(height).toBeCloseTo(32.4,1);assert.equal(writes,0);
    const denied=await browser.newContext({viewport:{width:390,height:800}});await denied.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});});const blocked=await denied.newPage();await visit(blocked,web.origin+'/items/display-ui');await blocked.getByLabel('阅读显示设置',{exact:true}).click();await blocked.getByRole('group',{name:'正文字号',exact:true}).getByRole('radio',{name:'较大',exact:true}).check();await expect.poll(()=>blocked.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(20);await expect(blocked.getByRole('status').filter({hasText:'当前标签页'})).toBeVisible();await visit(blocked,blocked.url());assert.equal(await blocked.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),17);await denied.close();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`floating theme toggle follows the displayed theme, persists and synchronizes (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const article=itemDetail({id:'theme-ui',title:'Theme switching',bodyHtml:'<p>'+('Readable article content. '.repeat(1200))+'</p>'});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/items/'+article.id)return article;
      if(url.pathname==='/api/site/articles')return readerPage([article],url);
      if(['/api/site/categories','/api/site/sources'].includes(url.pathname))return {items:[]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname==='/api/site/engagement')return {items:[{id:article.id,views:0,likes:0,liked:false}]};
      if(url.pathname==='/api/site/items/'+article.id+'/view')return {id:article.id,views:1,likes:0,liked:false};
    }));
    const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'}),page=await context.newPage();
    await visit(page,web.origin+'/items/'+article.id);
    const toggle=page.getByRole('button',{name:'主题切换',exact:true}),html=page.locator('html');
    await expect(toggle).toHaveCount(1);await expect(toggle).toBeVisible();await expect(toggle).toHaveAccessibleDescription(/当前为浅色/);
    await expect(page.locator('aside').first().getByRole('radiogroup',{name:'外观',exact:true})).toHaveCount(0);
    await page.evaluate(()=>scrollTo(0,1500));const position=await page.evaluate(()=>scrollY);
    await toggle.click();await expect(html).toHaveAttribute('data-theme','dark');await expect(toggle).toHaveAccessibleDescription(/当前为深色/);
    assert.equal(await page.evaluate(()=>scrollY),position);assert.equal(await page.evaluate(()=>localStorage.getItem('agidawn-theme')),'dark');
    await page.reload();await expect(html).toHaveAttribute('data-theme','dark');
    const other=await context.newPage();await visit(other,web.origin+'/');await expect(other.getByRole('button',{name:'主题切换',exact:true})).toHaveCount(1);await expect(other.locator('html')).toHaveAttribute('data-theme','dark');
    await toggle.focus();await toggle.press('Enter');await expect(html).toHaveAttribute('data-theme','light');await expect(other.locator('html')).toHaveAttribute('data-theme','light');
    assert.equal(await page.evaluate(()=>localStorage.getItem('agidawn-theme')),null);
    await page.emulateMedia({colorScheme:'dark'});await expect(html).toHaveAttribute('data-theme','dark');
    await toggle.press('Space');await expect(html).toHaveAttribute('data-theme','light');assert.equal(await page.evaluate(()=>localStorage.getItem('agidawn-theme')),'light');
    await page.emulateMedia({colorScheme:'light'});await expect(html).toHaveAttribute('data-theme','light');
    // An explicit choice stays explicit when the operating system changes to match it.
    assert.equal(await page.evaluate(()=>localStorage.getItem('agidawn-theme')),'light');
    await page.setViewportSize({width:390,height:667});await page.evaluate(()=>scrollTo(0,1500));await expect(page.getByRole('button',{name:'回到顶部',exact:true})).toBeVisible();
    await page.getByLabel('阅读显示设置',{exact:true}).click();await expect(page.getByText('阅读显示设置',{exact:true})).toBeInViewport({ratio:1});await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'开启专注模式',exact:true}).click();await expect(toggle).toBeVisible();await toggle.click();await expect(html).toHaveAttribute('data-theme','dark');
    await visit(other,web.origin+'/more');await expect(other.getByRole('radiogroup',{name:'外观',exact:true})).toBeVisible();await other.getByRole('radio',{name:'跟随系统',exact:true}).click();await expect(html).toHaveAttribute('data-theme','light');
    await expect(other.getByRole('radio',{name:'跟随系统',exact:true})).toBeChecked();
    const denied=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',reducedMotion:'reduce'});
    await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}}));
    const blocked=await denied.newPage();await visit(blocked,web.origin+'/');
    for(const theme of ['dark','light','dark']){await blocked.getByRole('button',{name:'主题切换',exact:true}).click();await expect(blocked.locator('html')).toHaveAttribute('data-theme',theme);}
    await denied.close();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`figure notices show hover details and distinguish visit dismissal from permanent disable (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,writes=0;
  const issues=[{kind:'missing-figure' as const,message:'图表依赖原站样式，保存的图形可能不完整。'},{kind:'missing-figure' as const,message:'图表的外部引用未保存。'}];
  const styleIssues=[...Array.from({length:10},()=>({...issues[0]!})),{kind:'missing-figure' as const,message:'图表依赖原站样式，保留了文字说明，请对照原文。'}];
  const repeatedIssues=[...styleIssues,{...issues[1]!},{...issues[0]!},{...issues[1]!}];
  const detailsMessages=['图表的外部引用未保存。'];
  const articles=['figure-a','figure-b','figure-mixed','figure-style'].map(id=>itemDetail({id,title:id,bodyState:{status:'partial',bodyRevision:1,refreshPending:false,issues:id==='figure-style'?styleIssues:id==='figure-mixed'?[...repeatedIssues,{kind:'missing-formula',message:'部分公式保留为源文本，请对照原文。'}]:repeatedIssues}}));
  try{
    web=await startWebServer(fakeApi((url,res,req)=>{
      const article=articles.find(article=>url.pathname==='/api/site/items/'+article.id);if(article)return article;
      if(url.pathname==='/api/site/engagement')return {items:articles.map(({id})=>({id,views:0,likes:0,liked:false}))};
      const viewed=articles.find(article=>url.pathname==='/api/site/items/'+article.id+'/view');if(viewed)return {id:viewed.id,views:1,likes:0,liked:false};
      if(url.pathname==='/api/admin/me'){res.statusCode=401;return {};}
      if(req.method!=='GET'&&url.pathname!=='/api/site/track')writes++;
    }));
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
    await page.addInitScript(()=>localStorage.setItem('agi-dawn-figure-notices-v1:figure-a','hidden'));
    const notice=page.getByRole('button',{name:'部分图表可能显示不完整',exact:true}),trigger=page.getByRole('button',{name:'关闭图表提示',exact:true}),menu=page.getByRole('menu',{name:'关闭图表提示',exact:true}),details=page.getByRole('tooltip');
    await visit(page,web.origin+'/items/figure-style');const text=page.getByText('部分图表可能显示不完整',{exact:true});
    await expect(text).toBeVisible();await expect(notice).toHaveCount(0);await text.hover();await expect(details).toHaveCount(0);await text.click();await expect(details).toHaveCount(0);
    await page.getByRole('link',{name:'打开原文',exact:true}).focus();await page.keyboard.press('Tab');await expect(trigger).toBeFocused();
    await trigger.click();await menu.getByRole('menuitem',{name:'本次关闭直到下次访问',exact:true}).click();await expect(text).toHaveCount(0);await page.reload();await expect(text).toBeVisible();
    await visit(page,web.origin+'/items/figure-a');await expect(notice).toBeVisible();await expect(page.getByText('正文有缺失，请对照原文。',{exact:true})).toHaveCount(0);await expect(details).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('agi-dawn-figure-notices-v1:figure-a'))).toBe(null);
    await notice.hover();await expect(details.getByRole('listitem')).toHaveText(detailsMessages);await details.hover();await expect(details).toBeVisible();await page.keyboard.press('Escape');await expect(details).toHaveCount(0);
    await page.getByRole('heading',{name:'figure-a',exact:true}).click();await notice.focus();await expect(details).toContainText(detailsMessages[0]!);await page.keyboard.press('Escape');await expect(details).toHaveCount(0);
    await trigger.focus();await trigger.press('ArrowDown');await expect(menu.getByRole('menuitem',{name:'本次关闭直到下次访问',exact:true})).toBeFocused();await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'永久禁用',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();
    await trigger.press('ArrowDown');await page.keyboard.press('ArrowUp');await expect(menu.getByRole('menuitem',{name:'永久禁用',exact:true})).toBeFocused();
    await page.keyboard.press('Home');await expect(menu.getByRole('menuitem',{name:'本次关闭直到下次访问',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(menu).toHaveCount(0);await expect(notice).toBeFocused();
    await trigger.press('ArrowDown');await page.keyboard.press('Tab');await expect(menu).toHaveCount(0);await expect(trigger).not.toBeFocused();await expect(page.locator('body')).not.toBeFocused();
    await trigger.press('ArrowUp');await expect(menu.getByRole('menuitem',{name:'永久禁用',exact:true})).toBeFocused();
    // A non-modal menu must let a single outside click activate another control.
    const theme=page.getByRole('button',{name:'主题切换',exact:true}),previousTheme=await page.locator('html').getAttribute('data-theme');
    await theme.click();await expect(menu).toHaveCount(0);await expect(page.locator('html')).not.toHaveAttribute('data-theme',previousTheme!);
    await trigger.press('ArrowDown');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
    await trigger.click();await menu.getByRole('menuitem',{name:'本次关闭直到下次访问',exact:true}).click();await expect(notice).toHaveCount(0);await expect(details).toHaveCount(0);
    await page.reload();await expect(notice).toBeVisible();await trigger.click();await menu.getByRole('menuitem',{name:'本次关闭直到下次访问',exact:true}).click();await visit(page,web.origin+'/items/figure-b');await visit(page,web.origin+'/items/figure-a');await expect(notice).toBeVisible();
    const other=await context.newPage();await visit(other,web.origin+'/items/figure-b');await expect(other.getByText('部分图表可能显示不完整',{exact:true})).toBeVisible();
    await page.setViewportSize({width:320,height:700});await notice.click();await expect(details).toContainText(issues[1]!.message);await trigger.click();await expect(menu.getByRole('menuitem',{name:'永久禁用',exact:true})).toBeVisible();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await menu.getByRole('menuitem',{name:'永久禁用',exact:true}).click();await expect(notice).toHaveCount(0);await expect(other.getByText('部分图表可能显示不完整',{exact:true})).toHaveCount(0);
    await page.reload();await expect(notice).toHaveCount(0);await visit(page,web.origin+'/items/figure-mixed');await expect(notice).toHaveCount(0);await expect(page.getByText('部分公式保留为源文本，请对照原文。',{exact:true})).toBeVisible();
    await page.getByLabel('阅读显示设置',{exact:true}).click();await page.getByRole('button',{name:'恢复图表提示',exact:true}).click();await expect(notice).toBeVisible();await expect(other.getByText('部分图表可能显示不完整',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await visit(page,web.origin+'/items/figure-a');await expect(notice).toBeVisible();assert.equal(writes,0);
    const denied=await browser.newContext({viewport:{width:390,height:800}});await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}}));
    const blocked=await denied.newPage();await visit(blocked,web.origin+'/items/figure-a');await blocked.getByRole('button',{name:'关闭图表提示',exact:true}).click();await blocked.getByRole('menuitem',{name:'永久禁用',exact:true}).click();await expect(blocked.getByText('部分图表可能显示不完整',{exact:true})).toHaveCount(0);await expect(blocked.getByRole('status').filter({hasText:'浏览器未能记住'})).toBeVisible();
    await blocked.getByLabel('阅读显示设置',{exact:true}).click();await blocked.getByRole('button',{name:'恢复图表提示',exact:true}).click();await expect(blocked.getByText('部分图表可能显示不完整',{exact:true})).toBeVisible();await denied.close();
  }finally{await browser.close();await web?.stop();}
});

test("anonymous article browsing preserves source and date filters in the URL", async()=>{
  const article=itemDetail({id:"reader-ui",title:"Agent memory in practice",summary:null,source:{id:"source-ui",name:"Source UI"},author:"Author",
    links:{original:"https://example.com/article"},publishedAt:null,discoveredAt:"2026-10-27T02:00:00Z",timelineAt:"2026-10-27T02:00:00Z",
    category:null,tags:[],engagement:{views:0,likes:0},bodyState:{status:"ready",bodyRevision:1,refreshPending:false,issues:[]},
    bodyHtml:"<h2 id=\"sec-1\">Original reading</h2><p>Original body stays readable.</p>",outline:[{id:"sec-1",text:"Original reading",level:2}],topics:[]});
  const browser=await chromium.launch();
  let web:WebServer|undefined;
  try {
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==="/api/site/articles") return readerPage([article],url);
      if(url.pathname==="/api/site/sources") return {items:[{id:"source-ui",name:"Source UI",url:"https://example.com",description:null,articles:1,fulltext:true}]};
      if(url.pathname==="/api/site/topics") return {groups:[],topics:[]};
      if(url.pathname==="/api/site/categories") return {items:[{id:"uncategorized",name:"待分类"}]};
      if(url.pathname==="/api/site/items/reader-ui") return article;
    }));
    const page=await browser.newPage();
    await visit(page,web.origin+"/");
    await expect(page.getByRole("link",{name:"Agent memory in practice",exact:true})).toBeVisible();
    await page.getByLabel("来源",{exact:true}).selectOption("source-ui");
    await expect(page).toHaveURL(/sourceId=source-ui/);
    await page.locator('summary').filter({hasText:'不限日期'}).click();
    await page.getByLabel("起始日期",{exact:true}).fill("2026-10-01");
    await page.getByLabel("结束日期",{exact:true}).fill("2026-10-27");
    await page.getByRole("button",{name:"应用日期"}).click();
    await expect(page).toHaveURL(/from=2026-10-01/);
    assert.equal(new URL(page.url()).searchParams.get("from"),"2026-10-01");
    await page.getByRole("link",{name:"清除全部筛选",exact:true}).click();
    await expect(page).toHaveURL(web.origin+"/");
    await expect(page.getByLabel("来源",{exact:true})).toHaveValue("");
    await page.getByLabel("来源",{exact:true}).selectOption("source-ui");
    await expect(page).toHaveURL(/sourceId=source-ui/);
    await page.locator('summary').filter({hasText:'不限日期'}).click();
    await page.getByLabel("起始日期",{exact:true}).fill("2026-10-01");
    await page.getByLabel("结束日期",{exact:true}).fill("2026-10-27");
    await page.getByRole("button",{name:"应用日期"}).click();
    await expect(page).toHaveURL(/from=2026-10-01/);
    await page.reload();
    await expect(page.getByLabel("来源",{exact:true})).toHaveValue("source-ui");
    await page.getByRole("link",{name:"Agent memory in practice",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Agent memory in practice"})).toBeVisible();
    await expect(page.getByText("Original body stays readable.")).toBeVisible();
    await expect(page.getByText(/收录时间/).first()).toBeVisible();
    const response=await page.request.get(web.origin+"/items/reader-ui");
    assert.match(response.headers()["cache-control"]??"",/no-store/);
    await page.goBack();
    await expect(page.getByLabel("起始日期",{exact:true})).toHaveValue("2026-10-01");
  } finally { await browser.close();await web?.stop(); }
});

for(const engine of [chromium,webkit])test(`article rows show available localized summaries and retain Beijing dates (${engine.name()})`,async()=>{
  const items=[
    feedItem({id:"after-midnight",title:"After Beijing midnight",metadataTranslation:{title:"After Beijing midnight",summary:"中文摘要"},publishedAt:"2026-10-24T16:30:00Z",timelineAt:"2026-10-24T16:30:00Z"}),
    feedItem({id:"before-midnight",title:"Before Beijing midnight",publishedAt:"2026-10-24T15:30:00Z",timelineAt:"2026-10-24T15:30:00Z"}),
    feedItem({id:"discovery-date",title:"Article without publication date",summary:null,publishedAt:null,discoveredAt:"2026-10-23T17:00:00Z",timelineAt:"2026-10-23T17:00:00Z"}),
    feedItem({id:"previous-year",title:"Previous year article",metadataTranslation:{title:"Previous year article",summary:null},publishedAt:"2025-10-24T16:30:00Z",timelineAt:"2025-10-24T16:30:00Z"}),
  ];
  const browser=await engine.launch();let web:WebServer|undefined;
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==="/api/site/articles")return readerPage(items,url);
      if(url.pathname==="/api/site/sources")return {items:[]};
      if(url.pathname==="/api/site/topics")return {groups:[],topics:[]};
      if(url.pathname==="/api/site/categories")return {items:[]};
    }));
    const page=await browser.newPage({timezoneId:"America/Los_Angeles"});await visit(page,web.origin+"/");
    await expect(page.locator('main article h2')).toHaveText(items.map(item=>item.title));
    await expect(page.locator('main article time')).toHaveText(['2026年10月25日','2026年10月24日','收录于 2026年10月24日','2025年10月25日']);
    await expect(page.getByText('中文摘要',{exact:true})).toBeVisible();
    await expect(page.getByText('固定摘要',{exact:true})).toHaveCount(2);
    await expect(page.getByLabel('收藏暂未开放')).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

test("category and topic navigation combine, paginate and independently clear",async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==="/api/site/articles")return readerPage(Array.from({length:26},(_,i)=>feedItem({id:'article-'+i,title:i===25?'Second page':i===0?'First page':'Article '+i})),url);
      if(url.pathname==="/api/site/sources")return {items:[{id:"source-ui",name:"Source UI",url:null,description:null,articles:2,fulltext:false}]};
      if(url.pathname==="/api/site/topics")return {groups:[],topics:[{slug:"mcp",name:"MCP",group:"field",definition:"Tool use",brand:null,total:2,recent:2,indexable:true,latest:null}]};
      if(url.pathname==="/api/site/categories")return {items:[{id:"uncategorized",name:"待分类"},{id:"agents",name:"智能体工程"}]};
    }));
    const page=await browser.newPage();
    for(const path of ["/","/all","/sources/source-ui","/topics/mcp"]){
      await visit(page,web.origin+path);
      await page.getByRole('navigation',{name:'文章类别'}).getByRole('link',{name:'智能体工程',exact:true}).click();
      await expect(page).toHaveURL(/category=agents/);
      await page.getByRole('navigation',{name:'文章主题'}).getByRole('link',{name:'MCP',exact:true}).click();
      await expect(page).toHaveURL(/category=agents/);
      assert.equal(new URL(page.url()).pathname,"/");
      await expect(page.getByRole("link",{name:"First page",exact:true})).toBeVisible();
      await page.getByRole("link",{name:"下一页",exact:true}).click();
      await expect(page.getByRole("link",{name:"Second page",exact:true})).toBeVisible();
      const next=new URL(page.url());assert.equal(next.pathname,"/");assert.equal(next.searchParams.get("category"),"agents");assert.equal(next.searchParams.get("topic"),"mcp");
      await page.getByRole('navigation',{name:'文章类别'}).getByRole('link',{name:'全部类别',exact:true}).click();
      await expect(page).not.toHaveURL(/category=/);
      assert.equal(new URL(page.url()).searchParams.get('topic'),'mcp');assert.equal(new URL(page.url()).searchParams.has('category'),false);assert.equal(new URL(page.url()).searchParams.has('page'),false);
      await page.getByRole('navigation',{name:'文章主题'}).getByRole('link',{name:'全部主题',exact:true}).click();
      await expect(page).not.toHaveURL(/topic=/);
      await page.getByLabel('来源',{exact:true}).selectOption('');
      await expect(page).toHaveURL(web.origin+"/");
      await expect(page.getByRole('navigation',{name:'文章类别'}).getByRole('link',{name:'全部类别',exact:true})).toHaveAttribute('aria-current','page');
      await expect(page.getByRole("link",{name:"First page",exact:true})).toBeVisible();
      await expect(page.getByRole('navigation',{name:'文章主题'}).getByRole('link',{name:'全部主题',exact:true})).toHaveAttribute('aria-current','page');
      await expect(page.getByLabel("来源",{exact:true})).toHaveValue("");
    }
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`exploration and article links lead to the article list with the selected topic (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const topics=[
    {slug:'mcp',name:'MCP 与工具调用',group:'field',definition:'工具接口与协议实践',brand:null,total:3,recent:1,indexable:true,latest:{title:'A practical MCP article',at:'2026-10-27T12:00:00Z'}},
    {slug:'empty',name:'空主题',group:'field',definition:'等待整理文章',brand:null,total:0,recent:0,indexable:false,latest:null},
  ];
  const article=itemDetail({id:'topic-navigation',title:'A practical MCP article',source:{id:'source-ui',name:'Source UI'},topics:[{slug:'mcp',name:'MCP 与工具调用'}]});
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/topics')return {groups:[{key:'field',name:'技术主题',blurb:'按技术内容查找'}],topics};
      if(url.pathname==='/api/site/articles')return readerPage(url.searchParams.get('topic')==='empty'?[]:[article],url);
      if(url.pathname==='/api/site/sources')return {items:[{id:'source-ui',name:'Source UI',url:null,description:null,articles:3,fulltext:false,latestAt:null}]};
      if(url.pathname==='/api/site/categories')return {items:[]};
      if(url.pathname==='/api/site/items/topic-navigation')return article;
    }));
    const page=await browser.newPage({viewport:{width:390,height:844}});await visit(page,web.origin+'/explore');
    const topic=page.getByRole('link',{name:'MCP 与工具调用',exact:true});
    await expect(topic).toContainText('3 篇文章');await expect(topic).toContainText('近 30 天 1 篇');await expect(topic).toContainText('A practical MCP article');
    await expect(topic.locator('time')).toHaveAttribute('datetime','2026-10-27T12:00:00Z');
    await expect(page.getByRole('link',{name:'空主题',exact:true})).toContainText('暂无文章');
    await topic.click();await expect(page.getByRole('heading',{level:1})).toHaveText('文章');
    await expect(page).toHaveURL(web.origin+'/?topic=mcp');
    await expect(page.getByText('主题：MCP 与工具调用',{exact:true})).toBeVisible();
    await expect(page.getByRole('navigation',{name:'底部导航'}).getByRole('link',{name:'文章',exact:true})).toHaveAttribute('aria-current','page');
    await page.getByRole('link',{name:'A practical MCP article',exact:true}).click();
    await page.getByRole('navigation',{name:'所属主题'}).getByRole('link',{name:'MCP 与工具调用',exact:true}).click();
    await expect(page).toHaveURL(web.origin+'/?topic=mcp');
    await page.getByRole('link',{name:'A practical MCP article',exact:true}).click();
    await page.locator('article header').getByRole('link',{name:'Source UI',exact:true}).click();
    await expect(page).toHaveURL(web.origin+'/?sourceId=source-ui');
    await expect(page.getByLabel('来源',{exact:true})).toHaveValue('source-ui');
    await page.getByRole('navigation',{name:'底部导航'}).getByRole('link',{name:'文章',exact:true}).click();await expect(page).toHaveURL(web.origin+'/');
    await page.getByRole('navigation',{name:'底部导航'}).getByRole('link',{name:'探索',exact:true}).click();await expect(page).toHaveURL(web.origin+'/explore');
    const bottom=page.getByRole('navigation',{name:'底部导航'});await expect(bottom.getByRole('link')).toHaveText(['文章','探索','我的']);
    await bottom.getByRole('link',{name:/^我的/}).click();
    await expect(page.locator('main a[href="/topics"],main a[href="/sources"]')).toHaveCount(0);
    await page.locator('main').getByRole('link',{name:'探索',exact:true}).click();
    await expect(bottom.getByRole('link',{name:'探索',exact:true})).toHaveAttribute('aria-current','page');
    await page.setViewportSize({width:1440,height:900});
    await page.getByRole('link',{name:'空主题',exact:true}).click();await expect(page.getByRole('heading',{name:'没有符合条件的文章',exact:true})).toBeVisible();
    const plain=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:844}});
    await plain.goto(web.origin+'/explore?view=sources');await plain.getByRole('navigation',{name:'探索方式'}).getByRole('link',{name:'主题',exact:true}).click();await expect(plain).toHaveURL(web.origin+'/explore');
    await plain.goto(web.origin+'/explore');await plain.getByRole('link',{name:'MCP 与工具调用',exact:true}).click();await expect(plain).toHaveURL(web.origin+'/?topic=mcp');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`changing a topic keeps other filters and resets its previous page (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const topics=['mcp','skills'].map(slug=>({slug,name:slug==='mcp'?'MCP':'Skills',group:'field',definition:slug+' articles',brand:null,total:1,recent:1,indexable:true,latest:null}));
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/topics')return {groups:[],topics};
      if(url.pathname==='/api/site/sources')return {items:[{id:'source-ui',name:'Source UI',url:null,description:null,articles:2,fulltext:false}]};
      if(url.pathname==='/api/site/categories')return {items:[{id:'agents',name:'智能体工程'}]};
      if(url.pathname==='/api/site/articles')return readerPage(Array.from({length:26},(_,i)=>feedItem({id:'selected-topic-'+i,title:i===0||i===25?(url.searchParams.get('topic')??'All')+' result':'Other article '+i})),url);
    }));
    const page=await browser.newPage();
    await visit(page,web.origin+'/topics/mcp?q=tools&sourceId=source-ui&category=agents&from=2026-10-01&to=2026-10-28&page=2');
    await page.getByRole('navigation',{name:'文章主题'}).getByRole('link',{name:'Skills',exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toHaveText('文章');await expect(page.getByRole('link',{name:'skills result',exact:true})).toBeVisible();
    let url=new URL(page.url());assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('topic'),'skills');assert.equal(url.searchParams.has('page'),false);
    for(const [name,value] of [['q','tools'],['sourceId','source-ui'],['category','agents'],['from','2026-10-01'],['to','2026-10-28']])assert.equal(url.searchParams.get(name),value);
    await page.reload();await expect(page.getByRole('navigation',{name:'文章主题'}).getByRole('link',{name:'Skills',exact:true})).toHaveAttribute('aria-current','page');
    await page.getByRole('navigation',{name:'文章主题'}).getByRole('link',{name:'全部主题',exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toHaveText('文章');await expect(page.getByRole('link',{name:'All result',exact:true})).toBeVisible();
    url=new URL(page.url());assert.equal(url.pathname,'/');assert.equal(url.searchParams.has('topic'),false);assert.equal(url.searchParams.get('sourceId'),'source-ui');
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`source cards show their latest article time and link only to their article list (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const sources=[
    {id:'source-ui',name:'Source UI',url:'https://example.org/feed.xml',description:null,articles:2,fulltext:false,latestAt:'2026-10-24T12:00:00.000Z'},
    {id:'undated',name:'Undated source',url:null,description:'Source without a timestamp',articles:0,fulltext:false,latestAt:null},
  ];
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/sources')return {items:sources};
      if(url.pathname==='/api/site/articles')return readerPage([feedItem({id:'source-article',title:'A source article'})],url);
      if(url.pathname==='/api/site/topics')return {groups:[],topics:[]};
      if(url.pathname==='/api/site/categories')return {items:[]};
    }));
    const page=await browser.newPage({viewport:{width:390,height:844}});await visit(page,web.origin+'/explore');
    await page.getByRole('navigation',{name:'探索方式'}).getByRole('link',{name:'来源',exact:true}).click();
    await expect(page).toHaveURL(web.origin+'/explore?view=sources');
    await expect(page.getByRole('navigation',{name:'探索方式'}).getByRole('link',{name:'来源',exact:true})).toHaveAttribute('aria-current','page');
    await page.reload();
    const source=page.getByRole('link',{name:'Source UI',exact:true});
    await expect(source.locator('time')).toHaveAttribute('datetime','2026-10-24T12:00:00.000Z');
    await expect(source).toContainText('2 篇已收录文章');await expect(source).toContainText('更新');
    await expect(page.locator('main a[target="_blank"]')).toHaveCount(0);
    await expect(page.getByRole('link',{name:'Undated source',exact:true}).locator('time')).toHaveCount(0);
    await source.click();await expect(page).toHaveURL(web.origin+'/?sourceId=source-ui');
    await expect(page.getByLabel('来源',{exact:true})).toHaveValue('source-ui');
    await expect(page.getByRole('heading',{level:1})).toHaveText('文章');await expect(page.getByRole('link',{name:'A source article',exact:true})).toBeVisible();
    await page.goBack();await expect(page).toHaveURL(web.origin+'/explore?view=sources');
    await page.getByRole('navigation',{name:'探索方式'}).getByRole('link',{name:'主题',exact:true}).click();await expect(page).toHaveURL(web.origin+'/explore');
  }finally{await browser.close();await web?.stop();}
});
