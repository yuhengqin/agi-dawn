// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@agidawn/backend/modules";
import reader from "@agidawn/reader/server";

export const SERVER_MODULES: readonly ServerModule[] = [reader];
