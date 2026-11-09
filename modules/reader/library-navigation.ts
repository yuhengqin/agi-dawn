import {readerViewQueryKeys} from "./contracts.ts";

const libraryKeys = [...readerViewQueryKeys, "limit", "cursor"];

export function librarySearch(value: string) {
  const source = new URLSearchParams(value);
  const query = new URLSearchParams();
  for (const key of libraryKeys) {
    const entry = source.get(key);
    if (entry) query.set(key, entry);
  }
  return query.size ? "?" + query : "";
}

export function withLibrarySearch(path: string, search: string) {
  return search ? path + "?" + new URLSearchParams({library: search}) : path;
}
