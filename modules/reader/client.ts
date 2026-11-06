export class OwnerRequestError extends Error {readonly status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export const OWNER_SESSION_ENDED='reader-owner-session-ended';
let sessionGeneration=0,anonymousUntil=0,sessionProbe:Promise<boolean>|null=null;
function sessionEnded(){sessionGeneration++;anonymousUntil=Date.now()+30_000;const events=globalThis as typeof globalThis&{dispatchEvent?:(event:Event)=>unknown};events.dispatchEvent?.(new Event(OWNER_SESSION_ENDED));}
function currentGeneration(generation:number){if(generation!==sessionGeneration)throw new OwnerRequestError(401,'会话已失效，请重新登录');}
export async function hasOwnerSession(force=false):Promise<boolean>{
  if(!force&&Date.now()<anonymousUntil)return false;
  if(!sessionProbe)sessionProbe=fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
    if(!response.ok)throw new OwnerRequestError(response.status,'无法确认会话');
    const authenticated=(await response.json() as {authenticated:boolean}).authenticated===true;
    if(authenticated)anonymousUntil=0;else sessionEnded();return authenticated;
  }).finally(()=>{sessionProbe=null;});
  return sessionProbe;
}
export async function ownerMe(signal?:AbortSignal) {
  const response=await fetch("/api/admin/me",{credentials:"same-origin",cache:"no-store",signal});
  if(!response.ok){if(response.status===401)sessionEnded();throw new OwnerRequestError(response.status,"请重新登录站主空间");}
  return response.json() as Promise<{csrf:string;name:string}>;
}
interface RequestOptions {csrf?:string;keepalive?:boolean;signal?:AbortSignal}
async function ownerResponse(path:string,method="GET",body?:unknown,options:RequestOptions={}){
  const csrf=options.csrf??(await ownerMe(options.signal)).csrf;
  const response=await fetch(path,{method,credentials:"same-origin",cache:"no-store",signal:options.signal,keepalive:options.keepalive,headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(method==="GET"?{}:{"x-csrf-token":csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){if(response.status===401)sessionEnded();const problem=await response.json().catch(()=>({})) as {detail?:string};throw new OwnerRequestError(response.status,problem.detail??"请求失败，请重试");}
  return response;
}
export async function ownerRequest<T>(path:string,method="GET",body?:unknown,options?:RequestOptions):Promise<T>{const generation=sessionGeneration,response=await ownerResponse(path,method,body,options),value=await response.json() as T;currentGeneration(generation);return value;}
export async function ownerDownload(path:string,method="GET",body?:unknown,options?:RequestOptions):Promise<Blob>{const generation=sessionGeneration,response=await ownerResponse(path,method,body,options),value=await response.blob();currentGeneration(generation);return value;}
