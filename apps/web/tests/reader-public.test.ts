import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { fakeApi, feedItem, itemDetail, readerPage, startWebServer, visit, type WebServer } from "./web-server.ts";

for(const engine of [chromium,webkit])test(`numbered pagination counts, jumps and switches page size without losing filters (${engine.name()})`,async()=>{
  const browser=await engine.launch();let web:WebServer|undefined;
  const articles=Array.from({length:137},(_,i)=>feedItem({id:'paged-'+i,title:'Paged article '+i}));
  try{
    web=await startWebServer(fakeApi(url=>{
      if(url.pathname==='/api/site/articles')return readerPage(url.searchParams.get('q')==='missing'?[]:articles,url);
      if(url.pathname==='/api/site/engagement')return {items:(url.searchParams.get('ids')??'').split(',').map(id=>({id,views:0,likes:0,liked:false}))};
      if(url.pathname==='/api/site/categories')return {items:[{id:'coding',name:'AI 编程'}]};
      if(url.pathname==='/api/site/sources')return {items:[{id:'source',name:'Source',url:null,description:null,articles:137,fulltext:false,latestAt:null}]};
      if(url.pathname==='/api/site/topics')return {topics:[{slug:'mcp',name:'MCP',group:'field',definition:'',brand:null,total:137,recent:1,indexable:true,latest:null}]};
    }));
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const filters='q=tools&category=coding&topic=mcp&sourceId=source&from=2026-10-01&to=2026-10-28';
    await visit(page,web.origin+'/?'+filters);
    await expect(page.getByRole('status',{name:'文章分页信息'})).toContainText('共 137 篇');
    await expect(page.locator('main ol article')).toHaveCount(25);
    const nav=page.getByRole('navigation',{name:'文章分页',exact:true});
    await nav.getByRole('link',{name:'第 3 页',exact:true}).click();
    await expect(page).toHaveURL(/page=3/);await expect(page.getByRole('link',{name:'Paged article 50',exact:true})).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveText('3');await expect(page).toHaveTitle(/第 3 页/);
    for(const [key,value] of new URLSearchParams(filters))assert.equal(new URL(page.url()).searchParams.get(key),value);
    await page.getByRole('spinbutton',{name:'跳转页码',exact:true}).fill('6');await page.getByRole('button',{name:'跳转',exact:true}).click();
    await expect(page).toHaveURL(/page=6/);await expect(page.locator('main ol article')).toHaveCount(12);
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
    for(const width of [320,390]){
      await page.setViewportSize({width,height:800});await nav.scrollIntoViewIfNeeded();
      await expect(nav.getByRole('link',{name:'下一页',exact:true})).toBeVisible();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    await visit(page,web.origin+'/?'+filters+'&page=999&limit=50');
    await expect(page).toHaveURL(/page=3&limit=50/);await expect(page.locator('main ol article')).toHaveCount(37);
    await visit(page,web.origin+'/?q=missing&page=999&limit=100');
    await expect(page).toHaveURL(web.origin+'/?q=missing&limit=100');
    await expect(page.getByRole('status',{name:'文章分页信息'})).toContainText('共 0 篇');await expect(nav).toHaveCount(0);
    const plain=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:844}});
    await plain.goto(web.origin+'/?'+filters);
    await plain.getByRole('combobox',{name:'每页篇数',exact:true}).selectOption('50');await plain.getByRole('button',{name:'应用数量',exact:true}).click();
    await expect(plain).toHaveURL(/limit=50/);await expect(plain.locator('main ol article')).toHaveCount(50);
    await plain.getByRole('spinbutton',{name:'跳转页码',exact:true}).fill('3');await plain.getByRole('button',{name:'跳转',exact:true}).click();
    await expect(plain).toHaveURL(/page=3/);await expect(plain.getByRole('link',{name:'Paged article 100',exact:true})).toBeVisible();
    for(const [key,value] of new URLSearchParams(filters))assert.equal(new URL(plain.url()).searchParams.get(key),value);
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
    const from=await page.getByLabel('起始日期',{exact:true}).inputValue(),to=await page.getByLabel('结束日期',{exact:true}).inputValue();assert.equal((Date.parse(to)-Date.parse(from))/86400000,6);
    await expect(page.getByRole('button',{name:'近7天',exact:true})).toHaveAttribute('aria-pressed','true');
    await toInput.fill('2026-10-');await expect(page.getByRole('button',{name:'近7天',exact:true})).toHaveAttribute('aria-pressed','false');
    await expect(page.getByRole('alert')).toHaveCount(0);await toInput.press('Tab');await expect(page.getByRole('alert')).toContainText('完整日期');await expect(apply).toBeDisabled();
    await page.keyboard.press('Escape');await expect(page.locator('summary').filter({hasText:'2026-10-03'})).toBeFocused();
    await page.locator('summary').filter({hasText:'2026-10-03'}).click();await page.getByRole('button',{name:'2026年10月3日',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button',{name:'2026年10月4日',exact:true})).toBeFocused();await page.keyboard.press('PageUp');await expect(page.getByRole('button',{name:'2026年9月4日',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');await page.setViewportSize({width:320,height:700});await page.locator('summary').filter({hasText:'2026-10-03'}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await expect(page.getByRole('button',{name:'应用日期',exact:true})).toBeVisible();
    await fromInput.fill('2026-02-30');await page.getByRole('button',{name:'2026年10月5日',exact:true}).click();
    await expect(fromInput).toHaveValue('2026-10-05');await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('summary').filter({hasText:'2026-10-03'})).toBeFocused();
  }finally{await browser.close();await web?.stop();}
});

