/** Shared public matching semantics: Chinese substrings and complete English technical words. */
export function searchWords(query:string):string[]{
  return query.toLowerCase().replace(/(\p{Script=Han})(?=[a-z])/gu,'$1 ').replace(/([a-z][a-z0-9]*)(?=\p{Script=Han})/gu,'$1 ')
    .split(/\s+/).filter(Boolean);
}
export function searchPattern(word:string):string{
  const literal=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return /[a-z0-9_]/i.test(word)?`(?<![a-z0-9_])${literal}(?![a-z0-9_])`:literal;
}
export function matchRanges(text:string,words:readonly string[]):Array<{start:number;end:number}>{
  const ranges=words.flatMap(word=>[...text.matchAll(new RegExp(searchPattern(word),'gi'))].map(match=>({start:match.index,end:match.index+match[0].length}))).sort((a,b)=>a.start-b.start||b.end-a.end);
  const result:Array<{start:number;end:number}>=[];
  for(const range of ranges){const previous=result.at(-1);if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end);else result.push({...range});}
  return result;
}
