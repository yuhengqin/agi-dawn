import {matchPath,redirect,type LoaderFunctionArgs} from "react-router";

export function loader({request}:LoaderFunctionArgs){
  const {pathname}=new URL(request.url);
  const section=matchPath("/admin/reader/categories",pathname)?"categories":"topics";
  return redirect("/admin/reader/taxonomy#"+section);
}
