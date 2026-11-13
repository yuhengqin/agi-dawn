import type {ArchiveLimits} from "./contracts.ts";

// Local development ceilings; exceeding them is an explicit partial archive, never silent truncation.
export const ARCHIVE_LIMITS:ArchiveLimits={maxAssetBytes:8*1024*1024,maxSnapshotBytes:64*1024*1024,
  // Real illustrated talks exceed 128 images; per-image and total byte budgets remain independent.
  maxAssetsPerSnapshot:256,downloadConcurrency:4,timeoutMs:20000};
