import {sql,type Db} from "../db.ts";
import {UNCATEGORIZED} from "@agidawn/industry/taxonomy";
export async function listCategories(db:Db=sql) {
  const rows=await db<{id:string;name:string;version:number}[]>`SELECT id,name,version FROM article_categories ORDER BY name,id`;
  return rows.some(r=>r.id===UNCATEGORIZED.id)?rows:[{...UNCATEGORIZED,version:0},...rows];
}
export async function categoryExists(id:string,db:Db=sql) {
  return id===UNCATEGORIZED.id||!!(await db`SELECT 1 FROM article_categories WHERE id=${id}`).length;
}
