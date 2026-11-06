// Article body extraction: readable text from the article page, or "unconfirmed" — never a wrong body.
// Jina Reader is the budgeted fallback for pages that only render in a browser.
import { Readability } from "@mozilla/readability";
import { sql } from "../db.ts";
import { guardedFetch, languageHeaders } from "../lib/http-fetch.ts";
import { assertPageContent, contentDocument, UnavailablePageError } from "../lib/page-content.ts";
import { stripTags } from "../lib/text.ts";
import { isVideoPageUrl } from "../lib/video-url.ts";
import { jinaRead } from "../providers/jina.ts";
import { BudgetExceededError } from "../providers/receipts.ts";
import { getArticle } from "../providers/socialdata.ts";
import { articleUtcOffset, readPublicationDate, type PublicationDate } from "../sources/dates.ts";
import type { SourceRow } from "../sources/types.ts";
import { onlyXArticleLink, xArticleText } from "../sources/x.ts";
import { sanitizeBody, trimTrailingChrome } from "./sanitize.ts";
import { cleanArticlePresentation,figurePresentationIssues } from './presentation.ts';
import { contentHash, fillPublicationTime, reviseMaterial, updatePresentation,captureStoredMaterial, type MediaItem } from "./materials.ts";
import {publishArticleTx} from "../publication/publish.ts";
import { markdownBody } from "./markdown.ts";
import { preparePageContent, type ContentRules } from "./pipeline.ts";
import type { ContentDocument as Doc } from "./components.ts";
import type { BodyIssue } from "@agidawn/contracts/site";
import {postBodyHtml} from "./posts.ts";
import {credential} from "../config.ts";

export type { PreserveRule } from "./components.ts";

export interface PageRules extends ContentRules {
  utcOffset?: string;
  acceptLanguage?: string;
}

export const pageRules = (config: SourceRow["config"]): PageRules =>
  ({ utcOffset: articleUtcOffset(config), preserve: config.detail?.preserve, removeSelector: config.detail?.removeSelector,
    bodyAdapter: config.detail?.bodyAdapter, acceptLanguage: config.acceptLanguage });

export interface ExtractedBody {
  quality: "ready" | "partial";
  issues: BodyIssue[];
  html: string;
  text: string;
  images: Array<{ kind: "image"; url: string; width: number | null; height: number | null }>;
  via: "readability" | "jina";
  /** The page's publication metadata; neither modification time nor dates mentioned in its prose. */
  publishedAt?: Date | null;
  publicationTime?: string | null;
  author?: string | null;
}

const MIN_BODY_CHARS = 200;

/**
 * Paths that serve a sign-in form rather than the page that was asked for. A path segment, never a
 * substring: "/auth-for-agents" and "/authors/x" are ordinary pages.
 */
// Sign-in paths read from the final address, never the text. login|log-in|log_in|signin|sign-in|sign_in|
// register|signup|sign-up|sign_up cover the naming schemes sites use (Devise's /users/sign_in among them);
// wp-login.php is WordPress's login page; the extension alternatives read /login.php, /register.html —
// a segment only counts when it ends at a delimiter (a real page path or an extension), so a page that
// merely carries an auth word ("login.company", "sso-products") stays content.
const AUTH_PATH = /(?:^|\/)(?:login|log-in|log_in|signin|sign-in|sign_in|register|signup|sign-up|sign_up|authorize|oauth2?|sso|auth|wp-login(?:\.php)?)(?:\/|$|\.(?:php|aspx?|html?|jsp))/i;

