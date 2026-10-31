export function parseCookies(header:string|undefined):Record<string,string>{
  const out:Record<string,string>={};
  for(const part of (header??'').split(';')){
    const i=part.indexOf('=');if(i<=0)continue;
    try{out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}
    catch{/* An unrelated malformed cookie must not break the request. */}
  }
  return out;
}

export function cookie(name:string,value:string,maxAgeSeconds:number,secure:boolean):string{
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure?'; Secure':''}`;
}
