import { config } from "../config.js"
import { localFsStorage } from "./localFsStorage.js"
import { s3Storage } from "./s3Storage.js"
import type { IStorage } from "./types.js"

/** The storage backend this process uses, selected by STORAGE_DRIVER. */
export const storage: IStorage = config.storage.driver === "local" ? localFsStorage : s3Storage