/** Whether an address is a sign-in form's own path (a listing's "Log in" link is no post either). */
export function isSignInUrl(url: string): boolean {
  try {
    return AUTH_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * A redirect that ended on a sign-in form: the site sent us to authenticate instead of to the page.
 * Read from the final address of the fetch, never from the text, so an article that merely mentions
 * signing in is untouched — a real one (a news piece about password autofill) reads like a login
 * page to any text test.
 *
 * The real case: a source built arxiv.org URLs and HuggingFace answered with its login page. The
 * sign-in form passed the length test and became the body, its navigation differed between fetches so
 * every fetch looked like a new revision of the article (one reached 26 revisions), and the article
 * entered the pool under a title of "220".
 */
export function isSignInRedirect(asked: string, landed: string): boolean {
  try {
    // An address already on such a path was not sent anywhere: a registry page at ".../register" that
    // only gained a trailing slash is still the page that was asked for.
    return !AUTH_PATH.test(new URL(asked).pathname) && AUTH_PATH.test(new URL(landed).pathname);
  } catch {
    return false;
  }
}

/** Publication metadata a page names, in order of trust; a modification time is never one of them. */
const PUBLISHED_META = ['meta[property="article:published_time"]', 'meta[name="pubdate"]', 'meta[itemprop="datePublished"]', 'meta[name="parsely-pub-date"]'];

/** The datePublished of the page's structured data (JSON-LD, also inside @graph). */
function structuredPublished(document: Doc): string | null {
  const find = (v: unknown, depth = 0): string | null => {
    if (depth > 6 || v === null || typeof v !== "object") return null;
    if (Array.isArray(v)) {
      for (const x of v) {
        const got = find(x, depth + 1);
        if (got) return got;
      }
      return null;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.datePublished === "string" && o.datePublished) return o.datePublished;
    return find(o["@graph"], depth + 1);
  };
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const got = find(JSON.parse(el.textContent ?? ""));
      if (got) return got;
    } catch {
      // a broken block names no date
    }
  }
  return null;
}

/**
 * The page's own publication time: its named publication metadata, never a modification time or a date
 * in its prose. The first one found counts; a date without a time gives way to a time the page names
 * for that same day. A time printed without a zone is read in utcOffset (the source's articleUtcOffset).
 */
export function pagePublicationDate(document: Doc, utcOffset?: string): PublicationDate {
  const values = [
    ...PUBLISHED_META.map((selector) => document.querySelector(selector)?.getAttribute("content")),
    structuredPublished(document),
    document.querySelector('time[itemprop~="datePublished"][datetime]')?.getAttribute("datetime"),
  ];
  let day: PublicationDate | null = null;
  for (const value of values) {
    const date = readPublicationDate(value, utcOffset);
    if (!date.publishedAt) continue;
    const timed = date.publicationTime!.includes("T");
    if (!day) {
      if (timed) return date;
      day = date;
    } else if (timed && date.publishedAt.getTime() >= day.publishedAt!.getTime() && date.publishedAt.getTime() - day.publishedAt!.getTime() < 86_400_000) return date;
  }
  return day ?? { publishedAt: null, publicationTime: null };
}

/** The page's article, read under its source's rules (pageRules); null for an error page or no article. */
export function readable(html: string, url: string, rules: PageRules = {}): ExtractedBody | null {
  if (isVideoPageUrl(url)) return null;
  try { return readableDocument(contentDocument(html), url, rules); }
  catch (error) {
    if (error instanceof UnavailablePageError) return null;
    throw error;
  }
}

/** readable() on a page already parsed and checked (contentDocument). Readability changes the document. */
export function readableDocument(document: Doc, url: string, rules: PageRules = {}): ExtractedBody | null {
  if (isVideoPageUrl(url)) return null;
  const date = pagePublicationDate(document, rules.utcOffset);
  try {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.appendChild(base);
  } catch {
    // no head
  }
  const technical = preparePageContent(document, url, rules);
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: MIN_BODY_CHARS, keepClasses: false }).parse();
  if (!article?.content) return null;
  const keptIssues=new Set([...article.content.matchAll(/data-reader-issues="([\d,]+)"/g)].flatMap(match=>match[1]!.split(',').map(Number)));
  const issues=technical.issues.filter((_,index)=>keptIssues.has(index));
  if(article.content.includes('data-reader-figure-loss="true"'))issues.push({kind:"missing-figure",message:"图表依赖原站样式，保留了文字说明，请对照原文。"});
  const clean = trimTrailingChrome(cleanArticlePresentation(sanitizeBody(article.content, url),{url,publishedAt:date.publishedAt?.toISOString(),issues}));
  for(const issue of figurePresentationIssues(clean))if(!issues.some(existing=>existing.kind===issue.kind&&existing.message===issue.message))issues.push(issue);
  const text = stripTags(clean);
  if (text.length < MIN_BODY_CHARS) return null;
  try { assertPageContent(article.title ?? "", text); }
  catch (error) {
    if (error instanceof UnavailablePageError) return null;
    throw error;
  }
  const images: ExtractedBody["images"] = [];
  for (const m of clean.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) {
    const w = /\bwidth="(\d+)"/.exec(m[0]);
    const h = /\bheight="(\d+)"/.exec(m[0]);
    images.push({ kind: "image", url: m[1]!.replace(/&amp;/g, "&"), width: w ? Number(w[1]) : null, height: h ? Number(h[1]) : null });
    if (images.length >= 12) break;
  }
  return { html: clean, text, images, author:article.byline?.trim()||null, via: "readability", quality:issues.length?"partial":"ready",issues,...date };
}

