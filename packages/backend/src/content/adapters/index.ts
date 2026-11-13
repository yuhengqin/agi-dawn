import { adaptBrowserUse } from "./browser-use.ts";
import {adaptOpenAI} from './openai.ts';
import {adaptAnthropic} from './anthropic.ts';
import {adaptGhost} from './ghost.ts';
import {adaptUber} from './uber.ts';

export const bodyAdapters = { "browser-use": adaptBrowserUse,openai:adaptOpenAI,anthropic:adaptAnthropic,ghost:adaptGhost,uber:adaptUber };
export type BodyAdapterName = keyof typeof bodyAdapters;

export function isBodyAdapter(value: unknown): value is BodyAdapterName {
  return typeof value === "string" && Object.hasOwn(bodyAdapters, value);
}
