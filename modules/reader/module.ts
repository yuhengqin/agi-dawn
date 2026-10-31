import { defineModule } from "@agidawn/contracts/modules";
export default defineModule({ name: "reader", apiPaths: [/^\/api\/(?:admin\/reader|reader)(?:\/|$)/],adminPages:[
  {path:"admin/reader",file:"pages/library.tsx"},{path:"admin/reader/categories",file:"pages/categories.tsx"},{path:"admin/reader/topics",file:"pages/topics.tsx"},
  {path:"admin/reader/articles/:id",file:"pages/article.tsx"},{path:"admin/reader/snapshots/:snapshotId",file:"pages/snapshot.tsx"},
] });
