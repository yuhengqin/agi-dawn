import {sql} from '@agidawn/backend/db';
import type {PublicationSearchInput} from '@agidawn/backend/modules';
import {htmlSearchText,metadataSearchText} from '@agidawn/backend/publication/search-text';

export function publicationSearch(input:PublicationSearchInput){
  return sql`SELECT ${metadataSearchText(sql`mt.title`,input.title)} AS title,
    ${metadataSearchText(sql`mt.summary`,input.summary)} AS summary,
    CASE WHEN ${input.bodyAllowed} AND bt.body_html IS NOT NULL THEN ${htmlSearchText(sql`bt.body_html`)} ELSE NULL END AS body
    FROM (SELECT 1) AS seed
    LEFT JOIN reader_metadata_translations mt ON mt.article_id=${input.articleId} AND mt.status='translated'
      AND mt.source_title=${input.title} AND mt.source_summary IS NOT DISTINCT FROM ${input.summary}
    LEFT JOIN reader_translations bt ON ${input.bodyAllowed} AND bt.article_id=${input.articleId}
      AND bt.status IN ('translated','partial') AND bt.body_revision=${input.bodyRevision} AND bt.source_html=${input.bodyHtml}`;
}
