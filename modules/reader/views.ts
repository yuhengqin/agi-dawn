import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql,type Db} from "@agidawn/backend/db";
import {audit,Conflict} from "@agidawn/backend/audit";
import {listCategories} from "@agidawn/backend/publication/categories";
import {listTopics} from "@agidawn/backend/publication/topics";
import {libraryFiltersSchema,checkLibraryFilters} from "./state.ts";
import type {ReaderViewQuery,SavedReaderView} from "./contracts.ts";
import {readerViewQueryKeys} from "./contracts.ts";

const name=z.string().trim().min(1).max(60).refine(value=>!/[\0\r\n]/.test(value));
const filters=libraryFiltersSchema.transform(value=>Object.fromEntries(Object.entries(value).filter(([key,v])=>v!==undefined&&v!==""&&!(key==="sort"&&v==="collected")&&!(key==="dateField"&&(v==="collected"||(!value.dateFrom&&!value.dateTo))))) as ReaderViewQuery);
const version=z.number().int().nonnegative();
const createSchema=z.object({name,filters}).strict();
const updateSchema=z.object({name:name.optional(),filters:filters.optional(),expectedVersion:version}).strict().refine(value=>value.name!==undefined||value.filters!==undefined);
const deleteSchema=z.object({expectedVersion:version}).strict();
interface ViewRow {id:string;name:string;filters:ReaderViewQuery;version:number;created_at:Date;updated_at:Date}
const view=(row:ViewRow):SavedReaderView=>({id:row.id,name:row.name,filters:row.filters,version:row.version,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()});
const missing=()=>Object.assign(new Error("视图不存在"),{statusCode:404});
const stale=()=>new Conflict("视图已改变，请载入已保存版本后再调整");
const duplicate=()=>new Conflict("视图名称已存在，请使用其他名称");
const sameFilters=(a:ReaderViewQuery,b:ReaderViewQuery)=>readerViewQueryKeys.every(key=>a[key]===b[key]);

async function validateFilters(value:ReaderViewQuery,db:Db){
  const [sources,categories,topics]=await Promise.all([db<{id:string;name:string}[]>`SELECT id,name FROM sources`,listCategories(db),listTopics(db)]);
  checkLibraryFilters(value,{sources,categories,topics});
}
export async function listViews(db:Db=sql):Promise<SavedReaderView[]>{return (await db<ViewRow[]>`SELECT * FROM reader_saved_views ORDER BY created_at,id`).map(view);}
export async function readView(id:string,db:Db=sql):Promise<SavedReaderView>{const [row]=await db<ViewRow[]>`SELECT * FROM reader_saved_views WHERE id=${id}`;if(!row)throw missing();return view(row);}
export async function addView(input:unknown,actor:string):Promise<SavedReaderView>{
  const value=createSchema.parse(input),id=randomUUID();
  return sql.begin(async tx=>{
    await validateFilters(value.filters,tx);
    const rows=await tx`INSERT INTO reader_saved_views(id,name,filters) VALUES(${id},${value.name},${tx.json({...value.filters})}) ON CONFLICT(name) DO NOTHING RETURNING id`;
    if(!rows.length)throw duplicate();
    await audit(actor,"reader.view.add","reader-view:"+id,null,null,{version:1},{db:tx});
    return readView(id,tx);
  });
}
export async function updateView(id:string,input:unknown,actor:string):Promise<SavedReaderView>{
  const value=updateSchema.parse(input);
  try{return await sql.begin(async tx=>{
    const [before]=await tx<ViewRow[]>`SELECT * FROM reader_saved_views WHERE id=${id} FOR UPDATE`;
    if(!before)throw missing();if(before.version!==value.expectedVersion)throw stale();
    if(value.filters!==undefined)await validateFilters(value.filters,tx);
    const nextName=value.name??before.name,nextFilters=value.filters??before.filters;
    if(nextName!==before.name||!sameFilters(nextFilters,before.filters)){
      await tx`UPDATE reader_saved_views SET name=${nextName},filters=${tx.json({...nextFilters})},version=version+1,updated_at=now() WHERE id=${id}`;
      await audit(actor,"reader.view.update","reader-view:"+id,null,{version:before.version},{version:before.version+1},{db:tx});
    }
    return readView(id,tx);
  });}catch(error){if((error as {code?:string}).code==="23505")throw duplicate();throw error;}
}
export async function deleteView(id:string,input:unknown,actor:string):Promise<{deleted:true}>{
  const value=deleteSchema.parse(input);
  return sql.begin(async tx=>{
    const [row]=await tx`SELECT version FROM reader_saved_views WHERE id=${id} FOR UPDATE`;if(!row)throw missing();if(row.version!==value.expectedVersion)throw stale();
    await tx`DELETE FROM reader_saved_views WHERE id=${id}`;
    await audit(actor,"reader.view.delete","reader-view:"+id,null,{version:row.version},null,{db:tx});
    return {deleted:true};
  });
}
