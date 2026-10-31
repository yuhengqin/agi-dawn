import { defineServerModule } from "@agidawn/backend/modules";
import { patchState, saveBulkState, readLibrary, readState, requireArticle } from "./state.ts";
import { readNote, writeNote } from "./notes.ts";
import {archiveQueue,captureSnapshot,listSnapshots,readSnapshot,currentSnapshot} from "./archive/snapshots.ts";
import {missing} from "./state.ts";
import {assetFile,currentSnapshotMatches,publicationBody,snapshotBody} from "./archive/assets.ts";
import {canReadArticleBody} from "@agidawn/backend/publication/access";
import {sql} from "@agidawn/backend/db";
import {enqueueOn} from "@agidawn/backend/jobs/queue";
import {exportSnapshot} from "./archive/export.ts";
import {verifyReaderArchive} from "./archive/verify.ts";
import {readArticleClassification,saveArticleClassification,saveBulkClassification} from "./classification.ts";
import {SearchBusyError} from "@agidawn/backend/publication/pool";
import {listManagedTopics,addTopic,updateTopic} from "./topics.ts";
import {listViews,readView,addView,updateView,deleteView} from "./views.ts";
import {exportNote,exportNotes} from './note-export.ts';
import {readPosition,savePosition} from './positions.ts';
import {withOutline} from '@agidawn/backend/content/outline';
import {registerTranslation,captureTranslation,publicationTranslation,translatePending} from './translation/index.ts';
import {publicationMetadata,translateMetadataPending} from './translation/metadata.ts';

async function privateSnapshot(id:string){
  const snapshot=await readSnapshot(id);if(!snapshot)throw missing();
  const resources=await sql`SELECT original_url,status,error FROM reader_snapshot_assets WHERE snapshot_id=${id} ORDER BY asset_key`;
  const outlined=withOutline(snapshot.bodyHtml);
  return {...snapshot,resources,bodyHtml:await snapshotBody({...snapshot,bodyHtml:outlined.html},true),outline:outlined.outline};
}

