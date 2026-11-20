import {z} from 'zod';
import {sql} from '@agidawn/backend/db';
import {audit,Conflict} from '@agidawn/backend/audit';
import {annotationColors,annotationNoteLimit,annotationQuoteLimit,type PassageAnnotation} from './contracts.ts';
import {requireArticle} from './state.ts';

const color=z.enum(annotationColors);
const note=z.string().max(annotationNoteLimit).refine(value=>!value.includes('\0'));
const expectedVersion=z.number().int().positive();
const create=z.object({
  bodyKey:z.string().regex(/^[0-9a-f]{64}$/),start:z.int32().nonnegative(),end:z.int32().positive(),
  quote:z.string().min(1).max(annotationQuoteLimit).refine(value=>!!value.trim()&&!value.includes('\0')),color,note,
}).strict().refine(value=>value.end-value.start===value.quote.length,{message:'选区与摘录长度不符'});
const edit=z.object({expectedVersion,color,note}).strict();
const remove=z.object({expectedVersion}).strict();
const columns=sql`id, body_key AS "bodyKey", start_offset AS start, end_offset AS "end", quote, color, note, version`;

export async function listAnnotations(articleId:string){
  await requireArticle(articleId);
  return {items:await sql<PassageAnnotation[]>`SELECT ${columns} FROM reader_annotations
    WHERE article_id=${articleId} ORDER BY body_key,start_offset,end_offset`};
}

export async function createAnnotation(articleId:string,input:unknown,actor:string){
  const mark=create.parse(input);
  await requireArticle(articleId);
  return sql.begin(async tx=>{
    const [saved]=await tx<PassageAnnotation[]>`INSERT INTO reader_annotations(article_id,body_key,start_offset,end_offset,quote,color,note)
      VALUES(${articleId},${mark.bodyKey},${mark.start},${mark.end},${mark.quote},${mark.color},${mark.note})
      ON CONFLICT DO NOTHING RETURNING ${columns}`;
    if(!saved)throw new Conflict('这段文字已保存划线，请重新载入核对。');
    await audit(actor,'reader.annotation.create',`article:${articleId}`,null,null,{id:saved.id,version:saved.version},{db:tx});
    return saved;
  });
}

export async function updateAnnotation(articleId:string,id:string,input:unknown,actor:string){
  const mark=edit.parse(input),key=z.uuid().parse(id);
  return sql.begin(async tx=>{
    const [saved]=await tx<PassageAnnotation[]>`UPDATE reader_annotations SET color=${mark.color},note=${mark.note},version=version+1
      WHERE article_id=${articleId} AND id=${key} AND version=${mark.expectedVersion} RETURNING ${columns}`;
    if(!saved)throw new Conflict('划线已变更，请重新载入核对。');
    await audit(actor,'reader.annotation.update',`article:${articleId}`,null,{id,version:mark.expectedVersion},{id,version:saved.version},{db:tx});
    return saved;
  });
}

export async function deleteAnnotation(articleId:string,id:string,input:unknown,actor:string){
  const {expectedVersion}=remove.parse(input),key=z.uuid().parse(id);
  return sql.begin(async tx=>{
    const deleted=await tx`DELETE FROM reader_annotations WHERE article_id=${articleId} AND id=${key} AND version=${expectedVersion} RETURNING id`;
    if(!deleted.length)throw new Conflict('划线已变更，请重新载入核对。');
    await audit(actor,'reader.annotation.delete',`article:${articleId}`,null,{id,version:expectedVersion},null,{db:tx});
    return {deleted:true};
  });
}
