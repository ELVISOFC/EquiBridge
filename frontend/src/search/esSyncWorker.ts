/**
 * BullMQ job handler for incremental Elasticsearch sync.
 * Called whenever supplier_listings or product_attributes are updated.
 */

import { Job } from 'bullmq';
import { CatalogSyncService } from './catalogSync';

export interface EsSyncJobData {
  type: 'product_updated' | 'product_deleted' | 'full_reindex';
  productId?: string;
}

/**
 * Process an ES sync job from the queue.
 */
export async function processEsSyncJob(job: Job<EsSyncJobData>): Promise<{ success: boolean; indexed: number }> {
  const { type, productId } = job.data;

  switch (type) {
    case 'full_reindex': {
      const result = await CatalogSyncService.fullReindex();
      return { success: result.errors.length === 0, indexed: result.indexed };
    }

    case 'product_updated': {
      if (!productId) throw new Error('productId required for product_updated job');
      const result = await CatalogSyncService.syncProduct(productId);
      return { success: result.errors.length === 0, indexed: result.indexed };
    }

    case 'product_deleted': {
      // Handled by syncProduct (does a delete if product not found)
      if (!productId) throw new Error('productId required for product_deleted job');
      await CatalogSyncService.syncProduct(productId);
      return { success: true, indexed: 0 };
    }

    default:
      throw new Error(`Unknown ES sync job type: ${type}`);
  }
}