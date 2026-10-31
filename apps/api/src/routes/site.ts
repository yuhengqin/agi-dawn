// Anonymous site reads use publication; owner data has separate guarded routes.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ReaderListQuery } from "@agidawn/contracts/site";
import { loadItemDetail } from "@agidawn/backend/publication/detail";
import { loadReaderList, ReaderQueryError, SearchBusyError } from "@agidawn/backend/publication/pool";
import { loadPublicSources } from "@agidawn/backend/publication/sources";
import {listCategories} from "@agidawn/backend/publication/categories";
import { listTopicSummaries, topicBrowseLinks } from "@agidawn/backend/publication/topics";
import { loadChangelog, siteMeta } from "@agidawn/backend/site/meta";
import { loadContact } from "@agidawn/backend/site/contact";
import { loadSiteStats } from "@agidawn/backend/site/stats";
import { QueryError, looseQuery, sendProblem } from "../http/respond.ts";
import { registerFeedback } from "./feedback.ts";
import {registerEngagement} from "./engagement.ts";

type Handler=(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
export function siteHandler(fn:Handler):Handler {
  return async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    try { return await fn(req,reply); }
    catch(error) {
      if(error instanceof ReaderQueryError||error instanceof QueryError)
        return sendProblem(req,reply,{status:400,code:"invalid_request",detail:error.message});
      if(error instanceof SearchBusyError) {
        req.log.warn({err:error,reason:"search_capacity_exhausted",status:503},"search busy");
        return sendProblem(req,reply,{status:503,code:"temporarily_unavailable",detail:"search busy",retryAfter:error.retryAfter});
      }
      req.log.error({err:error},"site read failed");
      return sendProblem(req,reply,{status:503,code:"temporarily_unavailable",detail:"temporarily unavailable",retryAfter:10});
    }
  };
}

function listQuery(req:FastifyRequest):ReaderListQuery {
  const q=looseQuery(req);
  const allowed=new Set(["sourceId","category","topic","from","to","q","page","limit"]);
  if(Object.keys(q).some(key=>!allowed.has(key))) throw new ReaderQueryError("unknown article filter");
  for(const key of ['page','limit'])if(q[key]!==undefined&&!/^[1-9]\d*$/.test(q[key]!))throw new ReaderQueryError("invalid article pagination");
  return {...q,...(q.limit===undefined?{}:{limit:Number(q.limit)}),...(q.page===undefined?{}:{page:Number(q.page)})} as ReaderListQuery;
}

export function registerSite(app:FastifyInstance) {
  app.get("/api/site/meta",siteHandler(async()=>siteMeta()));
  app.get("/api/site/articles",siteHandler(async req=>loadReaderList(listQuery(req))));
  app.get("/api/site/sources",siteHandler(async()=>({items:await loadPublicSources()})));
  app.get("/api/site/categories",siteHandler(async()=>({items:await listCategories()})));
  app.get("/api/site/items/:id",siteHandler(async(req,reply)=>{
    const id=(req.params as {id:string}).id;
    const result=/^[\w-]{1,80}$/.test(id)?await loadItemDetail(id):{kind:"not_found" as const};
    if(result.kind==="not_found") return sendProblem(req,reply,{status:404,code:"not_found",detail:"article not found"});
    return result.item;
  }));
  app.get("/api/site/topics",siteHandler(async()=>listTopicSummaries()));
  app.get("/api/site/search/suggestions",siteHandler(async()=>({topics:await topicBrowseLinks()})));
  app.get("/api/site/contact",siteHandler(loadContact));
  app.get("/api/site/changelog",siteHandler(async()=>loadChangelog()));
  app.get("/api/site/stats",siteHandler(async()=>loadSiteStats()));
  registerFeedback(app);
  registerEngagement(app);
}