for(const engine of [chromium,webkit])test(`date calendar edits the active endpoint, previews without saving and clears only on apply (${engine.name()})`,async()=>{
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
    const current=page.locator('summary').filter({hasText:'2026-10-03'});await current.click();await all.click();await expect(from).toHaveValue('');await expect(to).toHaveValue('');
    await expect(page).toHaveURL(/from=2026-10-03/);await page.getByRole('button',{name:'取消',exact:true}).click();await current.click();await expect(to).toHaveValue('2026-10-03');
    await all.click();await page.getByRole('button',{name:'2026年10月5日',exact:true}).click();await expect(apply).toBeEnabled();await apply.click();
    await expect(page).toHaveURL(/from=2026-10-05/);
    assert.equal(new URL(page.url()).searchParams.get('from'),'2026-10-05');assert(!new URL(page.url()).searchParams.has('to'));
    await page.locator('summary').filter({hasText:'2026-10-05'}).click();await all.click();await to.click();await page.getByRole('button',{name:'2026年10月8日',exact:true}).click();await apply.click();
    await expect(page).toHaveURL(/to=2026-10-08/);
    assert.equal(new URL(page.url()).searchParams.get('to'),'2026-10-08');assert(!new URL(page.url()).searchParams.has('from'));
    await page.locator('summary').filter({hasText:'2026-10-08'}).click();await all.click();await apply.click();await expect(page).toHaveURL(web.origin+'/?q=tools');
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
    failLike=false;await page.getByRole('button',{name:'取消点赞',exact:true}).click();await expect(page.getByRole('button',{name:'点赞',exact:true})).toHaveText('0');
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
    await toc.getByRole('button',{name:'展开：First chapter',exact:true}).click();await toc.getByRole('button',{name:'展开：First detail',exact:true}).click();
    await toc.getByRole('link',{name:'Nested detail',exact:true}).click();await expect(toc.getByRole('link',{name:'Nested detail',exact:true})).toHaveAttribute('aria-current','location');await expect(page.getByRole('heading',{name:'Nested detail',exact:true})).toBeFocused();
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
    await page.getByLabel('阅读显示设置',{exact:true}).click();await page.getByRole('combobox',{name:'正文字号',exact:true}).selectOption('larger');await expect.poll(sectionRatio).toBeCloseTo(.35,1);await page.keyboard.press('Escape');
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
  const article={...itemDetail({id:'translation-ui',title:'A translated article',summary:'An original summary.',bodyHtml:'<h2 id="sec-1">Original heading</h2><p>Original words.</p>',outline:[{id:'sec-1',text:'Original heading',level:2}]}),metadataTranslation:{title:'翻译后的文章标题',summary:'已经翻译的文章摘要。'},translation:{bodyHtml:'<h2 id="sec-1">中文标题</h2><p>已经保存的中文译文。</p>',outline:[{id:'sec-1',text:'中文标题',level:2}],complete:false}};
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
  const article=itemDetail({id:'display-ui',title:'Reading display',bodyHtml:'<h2 id="sec-1">A saved section</h2>'+Array.from({length:8},()=>'<p>'+('Readable article content. '.repeat(30))+'</p>').join(''),outline:[{id:'sec-1',text:'A saved section',level:2}]});
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
    const font=()=>body.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),height=()=>body.evaluate(el=>parseFloat(getComputedStyle(el).lineHeight)),width=()=>body.evaluate(el=>el.getBoundingClientRect().width);
    await page.getByLabel('阅读显示设置',{exact:true}).click();await page.getByRole('combobox',{name:'正文字号',exact:true}).selectOption('large');await page.getByRole('combobox',{name:'正文行距',exact:true}).selectOption('loose');await page.getByRole('combobox',{name:'正文宽度',exact:true}).selectOption('narrow');await expect.poll(font).toBe(20);await expect.poll(height).toBe(40);assert(await width()<=641);const narrow=await width();
    const second=await context.newPage();await visit(second,web.origin+'/items/display-ui');assert.equal(await second.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),20);await second.getByLabel('阅读显示设置',{exact:true}).click();await second.getByRole('combobox',{name:'正文字号',exact:true}).selectOption('larger');await second.getByRole('combobox',{name:'正文宽度',exact:true}).selectOption('wide');await expect.poll(font).toBe(22);await expect.poll(width).toBeGreaterThan(narrow+100);
    await visit(page,page.url());await expect.poll(font).toBe(22);await expect.poll(height).toBe(44);await page.getByLabel('阅读显示设置',{exact:true}).click();await expect(page.getByRole('combobox',{name:'正文宽度',exact:true})).toHaveValue('wide');
    for(const size of [320,390,1440]){await page.setViewportSize({width:size,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.getByRole('button',{name:'恢复默认显示',exact:true}).click();await expect(page.getByRole('combobox',{name:'正文字号',exact:true})).toHaveValue('default');await expect.poll(()=>second.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(18);assert.equal(writes,0);
    await page.evaluate(()=>localStorage.setItem('agi-dawn-reading-display-v1','{"size":"enormous","spacing":"loose","width":"wide"}'));await visit(page,page.url());await expect.poll(font).toBe(18);await expect.poll(height).toBe(36);
    await page.evaluate(()=>localStorage.setItem('agi-dawn-reading-display-v1','{'));await visit(page,page.url());await expect.poll(height).toBeCloseTo(32.4,1);assert.equal(writes,0);
    const denied=await browser.newContext({viewport:{width:390,height:800}});await denied.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});});const blocked=await denied.newPage();await visit(blocked,web.origin+'/items/display-ui');await blocked.getByLabel('阅读显示设置',{exact:true}).click();await blocked.getByRole('combobox',{name:'正文字号',exact:true}).selectOption('large');await expect.poll(()=>blocked.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(20);await expect(blocked.getByRole('status').filter({hasText:'当前标签页'})).toBeVisible();await visit(blocked,blocked.url());assert.equal(await blocked.locator('article .prose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),17);await denied.close();
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
  const articles=['figure-a','figure-b','figure-mixed'].map(id=>itemDetail({id,title:id,bodyState:{status:'partial',bodyRevision:1,refreshPending:false,issues:id==='figure-mixed'?[...issues,{kind:'missing-formula',message:'部分公式保留为源文本，请对照原文。'}]:issues}}));
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
    await visit(page,web.origin+'/items/figure-a');await expect(notice).toBeVisible();await expect(page.getByText('正文有缺失，请对照原文。',{exact:true})).toHaveCount(0);await expect(details).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('agi-dawn-figure-notices-v1:figure-a'))).toBe(null);
    await notice.hover();for(const issue of issues)await expect(details).toContainText(issue.message);await details.hover();await expect(details).toBeVisible();await page.keyboard.press('Escape');await expect(details).toHaveCount(0);
    await page.getByRole('heading',{name:'figure-a',exact:true}).click();await notice.focus();await expect(details).toContainText(issues[0]!.message);await page.keyboard.press('Escape');await expect(details).toHaveCount(0);
    await trigger.focus();await trigger.press('ArrowDown');await expect(menu.getByRole('menuitem',{name:'本次关闭直到下次访问',exact:true})).toBeFocused();await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'永久禁用',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();
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
    await expect(page.locator('main article').first().getByLabel('收藏暂未开放')).toHaveText('—');
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
    await page.getByRole('link',{name:'空主题',exact:true}).click();await expect(page.getByText('没有符合条件的文章。可以调整筛选，或稍后查看更新。',{exact:true})).toBeVisible();
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
