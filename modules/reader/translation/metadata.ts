import {sql} from '@agidawn/backend/db';
import {emit} from '@agidawn/backend/modules';
import {READER_FROM,readerVisible} from '@agidawn/backend/publication/items';
import {isChineseText} from '@agidawn/backend/lib/text';
import {shutdownSignal} from '@agidawn/backend/lib/shutdown';
import {completeReceipt,rejectReceivedResponse,ModelOutputError,failureKind} from '@agidawn/backend/providers/receipts';
import type {ReaderMetadataTranslation} from '@agidawn/contracts/site';
import {requestTranslation} from './model.ts';

type MetadataInput={id:string;title:string;summary:string|null};
export async function publicationMetadata(items:readonly MetadataInput[]){
  const result=new Map<string,ReaderMetadataTranslation>();if(!items.length)return result;
  const rows=await sql`SELECT article_id,source_title,source_summary,title,summary FROM reader_metadata_translations
    WHERE article_id IN ${sql(items.map(item=>item.id))} AND status='translated'`;
  const current=new Map(items.map(item=>[item.id,item]));
  for(const row of rows){const item=current.get(String(row.article_id));
    if(item&&item.title===row.source_title&&item.summary===row.source_summary&&row.title)
      result.set(item.id,{title:String(row.title),summary:row.summary===null?null:String(row.summary)});
  }
  return result;
}

/** Public snippets can translate independently of full-text permission and body availability. */
export async function translateMetadataPending(started=Date.now(),durationMs=240_000){
  if(process.env.MODEL_CALLS_ENABLED!=='true')return {done:0};
  let done=0,processed=0;
  const rows=await sql`SELECT p.article_id,p.title,p.summary ${READER_FROM}
    LEFT JOIN reader_metadata_translations t ON t.article_id=p.article_id
    WHERE ${readerVisible} AND (t.article_id IS NULL OR t.source_title IS DISTINCT FROM p.title
      OR t.source_summary IS DISTINCT FROM p.summary OR t.status='pending') ORDER BY p.sort_at DESC,p.article_id`;
  for(const row of rows){
    if(processed>=30||Date.now()-started>durationMs||shutdownSignal.signal.aborted)break;
    processed++;
    const id=String(row.article_id),title=String(row.title),summary=row.summary===null?null:String(row.summary);
    await sql`INSERT INTO reader_metadata_translations(article_id,source_title,source_summary) VALUES(${id},${title},${summary})
      ON CONFLICT(article_id) DO UPDATE SET source_title=EXCLUDED.source_title,source_summary=EXCLUDED.source_summary,
        title=NULL,summary=NULL,status='pending',attempts=0,model=NULL,error=NULL,updated_at=now()
      WHERE reader_metadata_translations.source_title IS DISTINCT FROM EXCLUDED.source_title
        OR reader_metadata_translations.source_summary IS DISTINCT FROM EXCLUDED.source_summary`;
    // A Chinese product name alone cannot identify the language of a mixed-script field.
    const values=[title,summary],indexes=values.flatMap((value,index)=>value?.trim()&&
      (!isChineseText(value)||/\p{Letter}/u.test(value.replace(/\p{Script=Han}/gu,'')))?[index]:[]);
    try{
      const answer=indexes.length?await requestTranslation(id,0,indexes.map(index=>values[index]!),false,'translate_metadata'):null;
      if(answer&&(!answer.t||answer.t.some(value=>!value.trim()))){
        await rejectReceivedResponse(answer.receiptId,'translation returned empty or missing metadata');
        throw new ModelOutputError('Translation returned unusable metadata',answer.receiptId);
      }
      for(const [at,index] of indexes.entries())values[index]=answer!.t![at]!.trim();
      await sql.begin(async tx=>{
        const saved=await tx`UPDATE reader_metadata_translations SET title=${values[0]!},summary=${values[1]??null},
          status=${answer?'translated':'skipped'},model=${answer?.model??null},error=NULL,updated_at=now()
          WHERE article_id=${id} AND source_title=${title} AND source_summary IS NOT DISTINCT FROM ${summary} AND status='pending'
          AND EXISTS(SELECT 1 ${READER_FROM} WHERE p.article_id=${id} AND ${readerVisible}
            AND p.title=${title} AND p.summary IS NOT DISTINCT FROM ${summary}) RETURNING article_id`;
        if(answer)await completeReceipt(tx,answer.receiptId);
        if(saved.length&&answer)await emit('articleChanged',{id,kind:'detail',reason:'title and summary translation'},tx);
      });
      done++;
    }catch(error){
      const kind=failureKind(error);
      if(shutdownSignal.signal.aborted||['off','budget','busy','outage'].includes(kind))break;
      if(kind==='unknown')continue;
      await sql`UPDATE reader_metadata_translations SET attempts=attempts+1,status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END,
        error=${(error instanceof Error?error.message:String(error)).slice(0,300)},updated_at=now()
        WHERE article_id=${id} AND source_title=${title} AND source_summary IS NOT DISTINCT FROM ${summary} AND status='pending'`;
    }
  }
  return {done};
}
