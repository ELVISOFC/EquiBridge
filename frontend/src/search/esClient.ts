/**
 * Elasticsearch client wrapper — creates the ES client if ES_URL is configured,
 * otherwise provides a no-op stub so the app doesn't crash without Elasticsearch.
 *
 * The @elastic/elasticsearch import is lazy — it's only loaded when ensureIndex()
 * or other ES operations are actually called, so the app works without the package.
 */

import type { Client } from '@elastic/elasticsearch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EsDynamicAttribute {
  name: string;
  value_numeric?: number;
  value_string?: string;
  unit: string | null;
}

export interface EsProductDocument {
  product_id: string;
  mpn: string;
  title: string;
  category: string;                     // Hierarchical path e.g. "Valves > Ball Valves"
  dynamic_attributes: EsDynamicAttribute[];
  inventory: {
    total_available: number;
    lowest_price: number;
  };
}

export interface CatalogSyncResult {
  indexed: number;
  errors: string[];
  tookMs: number;
}

// ---------------------------------------------------------------------------
// Lazy ES Client
// ---------------------------------------------------------------------------

const ES_URL = process.env.ES_URL || '';
const ES_INDEX = process.env.ES_INDEX || 'equibridge_products';
const ES_ENABLED = !!ES_URL;

let clientPromise: Promise<Client> | null = null;

async function getOrCreateClient(): Promise<Client> {
  if (!clientPromise) {
    const { Client } = await import('@elastic/elasticsearch');
    clientPromise = Promise.resolve(
      new Client({
        node: ES_URL,
        requestTimeout: 30000,
      }),
    );
  }
  return clientPromise;
}

/**
 * Get the active ES client. Throws if ES is not configured.
 */
export async function getEsClient(): Promise<Client | null> {
  if (!ES_ENABLED) return null;
  return getOrCreateClient();
}

/**
 * Check if Elasticsearch is enabled.
 */
export function isEsEnabled(): boolean {
  return ES_ENABLED;
}

/**
 * Get the configured index name.
 */
export function getIndexName(): string {
  return ES_INDEX;
}

// ---------------------------------------------------------------------------
// Index Mapping
// ---------------------------------------------------------------------------

/**
 * Index settings + mapping for equibridge_products.
 * Uses nested objects for dynamic_attributes so filters work correctly.
 */
export const INDEX_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1,
    analysis: {
      analyzer: {
        mpn_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'trim'],
        },
      },
    },
  },
  mappings: {
    properties: {
      product_id: { type: 'keyword' },
      mpn: {
        type: 'text',
        analyzer: 'mpn_analyzer',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      title: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      category: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      dynamic_attributes: {
        type: 'nested',
        properties: {
          name: { type: 'keyword' },
          value_numeric: { type: 'double' },
          value_string: { type: 'keyword' },
          unit: { type: 'keyword' },
        },
      },
      inventory: {
        properties: {
          total_available: { type: 'integer' },
          lowest_price: { type: 'float' },
        },
      },
    },
  },
};

/**
 * Create the index with mapping. No-op if the index already exists.
 */
export async function ensureIndex(): Promise<boolean> {
  const client = await getEsClient();
  if (!client) return false;

  const exists = await client.indices.exists({ index: ES_INDEX });
  if (exists) return true;

  await client.indices.create({
    index: ES_INDEX,
    body: INDEX_MAPPING,
  });

  console.log(`[ES] Created index '${ES_INDEX}'`);
  return true;
}

/**
 * Delete and recreate the index (for full re-index).
 */
export async function resetIndex(): Promise<void> {
  const client = await getEsClient();
  if (!client) return;

  const exists = await client.indices.exists({ index: ES_INDEX });
  if (exists) {
    await client.indices.delete({ index: ES_INDEX });
  }

  await ensureIndex();
  console.log(`[ES] Reset index '${ES_INDEX}'`);
}