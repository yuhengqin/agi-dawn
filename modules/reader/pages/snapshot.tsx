import {Link,useLoaderData,type LoaderFunctionArgs} from 'react-router';
import {adminGet} from '../../../apps/web/app/lib/admin.server.ts';
import type {SnapshotView} from '../contracts.ts';
import SnapshotReading from '../components/SnapshotReading.tsx';
import OwnerTools from '../components/OwnerTools.tsx';
export const headers=()=>({'Cache-Control':'no-store'});
export const shouldRevalidate=()=>true;
export async function loader({request,params}:LoaderFunctionArgs){return adminGet<SnapshotView>(request,'/api/admin/reader/snapshots/'+encodeURIComponent(params.snapshotId!));}
export default function SnapshotPage(){const snapshot=useLoaderData<typeof loader>();return <section className="private-reading-page mx-auto break-words px-5 py-8"><Link className="text-accent" to={'/admin/reader/articles/'+snapshot.articleId}>当前文章与版本</Link><h1 className="mt-5 text-2xl font-semibold">{snapshot.title}</h1><SnapshotReading key={snapshot.id} snapshot={snapshot}/><OwnerTools articleId={snapshot.articleId}/></section>;}
