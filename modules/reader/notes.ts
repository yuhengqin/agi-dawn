import { z } from "zod";
import { sql,type Db } from "@agidawn/backend/db";
import { audit, Conflict } from "@agidawn/backend/audit";
import { requireArticle } from "./state.ts";
import type { ReaderNote } from "./contracts.ts";

export async function readNote(articleId: string,db:Db=sql): Promise<ReaderNote> {
  const [row] = await db`SELECT * FROM reader_notes WHERE article_id=${articleId}`;
  return { articleId,text:row?.text??"",version:row?.version??0,updatedAt:row?.updated_at?.toISOString()??null };
}
export async function writeNote(articleId: string,input: unknown,actor: string): Promise<ReaderNote> {
  const patch = z.object({expectedVersion:z.number().int().nonnegative(),text:z.string().max(20000)}).strict().parse(input);
  await requireArticle(articleId);
  return sql.begin(async tx=>{
    const rows = patch.expectedVersion===0
      ? await tx`INSERT INTO reader_notes (article_id,text) VALUES (${articleId},${patch.text}) ON CONFLICT DO NOTHING RETURNING *`
      : await tx`UPDATE reader_notes SET text=${patch.text},version=version+1,updated_at=now()
        WHERE article_id=${articleId} AND version=${patch.expectedVersion} RETURNING *`;
    const row=rows[0];
    if(!row) throw new Conflict("读后感已在另一个窗口保存，请重新核对");
    await audit(actor,"reader.note",`article:${articleId}`,null,{version:patch.expectedVersion},{version:row.version},{db:tx});
    return {articleId,text:row.text,version:row.version,updatedAt:row.updated_at.toISOString()};
  });
}
