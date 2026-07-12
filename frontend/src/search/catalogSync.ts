/**
 * CatalogSyncService — Reads from the new products + supplier_listings + product_attributes
 * tables, denormalizes into the flat ES document structure, and pushes to Elasticsearch.
 *
 * Supports:
 *   - Full re-index on startup
 *   - Incremental updates via BullMQ jobs
 *   - Category hierarchy resolution (e.g. "Valves > Ball Valves")
 */

import prisma from '../db';
import {
  getEsClient,
  isEsEnabled,
  getIndexName,
  ensureIndex,
  resetIndex,
  EsProductDocument,
  EsDynamicAttribute,
  CatalogSyncResult,
} from './esClient';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CatalogSyncService {
  /**
   * Full re-index: truncates the ES index and re-indexes every product.
   */
  static async fullReindex(): Promise<CatalogSyncResult> {
    const start = Date.now();
    const result: CatalogSyncResult = { indexed: 0, errors: [], tookMs: 0 };

    if (!isEsEnabled()) {
      result.errors.push('Elasticsearch not configured (set ES_URL)');
      return result;
    }

    try {
      await resetIndex();

      const products = await this.loadAllProducts();
      const batchSize = 100;

      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        const ops = batch.flatMap((doc) => [
          { index: { _index: getIndexName(), _id: doc.product_id } },
          doc,
        ]);

        const client = await getEsClient();
        if (!client) {
          result.errors.push('Elasticsearch not available');
          continue;
        }
        const response = await client.bulk({ body: ops, refresh: true });

        if (response.errors) {
          for (const item of response.items) {
            if (item.index?.error) {
              result.errors.push(
                `Failed to index ${item.index._id}: ${item.index.error.reason}`,
              );
            }
          }
        }

        result.indexed += batch.length;
      }

      result.tookMs = Date.now() - start;
      console.log(`[ES] Full re-index: ${result.indexed} products in ${result.tookMs}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Full re-index failed: ${message}`);
    }

    return result;
  }

  /**
   * Incremental sync: index a single product by ID.
   * Called from BullMQ jobs when supplier_listings or product_attributes are updated.
   */
  static async syncProduct(productId: string): Promise<CatalogSyncResult> {
    const start = Date.now();
    const result: CatalogSyncResult = { indexed: 0, errors: [], tookMs: 0 };

    if (!isEsEnabled()) return result;

    try {
      await ensureIndex();

      const product = await this.loadProduct(productId);
      if (!product) {
        // Product may have been deleted — remove from index
        const client = await getEsClient();
        if (client) {
          await client.delete({ index: getIndexName(), id: productId }).catch(() => {});
        }
        return result;
      }

      const client = await getEsClient();
      if (!client) {
        result.errors.push('Elasticsearch not available');
        return result;
      }
      await client.index({
        index: getIndexName(),
        id: product.product_id,
        body: product,
        refresh: true,
      });

      result.indexed = 1;
      result.tookMs = Date.now() - start;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Sync failed for product ${productId}: ${message}`);
    }

    return result;
  }

  /**
   * Load all products from the database and denormalize for ES.
   */
  private static async loadAllProducts(): Promise<EsProductDocument[]> {
    const products = await prisma.product.findMany({
      include: {
        manufacturer: true,
        globalCategory: true,
        supplierListings: {
          where: { isActive: true },
          include: { supplier: true },
        },
        productAttributes: true,
      },
    });

    const docs: EsProductDocument[] = [];

    for (const p of products) {
      const doc = await this.buildDocument(p);
      if (doc) docs.push(doc);
    }

    return docs;
  }

  /**
   * Load a single product by ID and denormalize.
   */
  private static async loadProduct(
    productId: string,
  ): Promise<EsProductDocument | null> {
    const p = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        manufacturer: true,
        globalCategory: true,
        supplierListings: {
          where: { isActive: true },
          include: { supplier: true },
        },
        productAttributes: true,
      },
    });

    if (!p) return null;
    return this.buildDocument(p);
  }

  /**
   * Build an ES document from a Prisma Product with includes.
   */
  private static async buildDocument(product: any): Promise<EsProductDocument | null> {
    // Resolve category hierarchy path
    const categoryPath = await this.resolveCategoryPath(product.globalCategory);

    // Build dynamic_attributes from product_attributes
    const dynamicAttributes: EsDynamicAttribute[] = [];
    const attrs = product.productAttributes as {
      normalizedAttributes: Record<string, any>;
      attributeUnits: Record<string, string | null>;
    } | null;

    if (attrs?.normalizedAttributes) {
      for (const [name, value] of Object.entries(attrs.normalizedAttributes)) {
        const unit = attrs.attributeUnits?.[name] || null;

        if (typeof value === 'number') {
          dynamicAttributes.push({ name, value_numeric: value, value_string: undefined, unit });
        } else {
          dynamicAttributes.push({ name, value_string: String(value), value_numeric: undefined, unit });
        }
      }
    }

    // Aggregate inventory from active supplier listings
    let totalAvailable = 0;
    let lowestPrice = Infinity;

    for (const listing of product.supplierListings || []) {
      // Find the latest inventory snapshot for this listing
      const latestSnapshot = await prisma.inventorySnapshot.findFirst({
        where: { supplierListingId: listing.id },
        orderBy: { timestamp: 'desc' },
      });

      if (latestSnapshot) {
        totalAvailable += latestSnapshot.count;
        if (Number(latestSnapshot.price) < lowestPrice) {
          lowestPrice = Number(latestSnapshot.price);
        }
      }
    }

    if (totalAvailable === 0) {
      // Don't index products with no stock — they shouldn't appear in search
      return null;
    }

    return {
      product_id: product.id,
      mpn: product.mpn,
      title: product.title,
      category: categoryPath,
      dynamic_attributes: dynamicAttributes,
      inventory: {
        total_available: totalAvailable,
        lowest_price: lowestPrice === Infinity ? 0 : lowestPrice,
      },
    };
  }

  /**
   * Resolve a category's hierarchical path by walking up parent references.
   * E.g. "Valves > Ball Valves > Floating Ball Valves"
   */
  private static async resolveCategoryPath(
    category: { id: string; name: string; parentId: string | null } | null,
  ): Promise<string> {
    if (!category) return '';

    const names: string[] = [category.name];
    let currentId: string | null = category.parentId;

    // Safeguard against infinite loops
    const visited = new Set<string>();
    visited.add(category.id);

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);

      const parent = await prisma.category.findUnique({
        where: { id: currentId },
      });

      if (!parent) break;

      names.unshift(parent.name);
      currentId = parent.parentId;
    }

    return names.join(' > ');
  }
}