import { sql } from "../db.ts";

/** Current source permission and manual visibility also apply to stored public resources. */
export async function canReadArticleBody(articleId: string): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM articles a JOIN sources s ON s.id = a.source_id
    JOIN publications p ON p.article_id = a.id
    LEFT JOIN editorial_overrides o ON o.article_id = a.id
    WHERE a.id = ${articleId} AND s.participation_mode = 'editorial' AND s.site_fulltext
      AND p.visibility = 'public' AND coalesce(o.visibility, 'public') = 'public'
      AND a.body_status = 'ok' AND a.body_html IS NOT NULL`;
  return !!row;
}
