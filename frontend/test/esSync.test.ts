/**
 * Unit Tests — Elasticsearch Index + Catalog Sync Pipeline
 *
 * Tests the denormalization logic, category path resolution,
 * inventory aggregation, and ES document building.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing
vi.mock('../src/db', () => ({
  default: {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    category: {
      findUnique: vi.fn(),
    },
    inventorySnapshot: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from '../src/db';
import { CatalogSyncService } from '../src/search/catalogSync';

// Mock ES client
vi.mock('../src/search/esClient', async () => {
  const actual = await vi.importActual('../src/search/esClient');
  return {
    ...actual,
    isEsEnabled: vi.fn().mockReturnValue(true),
    ensureIndex: vi.fn().mockResolvedValue(true),
    resetIndex: vi.fn().mockResolvedValue(undefined),
    getEsClient: vi.fn().mockReturnValue({
      bulk: vi.fn().mockResolvedValue({ errors: false, items: [] }),
      index: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    }),
    getIndexName: vi.fn().mockReturnValue('equibridge_products'),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'prod-1',
    mpn: 'PMP-100',
    title: 'Industrial Pump',
    manufacturerId: 'mfr-1',
    globalCategoryId: 'cat-2',
    description: 'A powerful industrial pump',
    manufacturer: { id: 'mfr-1', name: 'Acme Corp', website: null },
    globalCategory: { id: 'cat-2', name: 'Ball Valves', parentId: 'cat-1' },
    supplierListings: [
      {
        id: 'sl-1',
        supplierId: 'sup-1',
        isActive: true,
        supplierSku: 'SKU-001',
        supplier: { id: 'sup-1', name: 'Supplier A' },
      },
    ],
    productAttributes: {
      normalizedAttributes: {
        operating_pressure: 217.56,
        voltage: 240,
        material: 'cast iron',
      },
      attributeUnits: {
        operating_pressure: 'psi',
        voltage: 'V',
        material: null,
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CatalogSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildDocument (via loadAllProducts)', () => {
    it('should build an ES document with correct structure', async () => {
      (prisma.product.findMany as any).mockResolvedValue([makeProduct()]);
      (prisma.category.findUnique as any).mockResolvedValue({
        id: 'cat-1',
        name: 'Valves',
        parentId: null,
      });
      (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
        count: 50,
        price: 89.99,
      });

      const result = await CatalogSyncService.fullReindex();

      expect(result.indexed).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should build dynamic attributes correctly', async () => {
      (prisma.product.findMany as any).mockResolvedValue([makeProduct()]);
      (prisma.category.findUnique as any).mockResolvedValue({
        id: 'cat-1',
        name: 'Valves',
        parentId: null,
      });
      (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
        count: 50,
        price: 89.99,
      });

      // We need to check the document that gets sent to ES
      const { getEsClient } = await import('../src/search/esClient');
      const mockBulk = getEsClient()!.bulk as any;

      await CatalogSyncService.fullReindex();

      const bulkCall = mockBulk.mock.calls[0][0];
      const doc = bulkCall.body[1]; // Every other item is the document

      expect(doc.product_id).toBe('prod-1');
      expect(doc.mpn).toBe('PMP-100');
      expect(doc.title).toBe('Industrial Pump');
      expect(doc.category).toBe('Valves > Ball Valves');
      expect(doc.inventory.total_available).toBe(50);
      expect(doc.inventory.lowest_price).toBe(89.99);

      // Dynamic attributes
      expect(doc.dynamic_attributes).toHaveLength(3);
      const pressureAttr = doc.dynamic_attributes.find(
        (a: any) => a.name === 'operating_pressure',
      );
      expect(pressureAttr.value_numeric).toBe(217.56);
      expect(pressureAttr.unit).toBe('psi');
    });

    it('should exclude products with zero inventory', async () => {
      (prisma.product.findMany as any).mockResolvedValue([makeProduct()]);
      (prisma.category.findUnique as any).mockResolvedValue({
        id: 'cat-1',
        name: 'Valves',
        parentId: null,
      });
      (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
        count: 0,
        price: 89.99,
      });

      const result = await CatalogSyncService.fullReindex();

      // Product with 0 stock should be excluded
      expect(result.indexed).toBe(0);
    });

    it('should handle empty catalog', async () => {
      (prisma.product.findMany as any).mockResolvedValue([]);

      const result = await CatalogSyncService.fullReindex();

      expect(result.indexed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should resolve deep category hierarchies', async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        makeProduct({
          globalCategory: { id: 'cat-3', name: 'Floating Ball Valves', parentId: 'cat-2' },
        }),
      ]);

      // Walk up the tree — cat-3 → cat-2 → cat-1
      (prisma.category.findUnique as any).mockImplementation(
        ({ where: { id } }: any) => {
          if (id === 'cat-2')
            return { id: 'cat-2', name: 'Ball Valves', parentId: 'cat-1' };
          if (id === 'cat-1')
            return { id: 'cat-1', name: 'Valves', parentId: null };
          return null;
        },
      );

      (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
        count: 100,
        price: 199.99,
      });

      const { getEsClient } = await import('../src/search/esClient');
      const mockBulk = getEsClient()!.bulk as any;

      await CatalogSyncService.fullReindex();

      const bulkCall = mockBulk.mock.calls[0][0];
      const doc = bulkCall.body[1];

      expect(doc.category).toBe('Valves > Ball Valves > Floating Ball Valves');
    });

    it('should aggregate inventory across multiple supplier listings', async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        makeProduct({
          supplierListings: [
            { id: 'sl-1', supplierId: 'sup-1', isActive: true, supplierSku: 'SKU-001', supplier: { id: 'sup-1', name: 'A' } },
            { id: 'sl-2', supplierId: 'sup-2', isActive: true, supplierSku: 'SKU-002', supplier: { id: 'sup-2', name: 'B' } },
          ],
        }),
      ]);
      (prisma.category.findUnique as any).mockResolvedValue(null);

      (prisma.inventorySnapshot.findFirst as any).mockImplementation(
        ({ where: { supplierListingId } }: any) => {
          if (supplierListingId === 'sl-1')
            return { count: 400, price: 89.99 };
          if (supplierListingId === 'sl-2')
            return { count: 50, price: 129.99 };
          return { count: 0, price: 0 };
        },
      );

      const { getEsClient } = await import('../src/search/esClient');
      const mockBulk = getEsClient()!.bulk as any;

      await CatalogSyncService.fullReindex();

      const bulkCall = mockBulk.mock.calls[0][0];
      const doc = bulkCall.body[1];

      expect(doc.inventory.total_available).toBe(450); // 400 + 50
      expect(doc.inventory.lowest_price).toBe(89.99);   // min price
    });
  });

  describe('syncProduct (incremental)', () => {
    it('should sync a single product by ID', async () => {
      (prisma.product.findUnique as any).mockResolvedValue(makeProduct());
      (prisma.category.findUnique as any).mockResolvedValue({
        id: 'cat-1',
        name: 'Valves',
        parentId: null,
      });
      (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
        count: 25,
        price: 150.0,
      });

      const result = await CatalogSyncService.syncProduct('prod-1');

      expect(result.indexed).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should delete from index if product not found', async () => {
      (prisma.product.findUnique as any).mockResolvedValue(null);
      const { getEsClient } = await import('../src/search/esClient');
      const mockDelete = getEsClient()!.delete as any;

      const result = await CatalogSyncService.syncProduct('prod-deleted');

      expect(result.indexed).toBe(0);
      expect(mockDelete).toHaveBeenCalledWith({
        index: 'equibridge_products',
        id: 'prod-deleted',
      });
    });
  });

  describe('fullReindex error handling', () => {
    it('should report Prisma errors gracefully', async () => {
      (prisma.product.findMany as any).mockRejectedValue(new Error('DB connection failed'));

      const result = await CatalogSyncService.fullReindex();

      expect(result.indexed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('DB connection failed');
    });
  });
});