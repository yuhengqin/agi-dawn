import {randomUUID} from "node:crypto";
import {z} from "zod";
import {UNCATEGORIZED} from "@agidawn/industry/taxonomy";
import {sql,type Tx} from "../db.ts";
import {audit,Conflict} from "../audit.ts";
const name=z.string().trim().min(1).max(60);
export async function addCategory(input:unknown,actor:string) {
  return sql.begin(tx=>addCategoryTx(tx,input,actor));
}
export async function addCategoryTx(tx:Tx,input:unknown,actor:string) {
  const value=z.object({name}).strict().parse(input);
  const [row]=await tx`INSERT INTO article_categories(id,name) VALUES (${"cat-"+randomUUID()},${value.name}) ON CONFLICT(name) DO NOTHING RETURNING id,name,version`;
  if(!row)throw new Conflict("分类名称已存在");
  await audit(actor,"category.add",`category:${row.id}`,null,null,{name:row.name},{db:tx});return row;
}
export async function renameCategory(id:string,input:unknown,actor:string) {
  const value=z.object({name,expectedVersion:z.number().int().nonnegative()}).strict().parse(input);
  return sql.begin(async tx=>{
    const [stored]=await tx<{id:string;name:string;version:number}[]>`SELECT id,name,version FROM article_categories WHERE id=${id}`;
    const current=stored??(id===UNCATEGORIZED.id?{...UNCATEGORIZED,version:0}:undefined);
    if(!current||current.version!==value.expectedVersion)throw new Conflict("分类已改变，请重新载入");
    if(current.name===value.name)return current;

    if((await tx`SELECT 1 FROM article_categories WHERE name=${value.name} AND id<>${id}`).length) throw new Conflict("分类名称已存在");
    const [row]=!stored
      ?await tx`INSERT INTO article_categories(id,name) VALUES (${id},${value.name}) ON CONFLICT DO NOTHING RETURNING id,name,version`
      :await tx`UPDATE article_categories SET name=${value.name},version=version+1,updated_at=now() WHERE id=${id} AND version=${value.expectedVersion} RETURNING id,name,version`;
    if(!row)throw new Conflict("分类已改变，请重新载入");
    await audit(actor,"category.rename",`category:${id}`,null,{name:current.name,version:current.version},{name:row.name,version:row.version},{db:tx});
    return row;
  });
}
