// Backend extension points used by the installed reader and retained operational services.
import type {FastifyInstance,FastifyRequest,FastifyReply} from "fastify";
import type {WorkOptions} from "pg-boss";
import type {AdminPrincipal} from "@agidawn/contracts/admin";
import type {BodyIssue,ReaderMetadataTranslation} from "@agidawn/contracts/site";
import type {Db} from "./db.ts";
import type {QueueOptions} from "./jobs/queue.ts";
import type {Finding} from "./notify/feishu.ts";
import {sha256,stableJson} from "./lib/ids.ts";
export interface MaterialCapture {
  articleId:string;bodyRevision:number;bodyHtml:string;title:string;author:string|null;originalUrl:string;
  publishedAt:string|null;discoveredAt:string;sourceId:string;sourceName:string;quality:"ready"|"partial";issues:BodyIssue[];
}
export const materialRepresentationHash=(capture:MaterialCapture)=>sha256(stableJson(capture));
export interface PublishedBodyInput {articleId:string;bodyRevision:number;representationHash:string;html:string}
export interface ModuleHttpContext {
  adminHandler:(handler:(req:FastifyRequest,reply:FastifyReply,admin:AdminPrincipal)=>Promise<unknown>)=>(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
  sendFile:(req:FastifyRequest,reply:FastifyReply,file:string,options:{type?:string;cacheControl:string;cache?:boolean})=>Promise<unknown>;
}
export interface Scheduled {name:string;cron:string;run:()=>Promise<unknown>;missed?:"skip"|"once";when?:()=>boolean}
export interface ModuleQueue<T=never>{name:string;options:QueueOptions;worker:WorkOptions;run:(data:T[])=>Promise<unknown>}
export const defineQueue=<T>(queue:ModuleQueue<T>)=>queue;
export interface SitemapEntry {loc:string;revision?:string;lastmod?:Date|null;changefreq?:string;priority?:number}
export interface EngineHooks {
  articleCreated:(article:{id:string},tx:Db)=>Promise<void>;
  articleMaterialStored:(capture:MaterialCapture,tx:Db)=>Promise<void>;
  articleChanged:(change:{id:string;kind:"detail"|"body"|"content";reduced?:boolean;reason:string},tx:Db)=>Promise<void>;
  sourceRepublished:(change:{sourceId:string})=>Promise<void>;
  requestAnswered:(req:FastifyRequest,reply:FastifyReply,path:string)=>void;
}
export interface ServerModule {
  name:string;
  publicationBody?:(input:PublishedBodyInput)=>Promise<string>;
  publicationTranslation?:(input:PublishedBodyInput)=>Promise<{html:string;complete:boolean}|null>;
  publicationMetadata?:(items:readonly {id:string;title:string;summary:string|null}[])=>Promise<Map<string,ReaderMetadataTranslation>>;
  backupDirectories?:readonly string[];
  backupVerify?:(dataDir:string)=>Promise<unknown>;
  http?:(app:FastifyInstance,context:ModuleHttpContext)=>void;
  sitemap?:{entries?:()=>Promise<SitemapEntry[]>};
  admin?:{currentJobs?:()=>Promise<readonly string[]>;counts?:Record<string,()=>Promise<number>>;runs?:()=>Promise<unknown>};
  schedules?:Scheduled[];
  queues?:ModuleQueue[];
  on?:Partial<EngineHooks>;
  alerts?:(now:number)=>Promise<Finding[]>;
  followUps?:(now:number)=>Promise<Finding[]>;
  retention?:(now:Date)=>Promise<Record<string,unknown>>;
  sourceKinds?:Record<string,{resumed?:(sourceId:string,tx:Db)=>Promise<void>;fetchNow?:(source:{id:string;config:Record<string,unknown>})=>Promise<Record<string,unknown>>}>;
  sourceHealth?:(now:number)=>Promise<string[]>;
  feedbackKeys?:(ip:string)=>string[];
}
export const defineServerModule=(module:ServerModule)=>module;
let installed:readonly ServerModule[]=[];
export function installModules(modules:readonly ServerModule[]){installed=modules;}
export const serverModules=()=>installed;
export async function emit<K extends Exclude<keyof EngineHooks,"requestAnswered">>(hook:K,...args:Parameters<EngineHooks[K]>):Promise<void>{
  for(const module of installed){const handler=module.on?.[hook] as ((...values:Parameters<EngineHooks[K]>)=>Promise<void>)|undefined;if(handler)await handler(...args);}
}
