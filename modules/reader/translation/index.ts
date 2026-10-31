import {sql,type Db} from '@agidawn/backend/db';
import {emit,type MaterialCapture,type PublishedBodyInput} from '@agidawn/backend/modules';
import {isChineseText} from '@agidawn/backend/lib/text';
import {shutdownSignal} from '@agidawn/backend/lib/shutdown';
import {canReadArticleBody} from '@agidawn/backend/publication/access';
import {completeReceipt,rejectReceivedResponse,ModelOutputError,failureKind} from '@agidawn/backend/providers/receipts';
import {requestTranslation} from './model.ts';
import {translateHtml} from './body.ts';

/** Only this creation event grants eligibility; republishing old articles cannot opt them in. */
export async function registerTranslation({id}:{id:string},tx:Db){
  await tx`INSERT INTO reader_translations(article_id) VALUES(${id}) ON CONFLICT DO NOTHING`;
}
export async function captureTranslation(capture:MaterialCapture,tx:Db){
  await tx`UPDATE reader_translations SET body_revision=${capture.bodyRevision},source_html=${capture.bodyHtml},body_html=NULL,
    status='pending',complete=false,attempts=0,error=NULL,updated_at=now()
    WHERE article_id=${capture.articleId} AND (body_revision IS DISTINCT FROM ${capture.bodyRevision} OR source_html IS DISTINCT FROM ${capture.bodyHtml})`;
}
export async function publicationTranslation(input:PublishedBodyInput){
  const [row]=await sql`SELECT body_html,complete FROM reader_translations WHERE article_id=${input.articleId}
    AND body_revision=${input.bodyRevision} AND source_html=${input.html} AND status IN ('translated','partial')`;
  return row?.body_html?{html:String(row.body_html),complete:Boolean(row.complete)}:null;
}

export async function translatePending(started=Date.now(),durationMs=240_000){
  if(process.env.MODEL_CALLS_ENABLED!=='true')return {done:0};
  let done=0;
  const rows=await sql`SELECT t.article_id,t.body_revision,t.source_html,a.body_text,a.language FROM reader_translations t
    JOIN articles a ON a.id=t.article_id WHERE t.status='pending' AND t.source_html IS NOT NULL
    AND a.body_revision=t.body_revision AND a.body_html=t.source_html ORDER BY t.updated_at,t.article_id`;
  for(const row of rows){
    if(done>=30||Date.now()-started>durationMs||shutdownSignal.signal.aborted)break;
    const articleId=String(row.article_id),revision=Number(row.body_revision),source=String(row.source_html);
    if(!await canReadArticleBody(articleId))continue;
    if(isChineseText(row.body_text??'',row.language)){
      await sql`UPDATE reader_translations SET status='skipped',error='already Chinese',updated_at=now()
        WHERE article_id=${articleId} AND body_revision=${revision} AND source_html=${source}`;
      continue;
    }
    try{
      let model:string|null=null;
      const result=await translateHtml(source,async(parts,retry)=>{const answer=await requestTranslation(articleId,revision,parts,retry);model=answer.model;return answer;});
      if(!result.segments&&result.receiptIds.length){
        for(const id of new Set(result.receiptIds))await rejectReceivedResponse(id,'translation lost protected content');
        throw new ModelOutputError('No usable translated segments');
      }
      await sql.begin(async tx=>{
        const saved=await tx`UPDATE reader_translations SET body_html=${result.segments?result.html:null},complete=${result.complete},
          status=${result.segments?(result.complete?'translated':'partial'):'skipped'},model=${model},error=NULL,updated_at=now()
          WHERE article_id=${articleId} AND body_revision=${revision} AND source_html=${source} AND status='pending' RETURNING article_id`;
        for(const id of new Set(result.receiptIds))await completeReceipt(tx,id);
        if(saved.length)await emit('articleChanged',{id:articleId,kind:'body',reason:'body translation'},tx);
      });
      done++;
    }catch(error){
      const kind=failureKind(error);
      if(shutdownSignal.signal.aborted||['off','budget','busy','outage'].includes(kind))break;
      if(kind==='unknown')continue;
      await sql`UPDATE reader_translations SET attempts=attempts+1,status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END,
        error=${(error instanceof Error?error.message:String(error)).slice(0,300)},updated_at=now()
        WHERE article_id=${articleId} AND body_revision=${revision} AND source_html=${source} AND status='pending'`;
    }
  }
  return {done};
}
