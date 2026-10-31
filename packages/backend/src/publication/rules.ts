/** A paused source retains its public history; only participation and withdrawal control visibility. */
export const hasItemPage=(value:{visibility:string;sourceMode:string})=>value.visibility!=="withdrawn"&&value.sourceMode==="editorial";
export const displayTags=(tags:string[])=>tags.filter(tag=>!tag.startsWith("entity:")&&!tag.startsWith("topic:"));
export function publicSourceName(name:string){
  let bare=name;while(/（[^（）]*）/.test(bare))bare=bare.replace(/（[^（）]*）/g," ");
  const x=/^X[:：]\s*(.*?)\s*(?:\(@[^)]*\))?\s*$/.exec(bare);
  return (x?x[1]!:bare).replace(/\s+/g," ").trim()||/@\w+/.exec(name)?.[0]||name.trim();
}
