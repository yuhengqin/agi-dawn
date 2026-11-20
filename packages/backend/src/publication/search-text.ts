import {sql} from '../db.ts';
import type postgres from 'postgres';
export {searchSnippet} from '@agidawn/contracts/search';
export type SearchSql=postgres.PendingQuery<postgres.Row[]>;
const htmlTag=`<(?:[^>"']|"[^"]*"|'[^']*')*>`;

// The whitespace characters normalized by collapseWhitespace in displayed metadata.
const spaces='[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+';
const collapsed=(value:SearchSql)=>sql`trim(regexp_replace(coalesce(${value},''),${spaces},' ','g'))`;

/** Keep cleanSummary's display rules inside SQL so filtering precedes totals and pagination. */
export function summarySearchText(value:SearchSql,title:SearchSql,url:SearchSql):SearchSql{
  return sql`(WITH normalized AS (
    SELECT ${collapsed(value)} AS text,regexp_replace(coalesce(${title},''),${'([.*+?^$(){}|\\[\\]\\\\])'},${'\\\\\\1'},'g') AS title,
      substring(lower(${url}) FROM ${'^https?://(?:www\\.)?([^/?#:]+)'}) AS host
  ), english AS (
    SELECT *,CASE WHEN title<>'' THEN trim(regexp_replace(text,${' +The post '}||title||${' appeared first on .+?[.]? *$'},'','i')) ELSE text END AS body FROM normalized
  ), chinese AS (
    SELECT *,CASE WHEN title<>'' AND host='blogs.microsoft.com' THEN trim(regexp_replace(body,
      ${' *(?:(?:本文|文章|帖子) *)?[《「“]?'}||title||${'[》」”]? *(?:一文)?(?:最初|最早|首次)发布于[^。]+。$'},'')) ELSE body END AS summary FROM english
  ) SELECT nullif(CASE
    WHEN host='uber.com' AND text ~* ${'^uber[.!。]?$'} THEN ''
    WHEN host='ghuntley.com' AND summary ~ ${'[^ ]&$'} THEN CASE
      WHEN summary ~ ${'[.!?。！？][^.!?。！？]*&$'} THEN regexp_replace(summary,${'([.!?。！？])[^.!?。！？]*&$'},${'\\1'}) ELSE left(summary,-1) END
    ELSE summary END,'') FROM chinese)`;
}

/** Source names are searched as publicSourceName displays them, without internal annotations. */
export function sourceSearchText(value:SearchSql):SearchSql{
  const parentheses='（[^（）]*）';
  return sql`(WITH RECURSIVE names(name) AS (
    SELECT ${value}::text UNION ALL SELECT regexp_replace(name,${parentheses},' ','g') FROM names WHERE name ~ ${parentheses}
  ) SELECT coalesce(nullif(${collapsed(sql`coalesce(substring(name FROM ${'^X[:：]\\s*(.*?)\\s*(?:\\(@[^)]*\\))?\\s*$'}),name)`)},''),
    substring(${value} FROM ${'@[a-zA-Z0-9_]+'}),trim(${value})) FROM names WHERE name !~ ${parentheses})`;
}

/** Inputs are sanitizer/parse5 serialized HTML, never arbitrary source pages. */
export function htmlSearchText(html:SearchSql):SearchSql{
  const blocks='address article aside blockquote br caption dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul'.split(' ');
  const boundaries='(</?(?:'+blocks.join('|')+')(?=[[:space:]/>]))';
  // Serialized text escapes angle brackets. Only quoted attributes can contain
  // literal delimiters that require the slower quote-aware tag parser.
  const spaced=sql`regexp_replace(coalesce(${html},''),${boundaries},${' \\1'},'g')`;
  const quotedDelimiter='=[[:space:]]*(?:"[^"]*[<>]|\'[^\']*[<>])';
  const tagName=sql`split_part(translate(ltrim(split_part(part,'>',1),'/'),${'\t\n\r\f/'},'     '),' ',1)`;
  const text=sql`CASE WHEN ${html} ~ ${quotedDelimiter} THEN regexp_replace(${spaced},${htmlTag},'','g')
    ELSE (SELECT coalesce(string_agg(CASE WHEN ordinal=1 THEN part ELSE
      CASE WHEN ${tagName}=ANY(${blocks}::text[]) THEN ' ' ELSE '' END
        || substr(part,strpos(part,'>')+1) END,'' ORDER BY ordinal),'')
      FROM string_to_table(${html},'<') WITH ORDINALITY AS parts(part,ordinal)) END`;
  return sql`trim(regexp_replace(replace(replace(replace(replace(${text},'&lt;','<'),'&gt;','>'),'&nbsp;',' '),'&amp;','&'),'[[:space:]]+',' ','g'))`;
}

/** Rule out impossible HTML hits before extracting the full text. These literal
 * characters survive entity decoding and can only be separated by inline tags.
 * Attribute hits and word edges are still checked against the actual visible text. */
export function bodySearchMatch(html:SearchSql,text:SearchSql,word:string,pattern:string):SearchSql{
  const literal=word.match(/[a-z0-9_\p{Script=Han}]{2,8}/u)?.[0];
  const match=sql`(${text} ~* ${pattern})`;
  if(!literal)return match;
  const candidate=Array.from(literal).join('(?:'+htmlTag+')*');
  return sql`CASE WHEN ${html} IS NULL OR ${html} ~* ${candidate} THEN ${match} ELSE false END`;
}

/** Match plainMetadata: retain only tag-shaped literals that also existed in the source. */
export function metadataSearchText(value:SearchSql,source:SearchSql):SearchSql{
  const tag='</?[a-zA-Z][^<>]*>',tokens='(</?[a-zA-Z][^<>]*>)|([^<]+|<)';
  return sql`CASE WHEN ${value}::text IS NULL THEN NULL ELSE (SELECT trim(regexp_replace(coalesce(string_agg(CASE
    WHEN parts[1] IS NULL THEN parts[2]
    WHEN occurrence <= (SELECT count(*) FROM regexp_matches(coalesce(${source},''),${tag},'g') AS original(part) WHERE part[1]=parts[1]) THEN parts[1]
    ELSE '' END,'' ORDER BY ordinal),''),'[[:space:]]+',' ','g'))
    FROM (SELECT parts,ordinal,row_number() OVER(PARTITION BY parts[1] ORDER BY ordinal) AS occurrence
      FROM regexp_matches(${value},${tokens},'g') WITH ORDINALITY AS token(parts,ordinal)) AS values) END`;
}
