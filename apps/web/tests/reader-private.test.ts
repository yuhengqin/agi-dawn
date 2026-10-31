import assert from "node:assert/strict";
import {test} from "node:test";
import {chromium,webkit,expect} from "@playwright/test";
import {fakeApi,startWebServer,visit,type WebServer} from "./web-server.ts";
import type {SavedReaderView,ReaderPosition} from "../../../modules/reader/contracts.ts";

for(const engine of [chromium,webkit])test(`private reading navigation resumes saved sections across visits and layout changes (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,position:ReaderPosition|null={snapshotId:'resume-snapshot',bodyRevision:2,anchor:'sec-1',offset:0.25,progress:0.15,version:1,updatedAt:'2026-10-28T00:00:00Z'},puts=0,otherWrites=0;
  const outline=[1,2,3,4].map(n=>({id:'sec-'+n,text:n===2?'Chapter 2: a long section title that remains readable in a narrow viewport':'Chapter '+n,level:n===3?3:2}));
  const html=outline.map(({id,text,level})=>`<h${level} id="${id}">${text}</h${level}>`+Array.from({length:9},(_,n)=>`<p>${text} paragraph ${n}. ${'Long reading content. '.repeat(12)}</p>`).join('')).join('');
  const snapshot={id:'resume-snapshot',articleId:'resume-ui',title:'Continue reading',sourceName:'Source',author:null,publishedAt:null,discoveredAt:'2026-10-28T00:00:00Z',bodyRevision:2,createdAt:'2026-10-28T00:00:00Z',status:'complete',quality:'ready',issues:[],resources:[],bodyHtml:html,outline,originalUrl:'https://example.com/resume'};
  const note={articleId:'resume-ui',text:'Keep saved note',version:1,updatedAt:null},state={articleId:'resume-ui',starred:true,status:'read',version:5,updatedAt:null};
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/categories')return {items:[{id:'uncategorized',name:'待分类'}]};if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname.startsWith('/api/admin/')){
        if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
        if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
        if(url.pathname.endsWith('/position')){
          if(req.method==='PUT'){assert.equal(req.headers['x-csrf-token'],'test-csrf');let body='';for await(const part of req)body+=part;const patch=JSON.parse(body);if(patch.expectedVersion!==(position?.version??0)){res.statusCode=409;return {detail:'另一窗口已更新'};}puts++;position={snapshotId:snapshot.id,bodyRevision:2,anchor:patch.anchor,offset:patch.offset,progress:patch.progress,version:(position?.version??0)+1,updatedAt:new Date().toISOString()};return position;}
          return {position,previous:null};
        }
        if(req.method!=='GET')otherWrites++;
        if(url.pathname==='/api/admin/reader/snapshots/resume-snapshot')return snapshot;
        if(url.pathname.endsWith('/snapshots'))return {items:[snapshot]};
        if(url.pathname==='/api/admin/reader/articles/resume-ui')return {article:{id:'resume-ui',title:snapshot.title,classificationVersion:0,category:null,topicSlugs:[]},note,state,currentSnapshot:snapshot};
      }
    }));
    const context=await browser.newContext({viewport:{width:engine===webkit?390:1440,height:850},reducedMotion:'reduce'});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const first=await context.newPage();await visit(first,web.origin+'/admin/reader/articles/resume-ui');await expect(first.getByLabel('私人笔记')).toHaveValue('Keep saved note');await expect(first.getByRole('button',{name:/继续阅读/})).toBeVisible();
    if(engine===webkit)await first.getByLabel('展开文章目录',{exact:true}).click();
    const nav=first.locator('nav[aria-label="'+(engine===webkit?'手机文章目录':'文章目录')+'"]');await nav.getByRole('link',{name:outline[1]!.text,exact:true}).click();await expect(nav.getByRole('link',{name:outline[1]!.text,exact:true,includeHidden:true})).toHaveAttribute('aria-current','location');
    await expect.poll(()=>position?.anchor).toBe('sec-2');assert(position!.offset<0.005,'closing the resume offer must not move the selected section past its start');await expect(nav.getByRole('link',{name:outline[1]!.text,exact:true,includeHidden:true})).toHaveAttribute('aria-current','location');assert.equal(otherWrites,0);const saved={...position!},atVersion=puts;
    const second=await context.newPage();await visit(second,web.origin+'/admin/reader/articles/resume-ui');await expect(second.getByRole('button',{name:/继续阅读/})).toBeVisible();assert.equal(await second.evaluate(()=>window.scrollY),0);await second.waitForTimeout(1100);assert.equal(puts,atVersion,'opening a page never replaces the saved position');
    await second.getByRole('button',{name:/继续阅读/}).click();
    const distance=()=>second.locator('#sec-2').evaluate(el=>el.getBoundingClientRect().top-parseFloat(getComputedStyle(el).scrollMarginTop));await expect.poll(distance).toBeLessThan(4);assert.equal(puts,atVersion,'restoring is read-only');
    await second.evaluate(()=>{const p=document.querySelector('#sec-1 + p') as HTMLElement;p.style.paddingTop='700px';});await expect.poll(distance).toBeLessThan(4);await expect.poll(distance).toBeGreaterThan(-4);
    await second.setViewportSize({width:390,height:740});await expect.poll(distance).toBeLessThan(4);await expect.poll(distance).toBeGreaterThan(-4);assert.equal(puts,atVersion);assert.equal(position!.version,saved.version);assert.equal(otherWrites,0);await expect(second.getByLabel('私人笔记')).toHaveValue('Keep saved note');
    await second.mouse.move(180,500);await second.mouse.wheel(0,360);await expect.poll(()=>puts).toBe(atVersion+1);const beforeDisplay={...position!},displayVersion=puts;
    await first.getByLabel('私人笔记').fill('Display changes keep this unsaved draft');await first.getByText('阅读显示设置',{exact:true}).click();await first.getByRole('combobox',{name:'正文字号',exact:true}).selectOption('large');await first.getByRole('combobox',{name:'正文行距',exact:true}).selectOption('loose');
    await expect.poll(()=>second.locator('#reader-body .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(20);
    const offset=()=>second.evaluate(anchor=>{const root=document.getElementById('reader-body')!,heading=document.getElementById(anchor!)!,next=heading.parentElement!.querySelector('#sec-3')!;const line=scrollY+parseFloat(getComputedStyle(root).scrollMarginTop),start=heading.getBoundingClientRect().top+scrollY,end=next.getBoundingClientRect().top+scrollY;return (line-start)/(end-start);},beforeDisplay.anchor);
    assert.equal(beforeDisplay.anchor,'sec-2');await expect.poll(offset).toBeGreaterThan(beforeDisplay.offset-0.005);await expect.poll(offset).toBeLessThan(beforeDisplay.offset+0.005);await second.waitForTimeout(1100);assert.equal(puts,displayVersion,'appearance-only reflow never writes reading position');assert.equal(position!.version,beforeDisplay.version);await expect(first.getByLabel('私人笔记')).toHaveValue('Display changes keep this unsaved draft');
    const history=await context.newPage();await visit(history,web.origin+'/admin/reader/snapshots/resume-snapshot');await expect.poll(()=>history.locator('#reader-body .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(20);assert.equal(puts,displayVersion);
    await history.getByText('阅读显示设置',{exact:true}).click();await history.getByRole('combobox',{name:'正文宽度',exact:true}).selectOption('narrow');
    for(const path of ['/admin/reader/articles/resume-ui','/admin/reader/snapshots/resume-snapshot'])for(const width of [800,900,1440]){await history.setViewportSize({width,height:850});await visit(history,web.origin+path);const measure=await history.locator('#reader-body .prose').evaluate(el=>el.getBoundingClientRect().width);assert(measure<=641,`${path} at ${width}: narrow body ${measure} exceeds its reading measure`);assert(await history.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await history.getByText('阅读显示设置',{exact:true}).click();await history.getByRole('combobox',{name:'正文宽度',exact:true}).selectOption('wide');await expect.poll(()=>history.locator('#reader-body .prose').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(700);assert.equal(puts,displayVersion);
    await context.clearCookies();await second.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(second).toHaveURL(/\/admin\/login/);await expect(second.getByRole('heading',{name:outline[1]!.text,exact:true})).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

test('reading without headings stops after conflicts or failures, flushes on hide and expires with the session',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,attempts=0,mode=409,expired=false;
  let position:ReaderPosition|null=null;
  const snapshot={id:'plain-snapshot',articleId:'plain-ui',title:'Plain reading',sourceName:'Source',author:null,publishedAt:null,discoveredAt:'2026-10-28T00:00:00Z',bodyRevision:1,createdAt:'2026-10-28T00:00:00Z',status:'complete',quality:'ready',issues:[],resources:[],bodyHtml:Array.from({length:70},(_,n)=>`<p>Paragraph ${n}. ${'Plain article content. '.repeat(20)}</p>`).join(''),outline:[],originalUrl:'https://example.com/plain'};
  const note={articleId:'plain-ui',text:'Saved personal note',version:1,updatedAt:null},state={articleId:'plain-ui',starred:false,status:'to-read',version:0,updatedAt:null};
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/categories')return {items:[{id:'uncategorized',name:'待分类'}]};if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname.startsWith('/api/admin/')){
        if(expired||!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
        if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
        if(url.pathname.endsWith('/position')){
          if(req.method==='GET')return {position,previous:null};
          attempts++;let body='';for await(const chunk of req)body+=chunk;const patch=JSON.parse(body);assert.equal(req.headers['x-csrf-token'],'test-csrf');
          if(mode===409){position={snapshotId:snapshot.id,bodyRevision:1,anchor:null,offset:0.4,progress:0.4,version:1,updatedAt:new Date().toISOString()};res.statusCode=409;return {detail:'Changed elsewhere'};}
          if(mode){if(mode===401)expired=true;res.statusCode=mode;return {};}
          assert.equal(patch.expectedVersion,position?.version??0);return position={snapshotId:snapshot.id,bodyRevision:1,anchor:patch.anchor,offset:patch.offset,progress:patch.progress,version:(position?.version??0)+1,updatedAt:new Date().toISOString()};
        }
        if(url.pathname.endsWith('/snapshots'))return {items:[snapshot]};
        if(url.pathname==='/api/admin/reader/articles/plain-ui')return {article:{id:'plain-ui',title:snapshot.title,classificationVersion:0,category:null,topicSlugs:[]},note,state,currentSnapshot:snapshot};
      }
    }));
    const context=await browser.newContext({reducedMotion:'reduce'});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader/articles/plain-ui');await expect(page.getByText('正在载入阅读位置…',{exact:true})).toHaveCount(0);await page.mouse.wheel(0,1200);await expect(page.getByRole('alert')).toContainText('另一窗口已更新');const conflicted=attempts;await page.mouse.wheel(0,400);await page.waitForTimeout(1100);assert.equal(attempts,conflicted);
    mode=0;await page.getByRole('button',{name:'载入阅读位置',exact:true}).click();await page.getByRole('button',{name:/继续阅读/}).click();await page.mouse.wheel(0,200);await expect.poll(()=>position?.version).toBe(2);assert.equal(position!.anchor,null);
    await page.mouse.wheel(0,300);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect.poll(()=>position?.version).toBe(3);
    mode=503;await page.mouse.wheel(0,400);await expect(page.getByRole('alert')).toContainText('已停止自动保存');const failed=attempts;await page.mouse.wheel(0,200);await page.waitForTimeout(1100);assert.equal(attempts,failed);
    mode=401;await page.getByRole('button',{name:'载入阅读位置',exact:true}).click();await expect(page.getByRole('button',{name:/继续阅读/})).toBeVisible();await page.mouse.wheel(0,500);await expect(page).toHaveURL(/\/admin\/login/);await expect(page.getByLabel('私人笔记')).toHaveCount(0);await expect(page.getByText('Saved personal note',{exact:true})).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});
test('Markdown download exports the saved server note, keeps drafts and reports failures without navigating',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,fail=0,writes=0;
  const note={articleId:'export-ui',text:'Old saved note',version:1,updatedAt:null},state={articleId:'export-ui',starred:true,status:'reading',version:1,updatedAt:null};
  try{
    web=await startWebServer(fakeApi((url,res,req)=>{
      if(url.pathname==='/api/site/items/export-ui')return {id:'export-ui',title:'Export article',summary:null,source:{id:'ui',name:'UI'},author:null,links:{original:'https://example.com'},publishedAt:null,discoveredAt:'2026-10-27T02:00:00Z',timelineAt:'2026-10-27T02:00:00Z',category:null,tags:[],engagement:{views:0,likes:0},bodyState:{status:'not-permitted',bodyRevision:null,refreshPending:false,issues:[]},bodyHtml:null,outline:[],topics:[]};
      if(url.pathname.startsWith('/api/admin/')){
        if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
        if(req.method!=='GET')writes++;
        if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
        if(url.pathname.endsWith('/note.md')){if(fail){res.statusCode=fail;return {detail:'导出暂时失败'};}res.setHeader('Content-Type','text/markdown; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="reading-note-export-ui.md"');return res.end('# Server article\n\nLatest saved note\n');}
        if(url.pathname==='/api/admin/reader/articles/export-ui')return {note,state};
      }
    }));
    const context=await browser.newContext({acceptDownloads:true});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/items/export-ui');
    await page.getByLabel('私人笔记').fill('Unsaved private draft');await expect(page.getByText('仅导出已保存笔记，当前草稿不会写入文件。',{exact:true})).toBeVisible();
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出笔记 Markdown',exact:true}).click();const download=await downloading;assert.equal(download.suggestedFilename(),'reading-note-export-ui.md');const stream=await download.createReadStream();assert(stream);let content='';for await(const part of stream)content+=part;assert(content.includes('Latest saved note'));assert(!content.includes('Unsaved private draft'));await expect(page.getByLabel('私人笔记')).toHaveValue('Unsaved private draft');assert.equal(writes,0);
    fail=503;await page.getByRole('button',{name:'导出笔记 Markdown',exact:true}).click();await expect(page.getByRole('alert')).toContainText('导出暂时失败');await expect(page).toHaveURL(/\/items\/export-ui$/);await expect(page.getByLabel('私人笔记')).toHaveValue('Unsaved private draft');
    fail=401;await page.getByRole('button',{name:'导出笔记 Markdown',exact:true}).click();await expect(page.getByLabel('私人笔记')).toHaveCount(0);assert(!(await page.content()).includes('Unsaved private draft'));assert.equal(writes,0);
  }finally{await browser.close();await web?.stop();}
});

test('a late successful note export is discarded after session verification clears private tools',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,expired=false,release:(()=>void)|undefined,authorized:(()=>void)|undefined,downloads=0;
  const pending=new Promise<void>(resolve=>release=resolve),begun=new Promise<void>(resolve=>authorized=resolve);
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/items/late-export')return {id:'late-export',title:'Late export',summary:null,source:{id:'ui',name:'UI'},author:null,links:{original:'https://example.com'},publishedAt:null,discoveredAt:'2026-10-27T02:00:00Z',timelineAt:'2026-10-27T02:00:00Z',category:null,tags:[],engagement:{views:0,likes:0},bodyState:{status:'not-permitted',bodyRevision:null,refreshPending:false,issues:[]},bodyHtml:null,outline:[],topics:[]};
      if(url.pathname.startsWith('/api/admin/')){
        if(expired||!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
        if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
        if(url.pathname.endsWith('/note.md')){authorized!();await pending;res.setHeader('Content-Type','text/markdown');return res.end('# Private saved note\n');}
        return {note:{articleId:'late-export',text:'Saved private note',version:1,updatedAt:null},state:{articleId:'late-export',starred:false,status:'to-read',version:0,updatedAt:null}};
      }
    }));
    const context=await browser.newContext({acceptDownloads:true});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();page.on('download',()=>downloads++);await visit(page,web.origin+'/items/late-export');await expect(page.getByLabel('私人笔记')).toHaveValue('Saved private note');
    await page.getByRole('button',{name:'导出笔记 Markdown',exact:true}).click();await begun;
    expired=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByLabel('私人笔记')).toHaveCount(0);
    const returned=page.waitForResponse(response=>response.url().endsWith('/note.md'));release!();const response=await returned;assert.equal(response.status(),200);await response.finished();await page.waitForTimeout(500);assert.equal(downloads,0,'a response from the expired private session must never create a download');assert(!(await page.content()).includes('Saved private note'));
  }finally{release?.();await browser.close();await web?.stop();}
});
test("private notes keep a conflicting draft and disappear when the session ends",async()=>{
  let note={articleId:"private-ui",text:"server note",version:1,updatedAt:null};
  let state={articleId:"private-ui",starred:false,status:"to-read",version:0,updatedAt:null};
  const article={id:"private-ui",title:"Private reading UI",summary:null,source:{id:"ui",name:"UI"},author:null,links:{original:"https://example.com"},
    publishedAt:null,discoveredAt:"2026-10-27T02:00:00Z",timelineAt:"2026-10-27T02:00:00Z",category:null,tags:[],
    engagement:{views:0,likes:0},bodyState:{status:"not-permitted",bodyRevision:null,refreshPending:false,issues:[]},bodyHtml:null,outline:[],topics:[]};
  const browser=await chromium.launch();let web:WebServer|undefined;
  try {
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==="/api/site/items/private-ui")return article;
      if(url.pathname.startsWith("/api/admin/")) {
        if(!req.headers.cookie?.includes("testowner=1")){res.statusCode=401;return {code:"unauthorized"};}
        if(url.pathname==="/api/admin/me")return {name:"Owner",csrf:"test-csrf"};
        if(url.pathname==="/api/admin/reader/articles/private-ui"&&req.method==="GET")return {state,note};
        if(req.method==="PUT"||req.method==="PATCH"){
          assert.equal(req.headers["x-csrf-token"],"test-csrf");
          let text="";for await(const chunk of req)text+=chunk;
          const patch=JSON.parse(text);
          if(url.pathname.endsWith("/note")){
            if(patch.expectedVersion!==note.version){res.statusCode=409;return {detail:"冲突"};}
            return note={...note,text:patch.text,version:note.version+1};
          }
          if(patch.expectedVersion!==state.version){res.statusCode=409;return {detail:"冲突"};}
          return state={...state,...patch,version:state.version+1};
        }
      }
    }));
    const context=await browser.newContext();
    await context.addCookies([{name:"testowner",value:"1",url:web.origin}]);
    const first=await context.newPage(),second=await context.newPage();
    await visit(first,web.origin+"/items/private-ui");await visit(second,web.origin+"/items/private-ui");
    await expect(first.getByLabel("私人笔记")).toHaveValue("server note");
    await first.getByLabel("私人笔记").fill("first saved");
    await first.getByRole("button",{name:"保存笔记",exact:true}).click();
    await expect(first.getByText("笔记已保存", {exact:true})).toBeVisible();
    await second.getByLabel("私人笔记").fill("second unsaved draft");
    await second.getByRole("button",{name:"保存笔记",exact:true}).click();
    await expect(second.getByRole("alert")).toContainText("冲突");
    await expect(second.getByLabel("私人笔记")).toHaveValue("second unsaved draft");
    await second.getByRole("button",{name:"载入服务端版本",exact:true}).click();
    await expect(second.getByText("first saved",{exact:true})).toBeVisible();
    await expect(second.getByLabel("私人笔记")).toHaveValue("second unsaved draft");
    await context.clearCookies();await second.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(second.getByLabel("私人笔记")).toHaveCount(0);
    assert.ok(!(await second.content()).includes("second unsaved draft"));
  } finally {await browser.close();await web?.stop();}
});

test('private reading keeps body and notes together, protects drafts and restores library filters',async()=>{
  let note={articleId:'daily-ui',text:'Saved note',version:1,updatedAt:null};
  const state={articleId:'daily-ui',starred:true,status:'reading',version:1,updatedAt:null};
  const snapshot={id:'daily-snapshot',articleId:'daily-ui',title:'Daily reading',sourceName:'Source',author:'Author',publishedAt:null,discoveredAt:'2026-10-28T00:00:00Z',bodyRevision:2,createdAt:'2026-10-28T00:00:00Z',status:'partial',quality:'partial',issues:[{kind:'missing-figure',message:'图表需对照原文'}],resources:[],bodyHtml:'<p>Private body in the reading page.</p>',originalUrl:'https://example.com/daily'};
  const browser=await chromium.launch();let web:WebServer|undefined;
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/categories')return {items:[{id:'uncategorized',name:'待分类'}]};
      if(url.pathname==='/api/site/topics')return {topics:[]};
      if(url.pathname.startsWith('/api/admin/')){
        if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {code:'unauthorized'};}
        if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
        if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
        if(url.pathname==='/api/admin/reader/library'){if([...url.searchParams.values()].some(value=>value==='')){res.statusCode=400;return {detail:'empty filter'};}return {items:[{id:'daily-ui',title:'Daily reading',source:'Source',classificationVersion:0,state,matches:[]}],nextCursor:null,filters:{sources:[],categories:[{id:'uncategorized',name:'待分类'}],topics:[]}};}
        if(url.pathname==='/api/admin/reader/snapshots/daily-snapshot')return snapshot;
        if(url.pathname.endsWith('/snapshots'))return {items:[snapshot]};
        if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;note={...note,text:JSON.parse(body).text,version:note.version+1};return note;}
        if(url.pathname==='/api/admin/reader/articles/daily-ui')return {article:{id:'daily-ui',title:'Daily reading',classificationVersion:0,category:null,topicSlugs:[]},state,note,currentSnapshot:snapshot};
      }
    }));
    const context=await browser.newContext();await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();
    await visit(page,web.origin+'/admin/reader/articles/daily-ui');
    await expect(page.getByText('Private body in the reading page.',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'重试缺失图片'})).toHaveCount(0);
    await page.getByLabel('私人笔记').fill('Unfinished draft');
    await expect(page.getByText('笔记尚未保存',{exact:true})).toBeVisible();
    const cancelled=page.waitForEvent('dialog').then(dialog=>dialog.dismiss());
    await page.getByRole('link',{name:'私人书库',exact:true}).first().click();await cancelled;
    await expect(page.getByLabel('私人笔记')).toHaveValue('Unfinished draft');
    await page.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(page.getByText('笔记已保存',{exact:true})).toBeVisible();
    await page.getByRole('link',{name:'私人书库',exact:true}).first().click();await expect(page).toHaveURL(/\/admin\/reader$/);
    await page.goto(web.origin+'/admin/reader?starred=true&status=reading');await page.reload();
    await expect(page.getByRole('combobox',{name:'收藏',exact:true})).toHaveValue('true');await expect(page.getByRole('combobox',{name:'阅读状态',exact:true})).toHaveValue('reading');
    await page.getByRole('combobox',{name:'阅读状态',exact:true}).selectOption('read');await page.getByRole('button',{name:'筛选',exact:true}).click();
    await expect.poll(()=>new URL(page.url()).searchParams.get('status')).toBe('read');
    await expect(page.getByRole('combobox',{name:'阅读状态',exact:true})).toHaveValue('read');
    await page.getByRole('combobox',{name:'收藏',exact:true}).selectOption('');await page.getByRole('combobox',{name:'阅读状态',exact:true}).selectOption('');
    await page.getByRole('button',{name:'筛选',exact:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get('status')).toBe('');await page.reload();await expect(page.getByRole('heading',{name:'私人书库',exact:true})).toBeVisible();
    for(const route of ['/admin/reader/articles/daily-ui','/admin/reader/snapshots/daily-snapshot']){
      await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);await visit(page,web.origin+route);
      await expect(page.getByText('Private body in the reading page.',{exact:true})).toBeVisible();await page.getByLabel('私人笔记').fill('Private session draft');
      await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await expect(page).toHaveURL(/\/admin\/login/);await expect(page.getByText('Private body in the reading page.',{exact:true})).toHaveCount(0);await expect(page.getByLabel('私人笔记')).toHaveCount(0);
    }
  }finally{await browser.close();await web?.stop();}
});

test('private library combines keywords and five filters through refresh, pagination and clearing without leaking snippets',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  try{
    web=await startWebServer(fakeApi((url,res,req)=>{
      if(url.pathname.startsWith('/api/admin/')){
        if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
        if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
        if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
        if(url.pathname==='/api/admin/reader/library'){
          if([...url.searchParams.values()].some(v=>v==='')){res.statusCode=400;return {detail:'empty filter'};}
          return {items:[{id:'book',title:url.searchParams.has('cursor')?'Next private article':'Private article',source:'Source',withdrawn:false,classificationVersion:0,state:{starred:true,status:'reading'},matches:url.searchParams.has('q')?[{field:'body',snippet:'memory & tools'},{field:'note',snippet:'memory <img src=x onerror=alert(1)> private thought'}]:[]}],nextCursor:url.searchParams.has('cursor')?null:'next-private-page',filters:{sources:[{id:'source',name:'Source'}],categories:[{id:'uncategorized',name:'待分类'},{id:'agents',name:'智能体工程'}],topics:[{slug:'mcp',name:'MCP 与工具调用',definition:'Tools'}]}};
        }
      }
    }));
    const context=await browser.newContext();await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();
    await visit(page,web.origin+'/admin/reader');
    await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('memory MCP');
    for(const [name,value] of [['来源','source'],['类别','agents'],['主题','mcp'],['收藏','true'],['阅读状态','reading']])await page.getByRole('combobox',{name,exact:true}).selectOption(value);
    await page.getByRole('searchbox',{name:'关键词',exact:true}).press('Enter');
    await expect(page).toHaveURL(/sourceId=source/);
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),{q:'memory MCP',sourceId:'source',category:'agents',topic:'mcp',starred:'true',status:'reading',hasNote:'',sort:'collected',dateField:'collected',dateFrom:'',dateTo:''});
    await expect(page.getByText('正文：memory & tools',{exact:true})).toBeVisible();await expect(page.getByText('私人笔记：memory <img src=x onerror=alert(1)> private thought',{exact:true})).toBeVisible();assert.equal(await page.locator('img[src="x"]').count(),0);
    await visit(page,page.url());await expect(page.getByRole('combobox',{name:'类别',exact:true})).toHaveValue('agents');
    await expect(page.getByRole('searchbox',{name:'关键词',exact:true})).toHaveValue('memory MCP');
    await page.getByRole('link',{name:'更早的文章',exact:true}).click();
    await expect(page.getByRole('link',{name:'Next private article',exact:true})).toBeVisible();
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),{q:'memory MCP',sourceId:'source',category:'agents',topic:'mcp',starred:'true',status:'reading',sort:'collected',dateField:'collected',cursor:'next-private-page'});
    await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('changed');await page.getByRole('searchbox',{name:'关键词',exact:true}).press('Enter');await expect(page).toHaveURL(/q=changed/);assert.equal(new URL(page.url()).searchParams.has('cursor'),false);
    await page.getByRole('combobox',{name:'类别',exact:true}).selectOption('uncategorized');await page.getByRole('button',{name:'筛选',exact:true}).click();
    await expect(page).toHaveURL(/category=uncategorized/);assert.equal(new URL(page.url()).searchParams.has('cursor'),false);
    await page.getByRole('link',{name:'清除筛选',exact:true}).click();await expect(page).toHaveURL(web.origin+'/admin/reader');
    for(const name of ['来源','类别','主题','收藏','阅读状态'])await expect(page.getByRole('combobox',{name,exact:true})).toHaveValue('');
    await expect(page.getByRole('searchbox',{name:'关键词',exact:true})).toHaveValue('');await expect(page.getByText('正文：memory & tools',{exact:true})).toHaveCount(0);
    await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('memory');await page.getByRole('searchbox',{name:'关键词',exact:true}).press('Enter');await expect(page.getByText('正文：memory & tools',{exact:true})).toBeVisible();
    await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page).toHaveURL(/\/admin\/login/);await expect(page.getByText('私人笔记：memory <img src=x onerror=alert(1)> private thought',{exact:true})).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`library date controls preserve drafts and compose saved views, pagination and bulk operations (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined,view:SavedReaderView|undefined;const queries:URLSearchParams[]=[],writes:unknown[]=[];
  const filters={sourceId:'source',category:'agents',topic:'mcp',starred:'true',status:'reading',hasNote:'true',sort:'note-updated'};
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/library'){queries.push(new URLSearchParams(url.search));return {items:[{id:'date-book',title:'Dated article',source:'Source',classificationVersion:0,state:{articleId:'date-book',starred:true,status:'reading',version:3,updatedAt:null},note:null,matches:[]}],nextCursor:url.searchParams.has('cursor')?null:'date-next',filters:{sources:[{id:'source',name:'Source'}],categories:[{id:'agents',name:'智能体工程'}],topics:[{slug:'mcp',name:'MCP',definition:'Tools'}]}};}
      if(url.pathname==='/api/admin/reader/views'){if(req.method==='GET')return {items:view?[view]:[]};let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);return view={id:'date-view',name:body.name,filters:body.filters,version:1,createdAt:'2026-01-02T00:00:00Z',updatedAt:'2026-01-02T00:00:00Z'};}
      if(url.pathname==='/api/admin/reader/state'){let text='';for await(const chunk of req)text+=chunk;writes.push(JSON.parse(text));return {selected:1,changed:1};}
      if(url.pathname==='/api/admin/reader/notes/export.zip'){let text='';for await(const chunk of req)text+=chunk;writes.push(JSON.parse(text));res.setHeader('content-type','application/zip');return res.end('dated notes zip');}
    }));
    const context=await browser.newContext({viewport:{width:320,height:800},timezoneId:'America/Los_Angeles',acceptDownloads:true});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);await context.addInitScript(()=>{Date.now=()=>Date.parse('2026-01-01T16:30:00Z');});const page=await context.newPage();await visit(page,web.origin+'/admin/reader?'+new URLSearchParams({...filters,q:'original'}));
    await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('draft kept');await page.getByRole('combobox',{name:'日期依据',exact:true}).selectOption('note-updated');await page.getByRole('button',{name:'近 7 天',exact:true}).click();
    await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2025-12-27');await expect(page.getByLabel('结束日期',{exact:true})).toHaveValue('2026-01-02');await expect(page.getByRole('searchbox',{name:'关键词',exact:true})).toHaveValue('draft kept');assert.equal(queries.length,1,'shortcut only fills the draft');
    await page.getByRole('button',{name:'近 30 天',exact:true}).click();await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2025-12-04');await page.getByRole('button',{name:'近 7 天',exact:true}).click();await page.getByRole('button',{name:'筛选',exact:true}).click();await expect(page).toHaveURL(/dateFrom=2025-12-27/);
    const applied={...filters,q:'draft kept',dateField:'note-updated',dateFrom:'2025-12-27',dateTo:'2026-01-02'};assert.deepEqual(Object.fromEntries(queries.at(-1)!),applied);await visit(page,page.url());await expect(page.getByRole('combobox',{name:'日期依据',exact:true})).toHaveValue('note-updated');await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2025-12-27');
    await page.getByRole('link',{name:'下一页',exact:true}).click();await expect(page).toHaveURL(/cursor=date-next/);assert.deepEqual(Object.fromEntries(queries.at(-1)!),{...applied,cursor:'date-next'});
    const add=page.getByRole('form',{name:'保存常用视图',exact:true});await add.getByLabel('视图名称',{exact:true}).fill('一周笔记');await add.getByRole('button',{name:'保存当前条件为视图',exact:true}).click();await expect(page.getByRole('link',{name:'打开视图：一周笔记',exact:true})).toBeVisible();assert.deepEqual(view!.filters,applied);await expect(page.getByRole('region',{name:'视图：一周笔记',exact:true})).toContainText('2025-12-27');
    await page.evaluate(()=>{Date.now=()=>Date.parse('2026-02-01T00:00:00Z');});await page.getByRole('link',{name:'打开视图：一周笔记',exact:true}).click();await expect(page).not.toHaveURL(/cursor=/);assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),applied,'saved dates stay fixed when today changes');
    await page.getByRole('checkbox',{name:'选择 Dated article',exact:true}).check();const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出所选笔记 Markdown（ZIP）',exact:true}).click();await download;assert.deepEqual(writes,[{articleIds:['date-book']}]);await expect(page.getByRole('checkbox',{name:'选择 Dated article',exact:true})).toBeChecked();
    await page.getByRole('radio',{name:'收藏与阅读状态',exact:true}).check();await page.getByRole('combobox',{name:'批量阅读状态',exact:true}).selectOption('read');await page.getByRole('button',{name:'检查批量变更',exact:true}).click();assert.equal(writes.length,1);await page.getByRole('button',{name:'确认整理1篇',exact:true}).click();await expect(page.getByRole('checkbox',{name:'选择 Dated article',exact:true})).not.toBeChecked();assert.deepEqual(writes[1],{articles:[{id:'date-book',expectedVersion:3}],status:'read'});assert.deepEqual(Object.fromEntries(queries.at(-1)!),applied);
    for(const width of [320,390,1440]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${engine.name()} ${width}: no horizontal overflow`);}
    await page.getByRole('checkbox',{name:'选择 Dated article',exact:true}).check();await page.getByRole('button',{name:'清除日期',exact:true}).click();await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('');await expect(page.getByRole('searchbox',{name:'关键词',exact:true})).toHaveValue('draft kept');await page.getByRole('button',{name:'筛选',exact:true}).click();await expect(page.getByRole('checkbox',{name:'选择 Dated article',exact:true})).not.toBeChecked();assert.equal(queries.at(-1)!.has('dateFrom'),false);assert.equal(queries.at(-1)!.get('status'),'reading');
  }finally{await browser.close();await web?.stop();}
});

test('note review keeps applied filters, shows saved plain text and stores sorting in named views',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;let view:SavedReaderView|undefined;
  const filters={q:'memory',sourceId:'source',category:'agents',topic:'mcp',starred:'true',status:'reading'},queries:string[]=[];
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/library'){queries.push(url.search);return {items:[{id:'review-book',title:'Review article',source:'Source',classificationVersion:0,state:{articleId:'review-book',starred:true,status:'reading',version:1,updatedAt:null},note:{snippet:'Saved <img src=x> private thought',updatedAt:'2026-10-29T01:02:03Z'},matches:[]}],nextCursor:url.searchParams.has('cursor')?null:'review-next',filters:{sources:[{id:'source',name:'Source'}],categories:[{id:'agents',name:'智能体工程'}],topics:[{slug:'mcp',name:'MCP',definition:'Tools'}]}};}
      if(url.pathname==='/api/admin/reader/views'){if(req.method==='GET')return {items:view?[view]:[]};let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);return view={id:'review-view',name:body.name,filters:body.filters,version:1,createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z'};}
    }));
    const context=await browser.newContext({viewport:{width:320,height:800}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader?'+new URLSearchParams({...filters,cursor:'old-page',limit:'7'}));
    await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('Unapplied draft');await page.getByRole('link',{name:'笔记回顾',exact:true}).click();await expect(page.getByRole('heading',{name:'私人笔记回顾',exact:true})).toBeVisible();const applied={...filters,hasNote:'true',sort:'note-updated'};assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),applied);
    await expect(page.getByText('已保存笔记：Saved <img src=x> private thought',{exact:true})).toBeVisible();await expect(page.locator('time')).toHaveAttribute('datetime','2026-10-29T01:02:03Z');assert.equal(await page.locator('img[src=x]').count(),0);
    await expect(page.getByRole('combobox',{name:'笔记',exact:true})).toHaveValue('true');await expect(page.getByRole('combobox',{name:'排序',exact:true})).toHaveValue('note-updated');await page.getByRole('link',{name:'下一页',exact:true}).click();await expect(page).toHaveURL(/cursor=review-next/);
    const add=page.getByRole('form',{name:'保存常用视图',exact:true});await add.getByRole('textbox',{name:'视图名称',exact:true}).fill('复习笔记');await add.getByRole('button',{name:'保存当前条件为视图',exact:true}).click();await expect(page.getByRole('link',{name:'打开视图：复习笔记',exact:true})).toBeVisible();assert.deepEqual(view!.filters,applied);await page.getByRole('link',{name:'打开视图：复习笔记',exact:true}).click();await expect(page).not.toHaveURL(/cursor=|limit=/);
    await page.getByRole('combobox',{name:'笔记',exact:true}).selectOption('false');await page.getByRole('combobox',{name:'排序',exact:true}).selectOption('collected');await page.getByRole('button',{name:'筛选',exact:true}).click();await expect(page).toHaveURL(/hasNote=false/);assert(queries.at(-1)!.includes('sort=collected'));
    await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page).toHaveURL(/\/admin\/login/);await expect(page.getByText('已保存笔记：Saved <img src=x> private thought',{exact:true})).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

test('batch note download sends selected ids once and keeps classification and state drafts after success or failure',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,fail=0,expired=false,release:(()=>void)|undefined;const requests:unknown[]=[],writes:string[]=[];let reads=0;
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(expired||!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/views')return {items:[]};
      if(url.pathname==='/api/admin/reader/library'){reads++;return {items:['a','b','c'].map(id=>({id,title:'Export '+id,source:'Source',classificationVersion:0,state:{articleId:id,starred:false,status:'to-read',version:0,updatedAt:null},note:null,matches:[]})),nextCursor:null,filters:{sources:[],categories:[{id:'uncategorized',name:'待分类'}],topics:[{slug:'skills',name:'Skills',definition:'Skills'}]}};}
      if(url.pathname==='/api/admin/reader/notes/export.zip'){assert.equal(req.method,'POST');assert.equal(req.headers['x-csrf-token'],'test-csrf');let text='';for await(const chunk of req)text+=chunk;requests.push(JSON.parse(text));if(release===undefined)await new Promise<void>(resolve=>{release=resolve;});if(fail){expired=fail===401;res.statusCode=fail;return {detail:'Batch download unavailable'};}res.setHeader('content-type','application/zip');return res.end(Buffer.from('private zip bytes'));}
      if(req.method!=='GET')writes.push(req.method!);
    }));
    const context=await browser.newContext({viewport:{width:320,height:800},acceptDownloads:true});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader');
    await page.getByRole('checkbox',{name:'全选本页',exact:true}).check();await page.getByRole('checkbox',{name:'选择 Export c',exact:true}).uncheck();await page.getByRole('combobox',{name:'Skills',exact:true}).selectOption('add');await page.getByRole('radio',{name:'收藏与阅读状态',exact:true}).check();await page.getByRole('combobox',{name:'批量阅读状态',exact:true}).selectOption('read');
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出所选笔记 Markdown（ZIP）',exact:true}).click();await expect(page.getByRole('button',{name:'导出中…',exact:true})).toBeDisabled();await expect.poll(()=>requests.length).toBe(1);release!();const file=await download;assert.equal(file.suggestedFilename(),'reading-notes.zip');const stream=await file.createReadStream();assert(stream);let bytes='';for await(const part of stream)bytes+=part;assert.equal(bytes,'private zip bytes');
    await expect(page.getByRole('checkbox',{name:'选择 Export a',exact:true})).toBeChecked();await expect(page.getByRole('combobox',{name:'批量阅读状态',exact:true})).toHaveValue('read');await page.getByRole('radio',{name:'分类与主题',exact:true}).check();await expect(page.getByRole('combobox',{name:'Skills',exact:true})).toHaveValue('add');assert.equal(reads,1);assert.deepEqual(requests,[{articleIds:['a','b']}]);assert.deepEqual(writes,[]);
    fail=503;await page.getByRole('button',{name:'导出所选笔记 Markdown（ZIP）',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Batch download unavailable');await expect(page.getByRole('combobox',{name:'Skills',exact:true})).toHaveValue('add');await expect(page.getByRole('checkbox',{name:'选择 Export a',exact:true})).toBeChecked();
    fail=401;await page.getByRole('button',{name:'导出所选笔记 Markdown（ZIP）',exact:true}).click();await expect(page).toHaveURL(/\/admin\/login/);assert.deepEqual(writes,[]);
  }finally{release?.();await browser.close();await web?.stop();}
});

test('a pending batch download is discarded after selection, navigation, refresh or session expiry',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,expired=false,release:(()=>void)|undefined,started=0,downloads=0;
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(expired||!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/views')return {items:[]};
      if(url.pathname==='/api/admin/reader/library')return {items:[{id:'pending',title:'Pending export',source:'Source',classificationVersion:0,state:{articleId:'pending',starred:false,status:'to-read',version:0,updatedAt:null},note:null,matches:[]}],nextCursor:url.searchParams.has('cursor')?null:'next-batch',filters:{sources:[],categories:[],topics:[]}};
      if(url.pathname==='/api/admin/reader/notes/export.zip'){started++;await new Promise<void>(resolve=>{release=resolve;});res.setHeader('content-type','application/zip');return res.end(Buffer.from('late private file'));}
    }));
    const context=await browser.newContext({acceptDownloads:true});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();page.on('download',()=>downloads++);await visit(page,web.origin+'/admin/reader');
    for(const action of ['selection','navigation','refresh','expiry']){
      const pick=page.getByRole('checkbox',{name:'选择 Pending export',exact:true});await pick.check();await page.getByRole('button',{name:'导出所选笔记 Markdown（ZIP）',exact:true}).click();await expect.poll(()=>started).toBe(['selection','navigation','refresh','expiry'].indexOf(action)+1);
      if(action==='selection')await pick.uncheck();
      if(action==='navigation'){await page.getByRole('link',{name:'更早的文章',exact:true}).click();await expect(page).toHaveURL(/cursor=next-batch/);}
      if(action==='refresh'){await page.evaluate(()=>{const router=(globalThis as any).__reactRouterDataRouter;void router.revalidate();});await expect(pick).not.toBeChecked();}
      if(action==='expiry'){expired=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page).toHaveURL(/\/admin\/login/);}
      release!();await page.waitForTimeout(300);assert.equal(downloads,0,action+' invalidates the private file');
    }
  }finally{release?.();await browser.close();await web?.stop();}
});

test('native logout submission invalidates a batch download before the logout redirect returns',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,releaseZip:(()=>void)|undefined,releaseLogout:(()=>void)|undefined,started=0,logoutStarted=0,downloads=0;
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/auth/logout'){logoutStarted++;await new Promise<void>(resolve=>releaseLogout=resolve);res.statusCode=303;res.setHeader('location','/admin/login');return res.end();}
      if(!url.pathname.startsWith('/api/admin/'))return;if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};if(url.pathname==='/api/admin/reader/views')return {items:[]};
      if(url.pathname==='/api/admin/reader/library')return {items:[{id:'logout-batch',title:'Logout export',source:'Source',classificationVersion:0,state:{articleId:'logout-batch',starred:false,status:'to-read',version:0,updatedAt:null},note:null,matches:[]}],nextCursor:null,filters:{sources:[],categories:[],topics:[]}};
      if(url.pathname==='/api/admin/reader/notes/export.zip'){started++;await new Promise<void>(resolve=>releaseZip=resolve);res.setHeader('content-type','application/zip');return res.end(Buffer.from('late private file'));}
    }));
    const context=await browser.newContext({acceptDownloads:true});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();page.on('download',()=>downloads++);await visit(page,web.origin+'/admin/reader');await page.getByRole('checkbox',{name:'全选本页',exact:true}).check();await page.getByRole('button',{name:'导出所选笔记 Markdown（ZIP）',exact:true}).click();await expect.poll(()=>started).toBe(1);
    await page.evaluate(()=>document.querySelector<HTMLFormElement>('form[action="/api/auth/logout"]')!.requestSubmit());await expect.poll(()=>logoutStarted).toBe(1);releaseZip!();await page.waitForTimeout(500);assert.equal(downloads,0,'logout began even though the original document remains mounted');releaseLogout!();
  }finally{releaseZip?.();releaseLogout?.();await browser.close();await web?.stop();}
});

test('private article topic choices save, survive reload and remain editable after a conflict without clearing notes',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  let article={id:'topics-ui',title:'Topic editing',classificationVersion:0,category:null as string|null,topicSlugs:['mcp']};
  let conflict=false;const writes:Array<{expectedVersion:number;category:string|null;topicSlugs:string[]}> = [];
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/categories')return {items:[{id:'uncategorized',name:'待分类'},{id:'agents',name:'智能体工程'}]};
      if(url.pathname==='/api/site/topics')return {topics:[{slug:'mcp',name:'MCP 与工具调用',definition:'Tools'},{slug:'skills',name:'Skills 与扩展',definition:'Skills'}]};
      if(url.pathname.startsWith('/api/admin/')){
        if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
        if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
        if(url.pathname.endsWith('/classification')&&req.method==='PATCH'){
          let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);writes.push(body);
          assert.equal(req.headers['x-csrf-token'],'test-csrf');
          if(conflict||body.expectedVersion!==article.classificationVersion){res.statusCode=409;return {detail:'分类冲突'};}
          article={...article,category:body.category==='uncategorized'?null:body.category,topicSlugs:body.topicSlugs,classificationVersion:article.classificationVersion+1};return article;
        }
        if(url.pathname.endsWith('/snapshots'))return {items:[]};
        if(url.pathname==='/api/admin/reader/articles/topics-ui')return {article,state:{articleId:article.id,starred:false,status:'to-read',version:0},note:{articleId:article.id,text:'Saved note',version:1},currentSnapshot:null};
      }
    }));
    const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();
    await visit(page,web.origin+'/admin/reader/articles/topics-ui');
    await expect(page.getByRole('checkbox',{name:'MCP 与工具调用',exact:true})).toBeChecked();
    await page.getByRole('checkbox',{name:'MCP 与工具调用',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Skills 与扩展',exact:true}).check();
    await page.getByRole('combobox',{name:'文章分类',exact:true}).selectOption('agents');
    await page.getByRole('button',{name:'保存分类与主题',exact:true}).click();await expect(page.getByText('分类与主题已保存',{exact:true})).toBeVisible();
    assert.deepEqual(writes[0],{expectedVersion:0,category:'agents',topicSlugs:['skills']});
    await visit(page,page.url());await expect(page.getByRole('checkbox',{name:'Skills 与扩展',exact:true})).toBeChecked();
    await page.getByLabel('私人笔记').fill('Keep note draft');
    await page.getByRole('checkbox',{name:'MCP 与工具调用',exact:true}).check();conflict=true;article={...article,classificationVersion:2,topicSlugs:['mcp']};
    await page.getByRole('button',{name:'保存分类与主题',exact:true}).click();await expect(page.getByRole('alert')).toContainText('冲突');
    await expect(page.getByRole('checkbox',{name:'Skills 与扩展',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'MCP 与工具调用',exact:true})).toBeChecked();
    await page.getByRole('button',{name:'重新载入分类与主题',exact:true}).click();
    await expect(page.getByRole('checkbox',{name:'Skills 与扩展',exact:true})).not.toBeChecked();await expect(page.getByLabel('私人笔记')).toHaveValue('Keep note draft');
    conflict=false;await page.getByRole('checkbox',{name:'MCP 与工具调用',exact:true}).uncheck();await page.getByRole('button',{name:'保存分类与主题',exact:true}).click();
    await expect(page.getByText('分类与主题已保存',{exact:true})).toBeVisible();assert.deepEqual(writes.at(-1)!.topicSlugs,[]);assert.equal(writes.at(-1)!.expectedVersion,2);
    await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page).toHaveURL(/\/admin\/login/);await expect(page.getByRole('checkbox')).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

test('private library confirms only selected articles, submits topic deltas once and revalidates the original filters',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  const writes:unknown[]=[],queries:string[]=[];let applied=false,release:(()=>void)|undefined;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
      if(url.pathname==='/api/admin/reader/library'){
        queries.push(url.search);
        return {items:(applied?[['c','Retained article',7]]:[['a','Article A',2],['b','Article B',0],['c','Retained article',7]]).map(([id,title,classificationVersion])=>({id,title,classificationVersion,source:'Source',withdrawn:false,state:{articleId:id,starred:true,status:'reading',version:1,updatedAt:null},matches:[]})),nextCursor:null,filters:{sources:[{id:'source',name:'Source'}],categories:[{id:'uncategorized',name:'待分类'},{id:'agents',name:'智能体工程'}],topics:[{slug:'mcp',name:'MCP 与工具调用',definition:'Tools'},{slug:'skills',name:'Skills 与扩展',definition:'Skills'},{slug:'cost',name:'性能与成本',definition:'Cost'}]}};
      }
      if(url.pathname==='/api/admin/reader/classification'&&req.method==='PATCH'){
        assert.equal(req.headers['x-csrf-token'],'test-csrf');let body='';for await(const chunk of req)body+=chunk;writes.push(JSON.parse(body));await gate;applied=true;return {selected:2,changed:2};
      }
    }));
    const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();
    const query='q=memory&sourceId=source&category=agents&topic=mcp&starred=true&status=reading';
    await visit(page,web.origin+'/admin/reader?'+query);
    await page.getByRole('checkbox',{name:'全选本页',exact:true}).check();await expect(page.getByText('已选3篇',{exact:true})).toBeVisible();
    await page.getByRole('checkbox',{name:'选择 Retained article',exact:true}).uncheck();
    await page.getByRole('combobox',{name:'批量分类',exact:true}).selectOption('uncategorized');
    await page.getByRole('combobox',{name:'MCP 与工具调用',exact:true}).selectOption('remove');await page.getByRole('combobox',{name:'Skills 与扩展',exact:true}).selectOption('add');
    await page.getByRole('button',{name:'检查批量变更',exact:true}).click();
    const review=page.getByRole('region',{name:'确认批量整理',exact:true});await expect(review).toContainText('Article A');await expect(review).toContainText('Article B');await expect(review).not.toContainText('Retained article');
    await expect(review).toContainText('待分类');await expect(review).toContainText('Skills 与扩展');await expect(review).toContainText('MCP 与工具调用');assert.equal(writes.length,0);
    await page.getByRole('button',{name:'返回调整',exact:true}).click();await expect(page.getByRole('combobox',{name:'Skills 与扩展',exact:true})).toHaveValue('add');
    await page.getByRole('button',{name:'检查批量变更',exact:true}).click();await page.getByRole('button',{name:'确认整理2篇',exact:true}).click();
    await expect(page.getByRole('button',{name:'整理中…',exact:true})).toBeDisabled();await expect.poll(()=>writes.length).toBe(1);
    release!();await expect(page.getByRole('status').filter({hasText:'已整理2篇'})).toBeVisible();await expect(page.getByRole('checkbox',{name:'选择 Article A',exact:true})).toHaveCount(0);
    await expect(page.getByRole('checkbox',{name:'选择 Retained article',exact:true})).not.toBeChecked();
    assert.deepEqual(writes,[{articles:[{id:'a',expectedVersion:2},{id:'b',expectedVersion:0}],category:null,addTopicSlugs:['skills'],removeTopicSlugs:['mcp']}]);
    assert.equal(page.url(),web.origin+'/admin/reader?'+query);assert(queries.length>=2);assert.equal(queries.at(-1),'?'+query);
  }finally{release?.();await browser.close();await web?.stop();}
});

test('private bulk selection survives conflicts and clears on reload, filtering, paging and session expiry',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;let version=1;
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
      if(url.pathname==='/api/admin/reader/library')return {items:[{id:'same-id',title:'Selectable article',classificationVersion:version,source:'Source',withdrawn:false,state:{articleId:'same-id',starred:false,status:'to-read',version:0,updatedAt:null},matches:[]}],nextCursor:url.searchParams.has('cursor')?null:'next-page',filters:{sources:[],categories:[{id:'uncategorized',name:'待分类'}],topics:[{slug:'skills',name:'Skills 与扩展',definition:'Skills'}]}};
      if(url.pathname==='/api/admin/reader/classification'&&req.method==='PATCH'){version++;res.statusCode=409;return {detail:'分类已改变'};}
    }));
    const context=await browser.newContext({viewport:{width:320,height:700}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader');
    const pick=page.getByRole('checkbox',{name:'选择 Selectable article',exact:true}),action=page.getByRole('combobox',{name:'Skills 与扩展',exact:true});
    await pick.check();await action.selectOption('add');await page.getByRole('button',{name:'检查批量变更',exact:true}).click();await page.getByRole('button',{name:'确认整理1篇',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('整批未保存');await expect(pick).toBeChecked();
    await page.getByRole('button',{name:'返回调整',exact:true}).click();await expect(action).toHaveValue('add');
    await page.getByRole('button',{name:'重新载入列表并清除选择',exact:true}).click();await expect(pick).not.toBeChecked();
    await pick.check();await page.getByRole('link',{name:'更早的文章',exact:true}).click();await expect(page).toHaveURL(/cursor=next-page/);await expect(pick).not.toBeChecked();
    await pick.check();await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('changed');await page.getByRole('button',{name:'筛选',exact:true}).click();await expect(page).toHaveURL(/q=changed/);await expect(pick).not.toBeChecked();
    await pick.check();await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page).toHaveURL(/\/admin\/login/);await expect(pick).toHaveCount(0);await expect(page.getByRole('combobox',{name:'批量分类',exact:true})).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

test('private library previews selected favorites and reading state, submits state versions once and revalidates filters',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;const writes:unknown[]=[],queries:string[]=[];let applied=false,release:(()=>void)|undefined;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
      if(url.pathname==='/api/admin/reader/library'){
        queries.push(url.search);return {items:(applied?[['c','Remaining article',9,5]]:[['a','State article A',7,2],['b','State article B',8,0],['c','Remaining article',9,5]]).map(([id,title,classificationVersion,version])=>({id,title,classificationVersion,source:'Source',withdrawn:false,state:{articleId:id,starred:true,status:'reading',version,updatedAt:null},matches:[]})),nextCursor:null,filters:{sources:[{id:'source',name:'Source'}],categories:[{id:'agents',name:'智能体工程'}],topics:[{slug:'mcp',name:'MCP 与工具调用',definition:'Tools'}]}};
      }
      if(url.pathname==='/api/admin/reader/state'&&req.method==='PATCH'){
        assert.equal(req.headers['x-csrf-token'],'test-csrf');let body='';for await(const chunk of req)body+=chunk;writes.push(JSON.parse(body));await gate;applied=true;return {selected:2,changed:2};
      }
    }));
    const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();
    const query='q=memory&sourceId=source&category=agents&topic=mcp&starred=true&status=reading';await visit(page,web.origin+'/admin/reader?'+query);
    await page.getByRole('checkbox',{name:'全选本页',exact:true}).check();await page.getByRole('checkbox',{name:'选择 Remaining article',exact:true}).uncheck();
    await page.getByRole('radio',{name:'收藏与阅读状态',exact:true}).check();await page.getByRole('combobox',{name:'批量收藏',exact:true}).selectOption('false');await page.getByRole('combobox',{name:'批量阅读状态',exact:true}).selectOption('read');
    await page.getByRole('button',{name:'检查批量变更',exact:true}).click();const review=page.getByRole('region',{name:'确认批量整理',exact:true});
    await expect(review).toContainText('取消收藏');await expect(review).toContainText('已读');await expect(review).toContainText('State article A');await expect(review).toContainText('State article B');await expect(review).not.toContainText('Remaining article');assert.equal(writes.length,0);
    await page.getByRole('button',{name:'返回调整',exact:true}).click();await expect(page.getByRole('combobox',{name:'批量收藏',exact:true})).toHaveValue('false');await expect(page.getByRole('combobox',{name:'批量阅读状态',exact:true})).toHaveValue('read');
    await page.getByRole('button',{name:'检查批量变更',exact:true}).click();await page.getByRole('button',{name:'确认整理2篇',exact:true}).click();await expect(page.getByRole('button',{name:'整理中…',exact:true})).toBeDisabled();await expect.poll(()=>writes.length).toBe(1);
    release!();await expect(page.getByRole('status').filter({hasText:'已整理2篇'})).toBeVisible();await expect(page.getByRole('checkbox',{name:'选择 State article A',exact:true})).toHaveCount(0);await expect(page.getByRole('checkbox',{name:'选择 Remaining article',exact:true})).not.toBeChecked();
    assert.deepEqual(writes,[{articles:[{id:'a',expectedVersion:2},{id:'b',expectedVersion:0}],starred:false,status:'read'}]);assert.equal(page.url(),web.origin+'/admin/reader?'+query);assert(queries.length>=2);assert.equal(queries.at(-1),'?'+query);
  }finally{release?.();await browser.close();await web?.stop();}
});

test('private bulk state sends only the requested field and ignores inactive classification controls',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;const writes:unknown[]=[];let version=3;
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
      if(url.pathname==='/api/admin/reader/library')return {items:[{id:'single-state',title:'Single state',classificationVersion:19,source:'Source',withdrawn:false,state:{articleId:'single-state',starred:false,status:'reading',version,updatedAt:null},matches:[]}],nextCursor:null,filters:{sources:[],categories:[{id:'uncategorized',name:'待分类'}],topics:[{slug:'skills',name:'Skills 与扩展',definition:'Skills'}]}};
      if(url.pathname==='/api/admin/reader/state'&&req.method==='PATCH'){let body='';for await(const chunk of req)body+=chunk;writes.push(JSON.parse(body));version++;return {selected:1,changed:1};}
    }));
    const context=await browser.newContext();await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader');
    const cases=[{field:'批量收藏',value:'true',version:3,patch:{starred:true}},{field:'批量收藏',value:'false',version:4,patch:{starred:false}},{field:'批量阅读状态',value:'to-read',version:5,patch:{status:'to-read'}},{field:'批量阅读状态',value:'reading',version:6,patch:{status:'reading'}},{field:'批量阅读状态',value:'read',version:7,patch:{status:'read'}}];
    for(const item of cases){
      await page.getByRole('checkbox',{name:'选择 Single state',exact:true}).check();await page.getByRole('combobox',{name:'Skills 与扩展',exact:true}).selectOption('add');await page.getByRole('radio',{name:'收藏与阅读状态',exact:true}).check();
      await page.getByRole('button',{name:'检查批量变更',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();assert.equal(writes.length,item.version-3);
      await page.getByRole('combobox',{name:item.field,exact:true}).selectOption(item.value);await page.getByRole('button',{name:'检查批量变更',exact:true}).click();await expect(page.getByRole('region',{name:'确认批量整理',exact:true})).toContainText('保留');
      await page.getByRole('button',{name:'确认整理1篇',exact:true}).click();await expect(page.getByRole('checkbox',{name:'选择 Single state',exact:true})).not.toBeChecked();
      assert.deepEqual(writes.at(-1),{articles:[{id:'single-state',expectedVersion:item.version}],...item.patch});
    }
  }finally{await browser.close();await web?.stop();}
});

test('private bulk state preserves conflicting choices and clears them on reload, navigation and session expiry',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,expired=false,expireWrite=false;let version=2;const writes:unknown[]=[];
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(expired||!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
      if(url.pathname==='/api/admin/reader/library')return {items:[{id:'conflict-state',title:'Conflict state',classificationVersion:18,source:'Source',withdrawn:false,state:{articleId:'conflict-state',starred:true,status:'read',version,updatedAt:null},matches:[]}],nextCursor:url.searchParams.has('cursor')?null:'next-state',filters:{sources:[],categories:[{id:'uncategorized',name:'待分类'}],topics:[]}};
      if(url.pathname==='/api/admin/reader/state'&&req.method==='PATCH'){let body='';for await(const chunk of req)body+=chunk;writes.push(JSON.parse(body));version++;res.statusCode=expireWrite?401:409;expired=expireWrite;return {detail:'状态已改变'};}
    }));
    const context=await browser.newContext({viewport:{width:320,height:700}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader');
    const pick=page.getByRole('checkbox',{name:'选择 Conflict state',exact:true}),mode=page.getByRole('radio',{name:'收藏与阅读状态',exact:true});
    await pick.check();await mode.check();await page.getByRole('combobox',{name:'批量收藏',exact:true}).selectOption('false');await page.getByRole('combobox',{name:'批量阅读状态',exact:true}).selectOption('reading');await page.getByRole('button',{name:'检查批量变更',exact:true}).click();await page.getByRole('button',{name:'确认整理1篇',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('整批未保存');await expect(pick).toBeChecked();await page.getByRole('button',{name:'返回调整',exact:true}).click();await expect(mode).toBeChecked();await expect(page.getByRole('combobox',{name:'批量收藏',exact:true})).toHaveValue('false');await expect(page.getByRole('combobox',{name:'批量阅读状态',exact:true})).toHaveValue('reading');
    assert.deepEqual(writes,[{articles:[{id:'conflict-state',expectedVersion:2}],starred:false,status:'reading'}]);
    await page.getByRole('button',{name:'重新载入列表并清除选择',exact:true}).click();await expect(pick).not.toBeChecked();await expect(mode).toHaveCount(0);
    await pick.check();await mode.check();await page.getByRole('link',{name:'更早的文章',exact:true}).click();await expect(page).toHaveURL(/cursor=next-state/);await expect(pick).not.toBeChecked();
    await pick.check();await mode.check();await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('changed');await page.getByRole('button',{name:'筛选',exact:true}).click();await expect(page).toHaveURL(/q=changed/);await expect(pick).not.toBeChecked();
    await pick.check();await mode.check();await page.getByRole('combobox',{name:'批量阅读状态',exact:true}).selectOption('read');await page.getByRole('button',{name:'检查批量变更',exact:true}).click();expireWrite=true;await page.getByRole('button',{name:'确认整理1篇',exact:true}).click();
    await expect(page).toHaveURL(/\/admin\/login/);await expect(pick).toHaveCount(0);await expect(page.getByRole('combobox',{name:'批量阅读状态',exact:true})).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

test('saved views persist applied filters, open from page one and confirm rename, replacement and deletion',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,release:(()=>void)|undefined;const gate=new Promise<void>(resolve=>{release=resolve;});
  let views:SavedReaderView[]=[];const writes:Array<{method:string;body:unknown}>=[],queries:string[]=[];
  const filters={q:'memory',sourceId:'source',category:'agents',topic:'mcp',starred:'false' as const,status:'to-read' as const};
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/library'){queries.push(url.search);return {items:[{id:'view-article',title:'View article',source:'Source',withdrawn:false,classificationVersion:3,state:{articleId:'view-article',starred:false,status:'to-read',version:2,updatedAt:null},matches:[]}],nextCursor:null,filters:{sources:[{id:'source',name:'Source'}],categories:[{id:'agents',name:'智能体工程'}],topics:[{slug:'mcp',name:'MCP 与工具调用',definition:'Tools'}]}};}
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:views};
      if(url.pathname.startsWith('/api/admin/reader/views')&&req.method!=='GET'){
        assert.equal(req.headers['x-csrf-token'],'test-csrf');let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);writes.push({method:req.method!,body});
        if(req.method==='POST'){await gate;const value={id:'saved-view',name:body.name,filters:body.filters,version:1,createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z'};views=[value];return value;}
        assert.equal(body.expectedVersion,views[0]!.version);if(req.method==='DELETE'){views=[];return {deleted:true};}
        const value={...views[0]!,...(body.name?{name:body.name}:{}),...(body.filters?{filters:body.filters}:{}),version:views[0]!.version+1};views=[value];return value;
      }
      if(url.pathname==='/api/admin/reader/views/saved-view')return views[0];
    }));
    const context=await browser.newContext({viewport:{width:390,height:900}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader?'+new URLSearchParams({...filters,cursor:'old-page',limit:'7'}));
    const section=page.getByRole('region',{name:'常用视图',exact:true});await expect(section).toBeVisible();const add=section.getByRole('form',{name:'保存常用视图',exact:true});
    await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('unapplied draft');await add.getByRole('textbox',{name:'视图名称',exact:true}).fill('Memory view');await add.getByRole('button',{name:'保存当前条件为视图',exact:true}).click();await expect(add.getByRole('button',{name:'保存中…',exact:true})).toBeDisabled();await expect.poll(()=>writes.length).toBe(1);release!();
    let row=section.getByRole('region',{name:'视图：Memory view',exact:true});await expect(row).toBeVisible();assert.deepEqual(writes,[{method:'POST',body:{name:'Memory view',filters}}]);
    await page.getByRole('checkbox',{name:'选择 View article',exact:true}).check();await row.getByRole('link',{name:'打开视图：Memory view',exact:true}).click();await expect(page).not.toHaveURL(/cursor=|limit=/);assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams),filters);await expect(page.getByRole('checkbox',{name:'选择 View article',exact:true})).not.toBeChecked();
    await add.getByRole('textbox',{name:'视图名称',exact:true}).fill('Other unsaved draft');await row.getByText('管理视图',{exact:true}).click();await row.getByRole('textbox',{name:'视图名称',exact:true}).fill('Renamed view');await row.getByRole('button',{name:'保存名称',exact:true}).click();row=section.getByRole('region',{name:'视图：Renamed view',exact:true});await expect(row).toBeVisible();await expect(add.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Other unsaved draft');
    await page.getByRole('searchbox',{name:'关键词',exact:true}).fill('updated');await page.getByRole('button',{name:'筛选',exact:true}).click();await expect(page).toHaveURL(/q=updated/);
    await row.getByRole('button',{name:'用当前条件更新',exact:true}).click();const update=row.getByRole('region',{name:'确认更新视图条件',exact:true});await expect(update).toContainText('memory');await expect(update).toContainText('updated');assert.equal(writes.length,2);await update.getByRole('button',{name:'取消更新',exact:true}).click();assert.equal(writes.length,2);
    await row.getByRole('button',{name:'用当前条件更新',exact:true}).click();await update.getByRole('button',{name:'确认更新条件',exact:true}).click();await expect(row.getByRole('status')).toContainText('条件已更新');
    await row.getByRole('button',{name:'删除视图',exact:true}).click();const remove=row.getByRole('region',{name:'确认删除视图',exact:true});await expect(remove).toContainText('保留');assert.equal(writes.length,3);await remove.getByRole('button',{name:'取消删除',exact:true}).click();assert.equal(writes.length,3);
    await row.getByRole('button',{name:'删除视图',exact:true}).click();await remove.getByRole('button',{name:'确认删除',exact:true}).click();await expect(row).toHaveCount(0);await expect(page.getByRole('link',{name:'View article',exact:true})).toBeVisible();await expect(add.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Other unsaved draft');
    assert.deepEqual(writes,[{method:'POST',body:{name:'Memory view',filters}},{method:'PATCH',body:{expectedVersion:1,name:'Renamed view'}},{method:'PATCH',body:{expectedVersion:2,filters:{...filters,q:'updated'}}},{method:'DELETE',body:{expectedVersion:3}}]);assert(queries.some(query=>!query.includes('cursor=')&&query.includes('q=memory')));
  }finally{release?.();await browser.close();await web?.stop();}
});

test('saved views isolate list failures and retain conflicting and unrelated drafts until explicit reload or expiry',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,failList=true,expired=false;let current:SavedReaderView={id:'conflict-view',name:'Initial view',filters:{q:'private-query-marker'},version:1,createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z'};
  const writes:unknown[]=[];
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(expired||!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/library')return {items:[{id:'available',title:'Article stays available',source:'Source',withdrawn:false,classificationVersion:0,state:{articleId:'available',starred:false,status:'to-read',version:0,updatedAt:null},matches:[]}],nextCursor:null,filters:{sources:[],categories:[],topics:[]}};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET'){if(failList){res.statusCode=503;return {detail:'Unavailable'};}return {items:[current]};}
      if(url.pathname==='/api/admin/reader/views/conflict-view'&&req.method==='GET')return current;
      if(url.pathname.startsWith('/api/admin/reader/views')&&req.method!=='GET'){let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);writes.push(body);if(req.method==='POST'){res.statusCode=409;return {detail:'名称已存在'};}if(body.expectedVersion!==current.version){res.statusCode=409;return {detail:'视图已改变'};}expired=true;res.statusCode=401;return {};}
    }));
    const context=await browser.newContext();await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader');const section=page.getByRole('region',{name:'常用视图',exact:true});await expect(section).toBeVisible();await expect(section.getByRole('alert')).toContainText('视图列表');await expect(page.getByRole('link',{name:'Article stays available',exact:true})).toBeVisible();
    const add=section.getByRole('form',{name:'保存常用视图',exact:true});await add.getByRole('textbox',{name:'视图名称',exact:true}).fill('Retained new draft');await add.getByRole('button',{name:'保存当前条件为视图',exact:true}).click();await expect(add.getByRole('alert')).toContainText('名称已存在');await expect(add.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Retained new draft');
    failList=false;await section.getByRole('button',{name:'刷新视图列表',exact:true}).click();let row=section.getByRole('region',{name:'视图：Initial view',exact:true});await row.getByText('管理视图',{exact:true}).click();await row.getByRole('textbox',{name:'视图名称',exact:true}).fill('Conflicting rename');
    failList=true;await section.getByRole('button',{name:'刷新视图列表',exact:true}).click();await expect(row.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Conflicting rename');await expect(add.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Retained new draft');
    current={...current,name:'Remote name',version:2};failList=false;await section.getByRole('button',{name:'刷新视图列表',exact:true}).click();row=section.getByRole('region',{name:'视图：Remote name',exact:true});await row.getByRole('button',{name:'保存名称',exact:true}).click();await expect(row.getByRole('alert')).toContainText('视图已改变');await expect(row.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Conflicting rename');assert.deepEqual(writes[1],{expectedVersion:1,name:'Conflicting rename'});
    await row.getByRole('button',{name:'载入已保存版本',exact:true}).click();await expect(row.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Remote name');await expect(add.getByRole('textbox',{name:'视图名称',exact:true})).toHaveValue('Retained new draft');
    await row.getByRole('textbox',{name:'视图名称',exact:true}).fill('Expire rename');await row.getByRole('button',{name:'保存名称',exact:true}).click();await expect(page).toHaveURL(/\/admin\/login/);await expect(section).toHaveCount(0);await expect(page.getByText('private-query-marker')).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});

test('saved views explain missing references and require explicit condition replacement before opening',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;let view:SavedReaderView={id:'missing-source',name:'Old source view',filters:{sourceId:'removed-source'},version:1,createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z'};
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/library')return {items:[],nextCursor:null,filters:{sources:[],categories:[],topics:[]}};
      if(url.pathname==='/api/admin/reader/views')return {items:[view]};
      if(url.pathname==='/api/admin/reader/views/missing-source'&&req.method==='PATCH'){let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);assert.deepEqual(body,{expectedVersion:1,filters:{}});view={...view,filters:{},version:2};return view;}
    }));
    const context=await browser.newContext({viewport:{width:320,height:800}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader?cursor=old-page&limit=7');const section=page.getByRole('region',{name:'常用视图',exact:true});await expect(section).toBeVisible();const row=section.getByRole('region',{name:'视图：Old source view',exact:true});await expect(row).toContainText('来源已不存在');await expect(row.getByRole('link',{name:'打开视图：Old source view',exact:true})).toHaveCount(0);
    await row.getByText('管理视图',{exact:true}).click();await row.getByRole('button',{name:'用当前条件更新',exact:true}).click();await expect(row.getByRole('region',{name:'确认更新视图条件',exact:true})).toContainText('全部文章');await row.getByRole('button',{name:'确认更新条件',exact:true}).click();await row.getByRole('link',{name:'打开视图：Old source view',exact:true}).click();await expect(page).toHaveURL(web.origin+'/admin/reader');
  }finally{await browser.close();await web?.stop();}
});

test('saved views honor a late list 401 even after a successful in-flight creation',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,release:(()=>void)|undefined,expired=false;let reads=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(expired||!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/library')return {items:[],nextCursor:null,filters:{sources:[],categories:[],topics:[]}};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET'){reads++;if(reads===1)return {items:[]};await gate;expired=true;res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/reader/views'&&req.method==='POST')return {id:'late-private',name:'Private late view',filters:{q:'private-late-query'},version:1,createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z'};
    }));
    const context=await browser.newContext();await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader');const section=page.getByRole('region',{name:'常用视图',exact:true});await expect(section.getByRole('button',{name:'刷新视图列表',exact:true})).toBeEnabled();
    await section.getByRole('button',{name:'刷新视图列表',exact:true}).click();await expect.poll(()=>reads).toBe(2);const add=section.getByRole('form',{name:'保存常用视图',exact:true});await add.getByRole('textbox',{name:'视图名称',exact:true}).fill('Private late view');await add.getByRole('button',{name:'保存当前条件为视图',exact:true}).click();await expect(section.getByRole('link',{name:'打开视图：Private late view',exact:true})).toBeVisible();
    release!();await expect(page).toHaveURL(/\/admin\/login/);await expect(section).toHaveCount(0);await expect(page.getByText('private-late-query')).toHaveCount(0);
  }finally{release?.();await browser.close();await web?.stop();}
});

test('saved views merge a delayed initial directory with completed creates, edits and deletes',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined,release:(()=>void)|undefined,releaseRefresh:(()=>void)|undefined,reads=0;const gate=new Promise<void>(resolve=>{release=resolve;}),refreshGate=new Promise<void>(resolve=>{releaseRefresh=resolve;});
  const old:SavedReaderView={id:'preexisting',name:'Preexisting view',filters:{},version:1,createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z'};
  const stale:SavedReaderView={...old,id:'created',name:'Edited new copy',version:2},writes:string[]=[];
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/library')return {items:[],nextCursor:null,filters:{sources:[],categories:[],topics:[]}};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET'){reads++;if(reads===1){await gate;return {items:[old]};}await refreshGate;return {items:[old,stale]};}
      if(url.pathname.startsWith('/api/admin/reader/views')&&req.method!=='GET'){writes.push(req.method!);if(req.method==='DELETE')return {deleted:true};let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);return {...stale,name:body.name,version:req.method==='POST'?1:body.expectedVersion+1};}
    }));
    const context=await browser.newContext();await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader');const section=page.getByRole('region',{name:'常用视图',exact:true});await expect(section).toBeVisible();const add=section.getByRole('form',{name:'保存常用视图',exact:true});await add.getByRole('textbox',{name:'视图名称',exact:true}).fill('New copy');await add.getByRole('button',{name:'保存当前条件为视图',exact:true}).click();let row=section.getByRole('region',{name:'视图：New copy',exact:true});await expect(row).toBeVisible();await row.getByText('管理视图',{exact:true}).click();await row.getByRole('textbox',{name:'视图名称',exact:true}).fill('Edited new copy');await row.getByRole('button',{name:'保存名称',exact:true}).click();row=section.getByRole('region',{name:'视图：Edited new copy',exact:true});await expect(row).toBeVisible();
    release!();const existing=section.getByRole('region',{name:'视图：Preexisting view',exact:true});await expect(existing).toBeVisible();await expect(row).toBeVisible();
    await section.getByRole('button',{name:'刷新视图列表',exact:true}).click();await expect.poll(()=>reads).toBe(2);await existing.getByText('管理视图',{exact:true}).click();await existing.getByRole('button',{name:'删除视图',exact:true}).click();await existing.getByRole('button',{name:'确认删除',exact:true}).click();await expect(existing).toHaveCount(0);
    await row.getByRole('textbox',{name:'视图名称',exact:true}).fill('Latest edited copy');await row.getByRole('button',{name:'保存名称',exact:true}).click();row=section.getByRole('region',{name:'视图：Latest edited copy',exact:true});await expect(row).toBeVisible();releaseRefresh!();await expect(section.getByRole('button',{name:'刷新视图列表',exact:true})).toBeEnabled();await expect(existing).toHaveCount(0);await expect(row).toBeVisible();assert.deepEqual(writes,['POST','PATCH','DELETE','PATCH']);
  }finally{release?.();releaseRefresh?.();await browser.close();await web?.stop();}
});

test('topic management creates and renames topics and updates library, article and bulk choices',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  let topics=[{slug:'mcp',name:'MCP 与工具调用',definition:'Existing tools topic',version:1,articleCount:2}];
  const writes:Array<{method:string;body:unknown}>=[];
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(url.pathname==='/api/site/categories')return {items:[{id:'uncategorized',name:'待分类'}]};
      if(url.pathname==='/api/site/topics')return {topics};
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname.startsWith('/api/admin/reader/topics')){
        if(req.method==='GET')return {items:topics};
        assert.equal(req.headers['x-csrf-token'],'test-csrf');let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);writes.push({method:req.method!,body});
        if(req.method==='POST'){const topic={slug:'topic-new',name:body.name,definition:body.definition,version:1,articleCount:0};topics=[...topics,topic];return topic;}
        const topic=topics.find(t=>t.slug===url.pathname.split('/').at(-1))!;Object.assign(topic,{name:body.name,definition:body.definition,version:topic.version+1});return topic;
      }
      const state={articleId:'topic-book',starred:false,status:'to-read',version:0,updatedAt:null};
      if(url.pathname==='/api/admin/reader/views'&&req.method==='GET')return {items:[]};
      if(url.pathname==='/api/admin/reader/library')return {items:[{id:'topic-book',title:'Topic article',source:'Source',withdrawn:false,classificationVersion:0,state,matches:[]}],nextCursor:null,filters:{sources:[],categories:[{id:'uncategorized',name:'待分类'}],topics}};
      if(url.pathname.endsWith('/snapshots'))return {items:[]};
      if(url.pathname==='/api/admin/reader/articles/topic-book')return {article:{id:'topic-book',title:'Topic article',classificationVersion:0,category:null,topicSlugs:['mcp']},state,note:{articleId:'topic-book',text:'',version:0,updatedAt:null},currentSnapshot:null};
    }));
    const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();
    const response=await page.goto(web.origin+'/admin/reader/topics');assert.equal(response!.status(),200);await visit(page,page.url());await expect(page.getByRole('heading',{name:'主题管理',exact:true})).toBeVisible();
    const add=page.getByRole('form',{name:'新增主题',exact:true});await add.getByRole('textbox',{name:'主题名称',exact:true}).fill('模型压缩');await add.getByRole('textbox',{name:'主题说明',exact:true}).fill('压缩与量化 <img src=x>');await add.getByRole('button',{name:'新增主题',exact:true}).click();
    await expect(page.getByRole('region',{name:'模型压缩',exact:true})).toContainText('0篇');assert.equal(await page.locator('img[src="x"]').count(),0);
    const existing=page.getByRole('region',{name:'MCP 与工具调用',exact:true});await existing.getByText('编辑主题',{exact:true}).click();
    await existing.getByRole('textbox',{name:'主题名称',exact:true}).fill('工具与协议');await existing.getByRole('textbox',{name:'主题说明',exact:true}).fill('Revised tools description');await existing.getByRole('button',{name:'保存主题',exact:true}).click();
    const updated=page.getByRole('region',{name:'工具与协议',exact:true});await expect(updated).toContainText('Revised tools description');await updated.getByRole('link',{name:'查看2篇文章',exact:true}).click();await expect(page).toHaveURL(/topic=mcp/);
    await expect(page.getByRole('combobox',{name:'主题',exact:true})).toHaveValue('mcp');await expect(page.getByRole('combobox',{name:'主题',exact:true}).getByRole('option',{name:'模型压缩',exact:true})).toHaveCount(1);
    await page.getByRole('checkbox',{name:'选择 Topic article',exact:true}).check();await page.getByRole('combobox',{name:'模型压缩',exact:true}).selectOption('add');
    await page.getByRole('link',{name:'Topic article',exact:true}).click();await expect(page.getByRole('checkbox',{name:'工具与协议',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'模型压缩',exact:true})).not.toBeChecked();
    await page.getByRole('link',{name:'新增或编辑主题',exact:true}).click();await expect(page.getByRole('heading',{name:'主题管理',exact:true})).toBeVisible();
    assert.deepEqual(writes,[{method:'POST',body:{name:'模型压缩',definition:'压缩与量化 <img src=x>'}},{method:'PATCH',body:{name:'工具与协议',definition:'Revised tools description',expectedVersion:1}}]);
  }finally{await browser.close();await web?.stop();}
});

test('topic management keeps conflicting drafts, explicitly reloads versions and clears private controls on expiry',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  let topic={slug:'stable-topic',name:'Existing topic',definition:'Saved description',version:1,articleCount:3},conflict=true;
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/topics'&&req.method==='GET')return {items:[topic]};
      if(req.method==='PATCH'){let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);if(conflict){topic={...topic,definition:'Other window saved',version:2};res.statusCode=409;return {detail:'主题已改变'};}assert.equal(body.expectedVersion,2);topic={...topic,...body,version:3};return topic;}
    }));
    const context=await browser.newContext({viewport:{width:320,height:700}});await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();const response=await page.goto(web.origin+'/admin/reader/topics');assert.equal(response!.status(),200);await visit(page,page.url());
    const add=page.getByRole('form',{name:'新增主题',exact:true});await add.getByRole('textbox',{name:'主题名称',exact:true}).fill('Keep new draft');await add.getByRole('textbox',{name:'主题说明',exact:true}).fill('Keep new description');
    const editor=page.getByRole('region',{name:'Existing topic',exact:true});await editor.getByText('编辑主题',{exact:true}).click();await editor.getByRole('textbox',{name:'主题说明',exact:true}).fill('Unsaved conflicting description');await editor.getByRole('button',{name:'保存主题',exact:true}).click();
    await expect(editor.getByRole('alert')).toContainText('输入已保留');await expect(editor.getByRole('textbox',{name:'主题说明',exact:true})).toHaveValue('Unsaved conflicting description');
    await editor.getByRole('button',{name:'载入已保存版本',exact:true}).click();await expect(editor.getByRole('textbox',{name:'主题说明',exact:true})).toHaveValue('Other window saved');await expect(add.getByRole('textbox',{name:'主题名称',exact:true})).toHaveValue('Keep new draft');
    conflict=false;await editor.getByRole('textbox',{name:'主题说明',exact:true}).fill('Final description');await editor.getByRole('button',{name:'保存主题',exact:true}).click();await expect(editor.getByRole('status')).toContainText('已保存');await expect(add.getByRole('textbox',{name:'主题说明',exact:true})).toHaveValue('Keep new description');
    await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page).toHaveURL(/\/admin\/login/);await expect(page.getByRole('textbox',{name:'主题说明',exact:true})).toHaveCount(0);assert(!(await page.content()).includes('Keep new draft'));
  }finally{await browser.close();await web?.stop();}
});

test('topic refresh failure after a successful save preserves every draft and can be retried without saving twice',async()=>{
  const browser=await chromium.launch();let web:WebServer|undefined;
  let topics=[{slug:'first',name:'First topic',definition:'First saved',version:1,articleCount:1},{slug:'second',name:'Second topic',definition:'Second saved',version:1,articleCount:0}],failNext=false,failures=0;
  const writes:string[]=[];
  try{
    web=await startWebServer(fakeApi(async(url,res,req)=>{
      if(!url.pathname.startsWith('/api/admin/'))return;
      if(!req.headers.cookie?.includes('testowner=1')){res.statusCode=401;return {};}
      if(url.pathname==='/api/admin/me')return {name:'Owner',csrf:'test-csrf'};
      if(url.pathname==='/api/admin/reader/topics'&&req.method==='GET'){
        if(failNext){failNext=false;failures++;res.statusCode=503;return {detail:'Directory temporarily unavailable'};}return {items:topics};
      }
      if(req.method==='PATCH'||req.method==='POST'){
        let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);writes.push(req.method);failNext=true;
        if(req.method==='POST'){const topic={slug:'created',name:body.name,definition:body.definition,version:1,articleCount:0};topics=[...topics,topic];return topic;}
        const topic=topics.find(t=>t.slug==='first')!;Object.assign(topic,{definition:body.definition,version:2});return topic;
      }
    }));
    const context=await browser.newContext();await context.addCookies([{name:'testowner',value:'1',url:web.origin}]);const page=await context.newPage();await visit(page,web.origin+'/admin/reader/topics');
    const add=page.getByRole('form',{name:'新增主题',exact:true}),first=page.getByRole('region',{name:'First topic',exact:true}),second=page.getByRole('region',{name:'Second topic',exact:true});
    await add.getByRole('textbox',{name:'主题名称',exact:true}).fill('New topic draft');await add.getByRole('textbox',{name:'主题说明',exact:true}).fill('New description draft');
    await second.getByText('编辑主题',{exact:true}).click();await second.getByRole('textbox',{name:'主题说明',exact:true}).fill('Other row unsaved draft');
    await first.getByText('编辑主题',{exact:true}).click();await first.getByRole('textbox',{name:'主题说明',exact:true}).fill('Successfully saved description');await first.getByRole('button',{name:'保存主题',exact:true}).click();await expect.poll(()=>failures).toBe(1);
    await expect(page.getByRole('button',{name:'重试刷新主题列表',exact:true})).toBeVisible();await expect(add.getByRole('textbox',{name:'主题名称',exact:true})).toHaveValue('New topic draft');await expect(add.getByRole('textbox',{name:'主题说明',exact:true})).toHaveValue('New description draft');await expect(second.getByRole('textbox',{name:'主题说明',exact:true})).toHaveValue('Other row unsaved draft');await expect(first.getByRole('status')).toContainText('已保存');
    await page.getByRole('button',{name:'重试刷新主题列表',exact:true}).click();await expect(first.getByRole('paragraph').filter({hasText:'Successfully saved description'})).toBeVisible();await expect(second.getByRole('textbox',{name:'主题说明',exact:true})).toHaveValue('Other row unsaved draft');assert.deepEqual(writes,['PATCH']);
    await add.getByRole('button',{name:'新增主题',exact:true}).click();await expect.poll(()=>failures).toBe(2);await expect(page.getByRole('button',{name:'重试刷新主题列表',exact:true})).toBeVisible();await expect(second.getByRole('textbox',{name:'主题说明',exact:true})).toHaveValue('Other row unsaved draft');
    await page.getByRole('button',{name:'重试刷新主题列表',exact:true}).click();await expect(page.getByRole('region',{name:'New topic draft',exact:true})).toBeVisible();assert.deepEqual(writes,['PATCH','POST']);
    await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page).toHaveURL(/\/admin\/login/);await expect(second).toHaveCount(0);
  }finally{await browser.close();await web?.stop();}
});
