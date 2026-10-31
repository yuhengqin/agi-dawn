// Opens the site's main pages and machine exits and checks each answers: the whole-site check after a
// deploy, and CI's check of the built site on an empty database.
//   node scripts/smoke.ts [--base http://localhost:3000]
import { SITE } from "@agidawn/site";

const at = process.argv.indexOf("--base");
const base = (at > 0 ? process.argv[at + 1] : process.env.SITE_URL) ?? "http://localhost:3000";

const PAGES = ["/", "/explore", "/explore?view=sources", "/about", "/changelog", "/feedback", "/terms", "/privacy", "/more", "/admin/login"];
const MACHINE: Array<[path: string, type: RegExp]> = [
  ["/api/health", /json/],
  ["/api/site/articles", /json/],
  ["/api/site/sources", /json/],
  ["/api/site/categories", /json/],
  ["/api/site/topics", /json/],
  ["/robots.txt", /text\/plain/],
  ["/sitemap.xml", /xml/],
  ["/manifest.webmanifest", /manifest/],
  ["/og/site.png", /image\/png/],
  ["/icon.png", /image\/png/],
  ["/favicon.ico", /icon/],
];

let failed = 0;
async function check(path: string, expect: (res: Response, body: string) => string | null) {
  try {
    const res = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    const body = res.headers.get("content-type")?.startsWith("image/") ? "" : await res.text();
    const problem = res.status !== 200 ? `HTTP ${res.status}` : expect(res, body);
    console.log(`${problem ? "✗" : "✓"} ${path}${problem ? `  ${problem}` : ""}`);
    if (problem) failed += 1;
  } catch (error) {
    console.log(`✗ ${path}  ${String(error)}`);
    failed += 1;
  }
}

// Pages write the name as HTML text: a name such as "MyF&B" appears as "MyF&amp;B".
const htmlName = SITE.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
for (const path of PAGES) await check(path, (_res, body) => (body.includes(SITE.name) || body.includes(htmlName) ? null : `the page does not name ${SITE.name}`));
for (const [path, type] of MACHINE) await check(path, (res) => (type.test(res.headers.get("content-type") ?? "") ? null : `content-type ${res.headers.get("content-type")}`));
for(const [path,location] of [["/all","/"],["/all?sourceId=example","/?sourceId=example"],["/topics","/explore"],["/sources","/explore?view=sources"],["/topics/mcp","/?topic=mcp"],["/sources/example","/?sourceId=example"]]) {
  try {const res=await fetch(base+path,{redirect:"manual",signal:AbortSignal.timeout(30_000)});const ok=res.status===301&&res.headers.get("location")===location;console.log(`${ok?"✓":"✗"} redirect ${path} ${res.status}`);if(!ok)failed++;}
  catch(error){console.log(`✗ redirect ${path} ${String(error)}`);failed++;}
}
for(const path of ["/hot","/daily","/agent","/feed.xml","/api/v1/items","/api/mcp","/llms.txt"]) {
  try {const res=await fetch(base+path,{redirect:"manual",signal:AbortSignal.timeout(30_000)});const ok=res.status===404;console.log(`${ok?"✓":"✗"} retired ${path} ${res.status}`);if(!ok)failed++;}
  catch(error){console.log(`✗ retired ${path} ${String(error)}`);failed++;}
}
for(const path of ["/api/admin/reader/library","/api/admin/reader/articles/unknown"]) {
  const res=await fetch(base+path,{redirect:"manual",signal:AbortSignal.timeout(30_000)});const ok=res.status===401&&res.headers.get('cache-control')?.includes('no-store');console.log(`${ok?"✓":"✗"} private ${path} ${res.status}`);if(!ok)failed++;
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
