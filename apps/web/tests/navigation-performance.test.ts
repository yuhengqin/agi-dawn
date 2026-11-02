// Reader enhancements wait for visible code and update only the picture that loaded.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { expect, type Browser } from "@playwright/test";
import { webkit } from "./browser.ts";
import { fakeApi, itemDetail, startWebServer, visit, type WebServer } from "./web-server.ts";

const codeSource='import json\n\nwith open("data.json") as file:\n    data = json.load(file)\n\nfor record in data:\n    print(record["title"])\n';
const readerBody=Array.from({length:30},(_,i)=>`<p>阅读段落 ${i}：先阅读文章，再查看后面的代码和图片。正文保持可读，图片和代码在需要时增强。</p>`).join('')
  +`<pre><code>${codeSource}</code></pre><pre data-language="shell"><code>x = 1</code></pre>`
  +`<pre data-code-kind="prompt"><code>/claude-api onboard</code></pre><pre data-language="text"><code>${codeSource}</code></pre>`
  +Array.from({length:12},(_,i)=>`<img src="/reader-image/${i}.svg" alt="正文配图 ${i}" width="640" height="360" loading="lazy">`).join('')
  +'<img src="/reader-image/tiny.svg" alt="小图标" width="16" height="16" loading="lazy"><a href="https://example.org"><img src="/reader-image/linked.svg" alt="链接图片" width="640" height="360" loading="lazy"></a>';

let web:WebServer;
let origin:string;
let safari:Browser;
const api=fakeApi(url=>url.pathname==='/api/site/items/reader-fixture'?itemDetail({id:'reader-fixture',title:'阅读增强检查',bodyHtml:readerBody})
  :url.pathname==='/api/site/items/code-metadata'?itemDetail({id:'code-metadata',title:'显式代码信息',bodyHtml:`<pre data-code-kind="prompt"><code>${codeSource}</code></pre><pre class="language-text"><code>${codeSource}</code></pre><pre class="language-text"><code class="source">${codeSource}</code></pre>`}):undefined);

before(async()=>{
  const started=await Promise.allSettled([
    startWebServer(api).then(w=>{web=w;origin=w.origin;}),
    webkit.launch().then(b=>{safari=b;}),
  ]);
  for(const result of started)if(result.status==='rejected')throw result.reason;
});
after(async()=>{
  await safari?.close();
  await web?.stop();
});

test('reader enhancements wait for visible code and update only the picture that loaded',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const scripts:string[]=[];page.on('request',r=>{if(r.url().includes('/assets/')&&r.url().includes('highlight-'))scripts.push(r.url());});
  await page.route('**/reader-image/*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${route.request().url().endsWith('/tiny.svg')?16:640}" height="360"><rect width="640" height="360" fill="red"/></svg>`}));
  try{
    await visit(page,origin+'/items/reader-fixture');
    await expect(page.getByRole('heading',{name:'阅读增强检查',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'复制代码',exact:true})).toHaveCount(4);
    assert.deepEqual(scripts,[],'reading the introduction must not download the offscreen highlighter');
    const source=page.locator('.prose pre code').first();
    assert.equal(await source.textContent(),codeSource);
    await source.scrollIntoViewIfNeeded();
    await expect(source).toHaveClass(/hljs/);
    assert.equal(await source.textContent(),codeSource,'colouring preserves the copyable text');
    assert.equal(scripts.length,1);
    await page.locator('.code-block-copy').first().click();
    await expect(page.locator('.code-block-copy').first()).toHaveText('已复制');
    assert.equal(await page.locator('.prose pre code').nth(1).textContent(),'x = 1');
    for(let i=0;i<12;i++){
      const picture=page.locator(`.prose img[alt="正文配图 ${i}"]`);
      await picture.scrollIntoViewIfNeeded();
      await expect(picture).toHaveAttribute('role','button');
    }
    const tiny=page.locator('.prose img[alt="小图标"]');await tiny.scrollIntoViewIfNeeded();
    await expect(tiny).not.toHaveAttribute('role','button');
    await expect(page.locator('.prose a img')).not.toHaveAttribute('role','button');
  }finally{await context.close();}
});

test('code metadata is shown once and folding never changes the text copied',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>{
    const state=window as typeof window & {copiedCode:string[]};state.copiedCode=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{state.copiedCode.push(text);}}});
  });
  const page=await context.newPage();
  try{
    await visit(page,origin+'/items/reader-fixture');
    await expect(page.getByRole('button',{name:'折叠代码',exact:true})).toHaveCount(4);
    const toggle=page.getByRole('button',{name:/^(折叠|展开)代码$/}).first();
    await toggle.focus();await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('.prose pre').first()).toBeHidden();
    await page.getByRole('button',{name:'复制代码',exact:true}).first().click();
    await expect.poll(()=>page.evaluate(()=>(window as typeof window & {copiedCode:string[]}).copiedCode)).toEqual([codeSource]);
    await toggle.focus();await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('.prose pre').first()).toBeVisible();
    await expect(page.locator('.code-block-head').nth(1)).toContainText('Shell');
    await expect(page.locator('.code-block-head').nth(2)).toContainText('提示词');
    const text=page.locator('.prose pre').nth(3);await text.scrollIntoViewIfNeeded();
    await expect(page.locator('.code-block-head').nth(3)).toContainText('Text');
    assert.equal(await text.textContent(),codeSource,'line numbering never alters the code');
  }finally{await context.close();}
});

test('declared text and prompt blocks never request a syntax parser',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  const parsers:string[]=[];page.on('request',request=>{if(request.url().includes('/assets/')&&request.url().includes('highlight-'))parsers.push(request.url());});
  try{
    await visit(page,origin+'/items/code-metadata');
    await expect(page.getByRole('button',{name:'复制代码',exact:true})).toHaveCount(3);
    await expect(page.locator('.code-block-head').nth(0)).toContainText('提示词');
    for(const index of [1,2]){
      await page.locator('.prose pre').nth(index).scrollIntoViewIfNeeded();
      await expect(page.locator('.code-block-head').nth(index)).toContainText('Text');
      assert.equal(await page.locator('.prose pre').nth(index).textContent(),codeSource);
    }
    assert.deepEqual(parsers,[]);
  }finally{await context.close();}
});
