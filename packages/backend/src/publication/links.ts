import {config} from "../config.ts";
export const siteUrl=(path:string)=>config.siteUrl+path;
export const itemUrl=(id:string)=>siteUrl("/items/"+id);
