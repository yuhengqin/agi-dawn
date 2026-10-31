import {useLoaderData} from "react-router";
import type {Route} from "./+types/home";
import {loadReaderPage} from "../features/feed/reader.server";
import {ReaderPage,readerMeta} from "../features/feed/ReaderPage";
export {readerHeaders as headers} from "../features/feed/reader.server";
export const handle={tab:"featured",name:"文章"};
export const shouldRevalidate=()=>true;
export async function loader({request}:Route.LoaderArgs){return loadReaderPage(request);}
export const meta=({loaderData}:Route.MetaArgs)=>readerMeta(loaderData);
export default function Page(){return <ReaderPage {...useLoaderData<typeof loader>()}/>;}