class DirectExtractionError extends Error {}
export async function extractFromUrl(url: string, subject: string, rules: PageRules = {}, opts: { paidFallback?: boolean } = {}): Promise<ExtractedBody | null> {
  if (isVideoPageUrl(url)) return null;
  let failure=new DirectExtractionError('页面未提供可靠正文');
  try {
    const res = await guardedFetch(url, { headers: languageHeaders(rules.acceptLanguage), timeoutMs: 20_000, maxBytes: 6 * 1024 * 1024 });
    if (isVideoPageUrl(res.url)) return null;
    if (isSignInRedirect(url, res.url)) return null;
    const type = res.headers.get("content-type") ?? "";
    if(res.status!==200)failure=new DirectExtractionError(`原站正文请求 HTTP ${res.status}`);
    if (res.status === 200 && /html/.test(type)) {
      const got = readable(res.text(), res.url, rules);
      if (got) return got;
    }
  } catch(error) {
    failure=new DirectExtractionError(error instanceof UnavailablePageError?'页面未提供可靠正文':'原站正文网络请求失败');
  }
  if (opts.paidFallback === false) return null;
  if(!credential('collectors','JINA_API_KEY'))throw failure;
  try {
    const page = await jinaRead(url, { purpose: "body_fallback", subject });
    const html = markdownBody(page.markdown, url);
    const text = stripTags(html);
    if (text.length < MIN_BODY_CHARS) return null;
    return { html, text, images: [], via: "jina",quality:"ready",issues:[] };
  } catch (error) {
    if (error instanceof BudgetExceededError || error instanceof UnavailablePageError) return null;
    throw error;
  }
}

