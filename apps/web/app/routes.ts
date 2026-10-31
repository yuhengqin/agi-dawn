import { type RouteConfig, type RouteConfigEntry, index, layout, route } from "@react-router/dev/routes";
import type { ModulePage } from "@agidawn/contracts/modules";
import { MODULES } from "@agidawn/site/modules";

/** A module's route module, from the app directory. */
const file = (module: string, path: string) => `../../../modules/${module}/${path}`;
const page = (module: string, p: ModulePage) => route(p.path, file(module, p.file), p.id ? { id: p.id } : {});

/** The site's modules' pages, after the engine's. */
const modulePages: RouteConfigEntry[] = MODULES.flatMap((m) =>
  (m.pages ?? []).map((p) => ("layout" in p ? layout(file(m.name, p.layout), p.id ? { id: p.id } : {}, p.pages.map((c) => page(m.name, c))) : page(m.name, p))),
);
const moduleAdminPages: RouteConfigEntry[] = MODULES.flatMap((m) => (m.adminPages ?? []).map((p) => page(m.name, p)));

export default [
  index("routes/home.tsx"),
  route("items/:id", "routes/item.tsx"),
  route("explore", "routes/explore.tsx"),
  route("about", "routes/about.tsx"),
  route("terms", "routes/terms.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("changelog", "routes/changelog.tsx"),
  route("feedback", "routes/feedback.tsx"),
  route("more", "routes/more.tsx"),
  ...modulePages,
  route("admin/login", "routes/admin-login.tsx"),
  layout("routes/admin/layout.tsx", { id: "admin-layout" }, [
    route("admin", "routes/admin/index.tsx"),
    route("admin/content", "routes/admin/content.tsx"),
    route("admin/content/:id", "routes/admin/content-item.tsx"),
    route("admin/sources", "routes/admin/sources.tsx"),
    route("admin/sources/new", "routes/admin/source-new.tsx"),
    route("admin/sources/:id", "routes/admin/source.tsx"),
    route("admin/feedback", "routes/admin/feedback.tsx"),
    route("admin/runs", "routes/admin/runs.tsx"),
    route("admin/settings", "routes/admin/settings.tsx"),
    route("admin/audit", "routes/admin/audit.tsx"),
    ...moduleAdminPages,
  ]),
] satisfies RouteConfig;
