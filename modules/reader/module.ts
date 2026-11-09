import { defineModule } from "@agidawn/contracts/modules";
export default defineModule({ name: "reader", apiPaths: [/^\/api\/(?:admin\/reader|reader)(?:\/|$)/],adminPages:[
  {path:"admin/reader",file:"pages/library.tsx"},{path:"admin/reader/taxonomy",file:"pages/taxonomy.tsx"},
  {path:"admin/reader/categories",file:"pages/taxonomy-redirect.ts",id:"reader-legacy-categories"},
  {path:"admin/reader/topics",file:"pages/taxonomy-redirect.ts",id:"reader-legacy-topics"},
  {path:"admin/reader/articles/:id",file:"pages/article.tsx"},{path:"admin/reader/snapshots/:snapshotId",file:"pages/snapshot.tsx"},
] });
