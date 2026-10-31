import type {FastifyInstance,FastifyRequest} from "fastify";
import {config} from "@agidawn/backend/config";
import {cookie,parseCookies} from "@agidawn/backend/lib/cookies";
import {loadEngagement} from "@agidawn/backend/publication/engagement";
import {newVisitor,visitorHash,VISITOR_COOKIE,recordEngagement} from "@agidawn/backend/operations/engagement";
import {looseQuery,QueryError,sendProblem} from "../http/respond.ts";
import {siteHandler} from "./site.ts";

function sameOrigin(req:FastifyRequest):boolean{
  try{
    const origin=new URL(req.headers.origin??''),site=new URL(config.siteUrl);
    // SSH forwarding changes the browser's port; the web proxy preserves its original Host.
    return req.headers.origin===origin.origin&&origin.protocol===site.protocol&&origin.hostname===site.hostname
      &&origin.host===req.headers.host&&req.headers['sec-fetch-site']!=='cross-site';
  }catch{return false;}
}

export function registerEngagement(app:FastifyInstance){
  app.get('/api/site/engagement',siteHandler(async(req,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const query=looseQuery(req),ids=[...new Set((query.ids??'').split(','))];
    if(Object.keys(query).some(k=>k!=='ids')||ids.length>100||ids.some(id=>!/^[-\w]{1,80}$/.test(id)))throw new QueryError('invalid article ids');
    let token=parseCookies(req.headers.cookie)[VISITOR_COOKIE],visitor=visitorHash(token);
    if(!visitor){token=newVisitor();visitor=visitorHash(token)!;reply.header('Set-Cookie',cookie(VISITOR_COOKIE,token,365*86400,new URL(config.siteUrl).protocol==='https:'));}
    return {items:await loadEngagement(ids,visitor)};
  }));
  for(const [method,path,action] of [['POST','view','view'],['PUT','like','like'],['DELETE','like','unlike']] as const){
    app.route({method,url:`/api/site/items/:id/${path}`,bodyLimit:1024,handler:siteHandler(async(req,reply)=>{
      reply.header('Cache-Control','private, no-store');
      if(!sameOrigin(req))return sendProblem(req,reply,{status:403,code:'forbidden',detail:'same-origin request required'});
      if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')throw new QueryError('JSON required');
      const visitor=visitorHash(parseCookies(req.headers.cookie)[VISITOR_COOKIE]);
      if(!visitor)throw new QueryError('anonymous browser cookie required');
      const id=(req.params as {id:string}).id;
      if(!/^[-\w]{1,80}$/.test(id)||!await recordEngagement(id,visitor,action))return sendProblem(req,reply,{status:404,code:'not_found',detail:'article not found'});
      const [item]=await loadEngagement([id],visitor);
      return item??sendProblem(req,reply,{status:404,code:'not_found',detail:'article not found'});
    })});
  }
}
