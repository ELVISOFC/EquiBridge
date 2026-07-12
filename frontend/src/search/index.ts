export { CatalogSyncService } from './catalogSync';
export { processEsSyncJob } from './esSyncWorker';
export type { EsSyncJobData } from './esSyncWorker';
export {
  getEsClient,
  isEsEnabled,
  getIndexName,
  ensureIndex,
  resetIndex,
} from './esClient';
export type {
  EsProductDocument,
  EsDynamicAttribute,
  CatalogSyncResult,
} from './esClient';