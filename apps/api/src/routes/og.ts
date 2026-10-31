import type {FastifyInstance,FastifyRequest,FastifyReply} from "fastify";
import {loadItemOgCard} from "@agidawn/backend/publication/og";
import {ogEtag,renderOg,type OgCard} from "@agidawn/backend/media/og";
import {CARDS,SITE} from "@agidawn/site";
const pages=new Set(["site","all","explore","about","terms","privacy","changelog","feedback"]);
async function send(req:FastifyRequest,reply:FastifyReply,card:OgCard){
  const tag='"og-'+ogEtag(card)+'"';reply.header("ETag",tag).header("Cache-Control","no-store");
  if(req.headers["if-none-match"]===tag)return reply.code(304).send();
  return reply.type("image/png").send((await renderOg(card)).png);
}
const missing=(reply:FastifyReply)=>reply.code(404).header("Cache-Control","no-store").send({error:"not_found"});
export function registerOg(app:FastifyInstance){
  app.get("/og/site.png",(req,reply)=>send(req,reply,{kicker:"技术文章阅读与归档",title:SITE.name,subtitle:SITE.description}));
  app.get("/og/pages/:file",(req,reply)=>{
    const file=(req.params as {file:string}).file,name=file.endsWith(".png")?file.slice(0,-4):"";
    return pages.has(name)&&CARDS[name]?send(req,reply,CARDS[name]):missing(reply);
  });
  app.get("/og/items/:file",async(req,reply)=>{
    const file=(req.params as {file:string}).file,card=file.endsWith(".png")?await loadItemOgCard(file.slice(0,-4)):null;
    return card?send(req,reply,card):missing(reply);
  });
}
