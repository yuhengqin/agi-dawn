import type {ArchiveLimits} from "./contracts.ts";

// Local development ceilings; exceeding them is an explicit partial archive, never silent truncation.
export const ARCHIVE_LIMITS:ArchiveLimits={maxAssetBytes:8*1024*1024,maxSnapshotBytes:64*1024*1024,
  maxAssetsPerSnapshot:128,downloadConcurrency:4,timeoutMs:20000};
