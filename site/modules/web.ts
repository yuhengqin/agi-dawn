// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@agidawn/web/modules";
import reader from "@agidawn/reader/web";

export const WEB_MODULES: readonly WebModule[] = [reader];
