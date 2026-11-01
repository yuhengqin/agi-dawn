import { adaptBrowserUse } from "./browser-use.ts";

export const bodyAdapters = { "browser-use": adaptBrowserUse };
export type BodyAdapterName = keyof typeof bodyAdapters;

export function isBodyAdapter(value: unknown): value is BodyAdapterName {
  return typeof value === "string" && Object.hasOwn(bodyAdapters, value);
}
