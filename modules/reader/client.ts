export class OwnerRequestError extends Error {readonly status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export async function ownerMe(signal?:AbortSignal) {
  const response=await fetch("/api/admin/me",{credentials:"same-origin",cache:"no-store",signal});
  if(!response.ok)throw new OwnerRequestError(response.status,"请重新登录站主空间");
  return response.json() as Promise<{csrf:string;name:string}>;
}
interface RequestOptions {csrf?:string;keepalive?:boolean;signal?:AbortSignal}
async function ownerResponse(path:string,method="GET",body?:unknown,options:RequestOptions={}){
  const csrf=options.csrf??(await ownerMe(options.signal)).csrf;
  const response=await fetch(path,{method,credentials:"same-origin",cache:"no-store",signal:options.signal,keepalive:options.keepalive,headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(method==="GET"?{}:{"x-csrf-token":csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const problem=await response.json().catch(()=>({})) as {detail?:string};throw new OwnerRequestError(response.status,problem.detail??"请求失败，请重试");}
  return response;
}
export async function ownerRequest<T>(path:string,method="GET",body?:unknown,options?:RequestOptions):Promise<T>{return (await ownerResponse(path,method,body,options)).json() as Promise<T>;}
export async function ownerDownload(path:string,method="GET",body?:unknown,options?:RequestOptions):Promise<Blob>{return (await ownerResponse(path,method,body,options)).blob();}