/** Ordinary article pages; player pages have no article body, and social posts arrive separately. */
export function pageFetchable(url: string, sourceKind: string): boolean {
  if (sourceKind === "x_search" || sourceKind === "mp_account" || isVideoPageUrl(url)) return false;
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !/\.(?:mp3|m4a|aac|wav|ogg|mp4|webm|mov)$/i.test(u.pathname) && !/(^|\.)(x\.com|twitter\.com|mp\.weixin\.qq\.com)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Fetches and stores the body of one article. Unconfirmed bodies are recorded as such. */
export async function extractArticleBody(articleId: string,options:{force?:boolean;paidFallback?:boolean}={}): Promise<"ok" | "unconfirmed" | "skipped"> {
  const [a] = await sql<{ id: string; url: string; body_status: string; revision: number; x_post: { tweetId?: string } | null; config: SourceRow["config"] }[]>`
    SELECT a.id, a.url, a.body_status, a.revision, a.x_post, s.config
    FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${articleId}`;
  if (!a || a.body_status === "ok"&&!options.force) return "skipped";
  if (a.x_post?.tweetId) return extractXArticle(a.id, a.x_post.tweetId, a.revision);
  let got:ExtractedBody|null;
  try{got=await extractFromUrl(a.url, `article:${a.id}`, pageRules(a.config),options);}
  catch(error){if(error instanceof DirectExtractionError&&await markUnconfirmed(articleId,a.revision)==='skipped')return 'skipped';throw error;}
  if (!got) {
    return markUnconfirmed(articleId, a.revision);
  }
  // The body is new content: a new revision, so an analysis of the body-less input counts as stale.
  return sql.begin(async (tx) => {
    const [row] = await tx<{ title: string; excerpt: string | null; content_hash: string | null; media: MediaItem[] }[]>`
      SELECT title, excerpt, content_hash, media FROM articles
      WHERE id = ${articleId} AND revision = ${a.revision} AND (body_status <> 'ok' OR ${options.force??false}) FOR UPDATE`;
    if (!row) return "skipped";
    if(got.author)await tx`UPDATE articles SET author=coalesce(author,${got.author}) WHERE id=${articleId}`;
    const time = a.config.detail?.publishedAtAuthoritative === true ? null : await fillPublicationTime(tx, articleId, got.publishedAt, undefined, got.publicationTime);
    const hash = contentHash({ title: row.title, bodyText: got.text, excerpt: row.excerpt });
    if (!time && hash === row.content_hash) {
      await tx`UPDATE articles SET body_status = 'ok', body_revision = coalesce(body_revision, revision), updated_at = now() WHERE id = ${articleId}`;
      await updatePresentation(tx, articleId, { html: got.html, media: row.media.length ? row.media : got.images,quality:got.quality,issues:got.issues });
      await publishArticleTx(tx,articleId);
      await captureStoredMaterial(tx,articleId);
      return "ok";
    }
    await reviseMaterial(tx, articleId, {
      set: sql`body_html = ${got.html}, body_text = ${got.text}, body_status = 'ok',body_quality=${got.quality},body_issues=${tx.json(got.issues as never)},
        media = CASE WHEN jsonb_array_length(media) = 0 THEN ${sql.json(got.images as never)}::jsonb ELSE media END`,
      hash, title: row.title, bodyText: got.text, bodyWritten: true,
    });
    return "ok";
  });
}

async function markUnconfirmed(articleId: string, revision: number): Promise<"unconfirmed" | "skipped"> {
  const rows = await sql`UPDATE articles SET body_status = CASE WHEN body_status='ok' THEN 'ok' ELSE 'unconfirmed' END, updated_at = now()
    WHERE id = ${articleId} AND revision = ${revision} RETURNING id`;
  return rows.length ? "unconfirmed" : "skipped";
}

/**
 * The X Article a post published (SocialData, paid, by the post's own id). The article joins the
 * post's body as a new revision; a post that is only the article's link takes the article's title.
 * No article (the link points at someone else's, or X has none) leaves the post "unconfirmed", and
 * the judging steps are told the article was not fetched.
 */
async function extractXArticle(articleId: string, tweetId: string, revision: number): Promise<"ok" | "unconfirmed" | "skipped"> {
  const found = await getArticle(tweetId, { purpose: "x_article", subject: `article:${articleId}` });
  const got = found ? xArticleText(found) : null;
  if (!got) {
    return markUnconfirmed(articleId, revision);
  }
  return sql.begin(async (tx) => {
    const [row] = await tx<{ title: string; excerpt: string | null; body_text: string | null;media:MediaItem[]; x_post: { text?: string } | null; x_article: { title?: string | null; text?: string } | null }[]>`
      SELECT title, excerpt, body_text,media, x_post, x_article FROM articles
      WHERE id = ${articleId} AND revision = ${revision} AND body_status <> 'ok' FOR UPDATE`;
    if (!row) return "skipped";
    const block = (a: { title?: string | null; text?: string } | null) => (a ? [a.title ? `# ${a.title}` : "", a.text ?? ""].filter(Boolean).join("\n\n") : "");
    // The post's own text, without an article appended by an earlier extraction (an admin re-run
    // extracts again from the post; appending once more would repeat the article).
    const previous = block(row.x_article);
    let base = row.body_text ?? "";
    if (previous && base.endsWith(previous)) base = base.slice(0, -previous.length).replace(/\s+$/, "");
    const title = got.title && onlyXArticleLink(row.x_post?.text) ? got.title : row.title;
    const bodyText = [base, block(got)].filter(Boolean).join("\n\n");
    const bodyHtml=postBodyHtml(bodyText,row.media);
    const issues:BodyIssue[]=found?.content_state?.blocks?.some(b=>b.type==="atomic")?[{kind:"missing-figure",message:"X 长文中的媒体块未保存，请对照原文。"}]:[];
    if (bodyText === row.body_text && title === row.title) {
      // The same article again: nothing new, no new revision.
      await tx`UPDATE articles SET body_status = 'ok', x_article = ${tx.json(got as never)}, updated_at = now() WHERE id = ${articleId}`;
      return "ok";
    }
    await reviseMaterial(tx, articleId, {
      set: sql`title = ${title}, body_text = ${bodyText},body_html=${bodyHtml},body_quality=${issues.length?"partial":"ready"},body_issues=${tx.json(issues as never)}, x_article = ${sql.json(got as never)}, body_status = 'ok'`,
      hash: contentHash({ title, bodyText, excerpt: row.excerpt }), title, bodyText, bodyWritten: true,
    });
    return "ok";
  });
}
