export type ReadingPoint={anchor:string|null;offset:number;progress:number};
const clamp=(n:number)=>Math.min(1,Math.max(0,n));
function sections(root:HTMLElement,ids:string[]){return [{anchor:null as string|null,element:root},...ids.map(anchor=>({anchor,element:root.querySelector<HTMLElement>('#'+anchor)!})).filter(item=>item.element)];}
const pageTop=(element:HTMLElement)=>element.getBoundingClientRect().top+window.scrollY;
const margin=(root:HTMLElement)=>parseFloat(getComputedStyle(root).scrollMarginTop)||0;

/** Capture the section and its fraction at the reading line, only while inside the body. */
export function captureReadingPoint(root:HTMLElement,ids:string[]):ReadingPoint|null{
  if(!root.isConnected)return null;
  const start=pageTop(root),end=start+root.getBoundingClientRect().height,line=window.scrollY+margin(root);
  if(line<start-1||line>end)return null;
  const entries=sections(root,ids),index=Math.max(0,entries.findLastIndex(item=>pageTop(item.element)<=line+1)),entry=entries[index]!;
  const from=pageTop(entry.element),to=entries[index+1]?pageTop(entries[index+1]!.element):end;
  return {anchor:entry.anchor,offset:clamp((line-from)/Math.max(1,to-from)),progress:clamp((line-start)/Math.max(1,end-start))};
}

export function restoreReadingPoint(root:HTMLElement,ids:string[],point:ReadingPoint,bySection=true){
  let top:number;
  if(bySection){
    const entries=sections(root,ids),index=entries.findIndex(item=>item.anchor===point.anchor),entry=entries[index];
    if(!entry)return false;
    const start=pageTop(entry.element),end=entries[index+1]?pageTop(entries[index+1]!.element):pageTop(root)+root.getBoundingClientRect().height;
    top=start+point.offset*(end-start);
  }else top=pageTop(root)+point.progress*root.getBoundingClientRect().height;
  window.scrollTo({top:Math.max(0,top-margin(root)),behavior:'instant'});return true;
}