export default defineServerModule({ name: "reader",on:{articleCreated:registerTranslation,articleMaterialStored:async(capture,tx)=>{await captureSnapshot(capture,tx);await captureTranslation(capture,tx);}},publicationBody,publicationTranslation,publicationMetadata,
  schedules:[{name:'reader.translate',cron:'*/5 * * * *',run:async()=>({metadata:await translateMetadataPending(Date.now(),120_000),body:await translatePending(Date.now(),120_000)})}],queues:[archiveQueue],backupDirectories:["reader-archives/assets"],backupVerify:verifyReaderArchive,http(app,{adminHandler,sendFile}) {
  const id=(req:{params:unknown})=>(req.params as {id:string}).id;
  app.get("/api/admin/reader/views",adminHandler(async()=>({items:await listViews()})));
  app.post("/api/admin/reader/views",adminHandler(async(req,_reply,admin)=>addView(req.body,admin.name)));
  app.get("/api/admin/reader/views/:id",adminHandler(async req=>readView(id(req))));
  app.patch("/api/admin/reader/views/:id",adminHandler(async(req,_reply,admin)=>updateView(id(req),req.body,admin.name)));
  app.delete("/api/admin/reader/views/:id",adminHandler(async(req,_reply,admin)=>deleteView(id(req),req.body,admin.name)));
  app.get("/api/admin/reader/topics",adminHandler(async()=>({items:await listManagedTopics()})));
  app.post("/api/admin/reader/topics",adminHandler(async(req,_reply,admin)=>addTopic(req.body,admin.name)));
  app.patch("/api/admin/reader/topics/:slug",adminHandler(async(req,_reply,admin)=>updateTopic((req.params as {slug:string}).slug,req.body,admin.name)));
  app.get("/api/admin/reader/articles/:id",adminHandler(async req=>{
    await requireArticle(id(req));
    const [state,note]=await Promise.all([readState(id(req)),readNote(id(req))]);
    const article=await readArticleClassification(id(req));
    const current=await currentSnapshot(id(req));
    return {article,state,note,currentSnapshot:current?await privateSnapshot(current.id):null};
  }));
  app.patch("/api/admin/reader/articles/:id/classification",adminHandler(async(req,_reply,admin)=>saveArticleClassification(id(req),req.body,admin.name)));
  app.patch("/api/admin/reader/classification",adminHandler(async(req,_reply,admin)=>saveBulkClassification(req.body,admin.name)));
  app.patch("/api/admin/reader/articles/:id/state",adminHandler(async(req,_reply,admin)=>patchState(id(req),req.body,admin.name)));
  app.patch("/api/admin/reader/state",adminHandler(async(req,_reply,admin)=>saveBulkState(req.body,admin.name)));
  app.put("/api/admin/reader/articles/:id/note",adminHandler(async(req,_reply,admin)=>writeNote(id(req),req.body,admin.name)));
  app.get('/api/admin/reader/articles/:id/note.md',adminHandler(async(req,reply)=>{
    const file=await exportNote(id(req));
    return reply.header('Content-Disposition',`attachment; filename="${file.filename}"`).type('text/markdown; charset=utf-8').send(file.text);
  }));
  app.post('/api/admin/reader/notes/export.zip',adminHandler(async(req,reply)=>{
    const bundle=await exportNotes(req.body);
    return reply.header('Content-Disposition','attachment; filename="reading-notes.zip"').type('application/zip').send(bundle);
  }));
  app.get("/api/admin/reader/library",adminHandler(async(req,reply)=>{
    try{return await readLibrary(req.query);}catch(error){
      if(error instanceof SearchBusyError)return reply.code(503).header("Retry-After",String(error.retryAfter)).send({detail:"搜索繁忙，请稍后重试"});
      throw error;
    }
  }));
  app.get("/api/admin/reader/articles/:id/snapshots",adminHandler(async req=>{await requireArticle(id(req));return {items:await listSnapshots(id(req))};}));
  app.get("/api/admin/reader/snapshots/:snapshotId/export.zip",adminHandler(async(req,reply)=>{
    const bundle=await exportSnapshot((req.params as {snapshotId:string}).snapshotId);
    return reply.header("Content-Disposition",`attachment; filename="${bundle.filename}"`).type("application/zip").send(bundle.stream);
  }));
  app.get("/api/admin/reader/snapshots/:snapshotId",adminHandler(async req=>{
    return privateSnapshot((req.params as {snapshotId:string}).snapshotId);
  }));
  app.get('/api/admin/reader/snapshots/:snapshotId/position',adminHandler(async req=>readPosition((req.params as {snapshotId:string}).snapshotId)));
  app.put('/api/admin/reader/snapshots/:snapshotId/position',adminHandler(async req=>savePosition((req.params as {snapshotId:string}).snapshotId,req.body)));
  const sendAsset=async(req:import("fastify").FastifyRequest,reply:import("fastify").FastifyReply)=>{
    const {snapshotId,assetKey}=req.params as {snapshotId:string;assetKey:string};
    const [asset]=await sql`SELECT a.* FROM reader_snapshot_assets sa JOIN reader_assets a ON a.hash=sa.asset_hash
      WHERE sa.snapshot_id=${snapshotId} AND sa.asset_key=${assetKey} AND sa.status='ready'`;
    if(!asset)return reply.code(404).header("Cache-Control","no-store").send({error:"not_found"});
    return sendFile(req,reply,assetFile(asset.path),{type:asset.mime,cacheControl:"no-store",cache:false});
  };
  app.get("/api/admin/reader/snapshots/:snapshotId/assets/:assetKey",adminHandler(async(req,reply)=>sendAsset(req,reply)));
  app.get("/api/reader/articles/:articleId/assets/:snapshotId/:assetKey",async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const {articleId,snapshotId}=req.params as {articleId:string;snapshotId:string};
    const snapshot=await readSnapshot(snapshotId);
    if(!snapshot||!await canReadArticleBody(articleId)||!await currentSnapshotMatches(articleId,snapshot))return reply.code(404).send({error:"not_found"});
    return sendAsset(req,reply);
  });
  app.post("/api/admin/reader/snapshots/:snapshotId/retry",adminHandler(async req=>{
    const snapshotId=(req.params as {snapshotId:string}).snapshotId;
    const snapshot=await readSnapshot(snapshotId);if(!snapshot)throw missing();
    if(snapshot.status!=="complete"){
      await sql.begin(async tx=>{
        await tx`UPDATE reader_snapshots SET status='pending',attempts=0 WHERE id=${snapshotId} AND status<>'complete'`;
        await tx`UPDATE reader_snapshot_assets SET status='pending',error=NULL WHERE snapshot_id=${snapshotId} AND status='failed'`;
        await enqueueOn(archiveQueue,{snapshotId},{singletonKey:snapshotId},tx);
      });
    }
    return {queued:snapshot.status!=="complete"};
  }));
} });
