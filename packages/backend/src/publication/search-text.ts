import {sql} from '../db.ts';
import type postgres from 'postgres';
import {matchRanges} from '@agidawn/contracts/search';
export type SearchSql=postgres.PendingQuery<postgres.Row[]>;

/** Inputs are sanitizer/parse5 serialized HTML, never arbitrary source pages. */
export function htmlSearchText(html:SearchSql):SearchSql{
  const tag=`<(?:[^>"']|"[^"]*"|'[^']*')*>`;
  const boundaries='(</?(?:address|article|aside|blockquote|br|caption|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)(?=[[:space:]/>]))';
  // Only insert whitespace at block-tag prefixes: even a tag-shaped literal
  // inside an attribute cannot change its quote boundaries.
  const spaced=sql`regexp_replace(coalesce(${html},''),${boundaries},${' \\1'},'g')`;
  const text=sql`regexp_replace(${spaced},${tag},'','g')`;
  return sql`trim(regexp_replace(replace(replace(replace(replace(${text},'&lt;','<'),'&gt;','>'),'&nbsp;',' '),'&amp;','&'),'[[:space:]]+',' ','g'))`;
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
export function searchSnippet(text:string,words:readonly string[]):string{
  const first=matchRanges(text,words)[0]?.start??0,chars=[...text],start=Math.max(0,[...text.slice(0,first)].length-45);
  const prefix=start?'…':'',room=160-prefix.length,suffix=chars.length-start>room?'…':'';
  return prefix+chars.slice(start,start+room-suffix.length).join('')+suffix;
}
