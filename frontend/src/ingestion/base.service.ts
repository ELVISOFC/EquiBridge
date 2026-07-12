import { PrismaClient, Supplier, SupplierAttributeMap, TaxonomyAttribute } from '@prisma/client';
import { DataTransformer, NormalizedProduct, TaxonomyEntry, normalizeAttribute } from './transformer';

// =============================================================================
// Types
// =============================================================================

export interface IngestionResult {
  success: boolean;
  productsCreated: number;
  listingsCreated: number;
  errors: string[];
}

// =============================================================================
// Ingestion Service — Base
// =============================================================================

export abstract class IngestionService {
  protected prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Main entry point for ingesting a supplier's catalog.
   */
  abstract ingest(supplier: Supplier): Promise<IngestionResult>;

  /**
   * Fetch mapping rules for a supplier.
   */
  protected async getMappings(supplierId: string): Promise<SupplierAttributeMap[]> {
    return this.prisma.supplierAttributeMap.findMany({
      where: { supplierId },
    });
  }

  /**
   * Load the taxonomy registry into a Map for efficient lookup.
   */
  protected async loadTaxonomyMap(): Promise<Map<string, TaxonomyEntry>> {
    const entries = await this.prisma.taxonomyAttribute.findMany();
    const map = new Map<string, TaxonomyEntry>();

    for (const entry of entries) {
      map.set(entry.attributeKey, {
        attributeKey: entry.attributeKey,
        expectedDataType: entry.expectedDataType as 'NUMERIC' | 'STRING',
        allowedUnits: entry.allowedUnits as string[] | null,
        baseUnit: entry.baseUnit,
      });
    }

    return map;
  }

  /**
   * Processes and saves normalized products to the new schema:
   *   1. Resolve manufacturer (by name)
   *   2. Resolve category (by name/slug)
   *   3. Upsert canonical Product (by MPN + manufacturerId)
   *   4. Upsert SupplierListing with raw_payload preservation
   *   5. Upsert ProductAttributes with normalized values
   *   6. Create InventorySnapshot for price/stock tracking
   */
  protected async saveNormalizedProducts(
    supplierId: string,
    products: NormalizedProduct[],
  ): Promise<IngestionResult> {
    const result: IngestionResult = {
      success: true,
      productsCreated: 0,
      listingsCreated: 0,
      errors: [],
    };

    const taxonomyMap = await this.loadTaxonomyMap();

    for (const p of products) {
      try {
        // 1. Resolve Manufacturer
        let manufacturerId: string | null = null;
        if (p.manufacturerName) {
          const manufacturer = await this.prisma.manufacturer.upsert({
            where: { name: p.manufacturerName },
            update: {},
            create: { name: p.manufacturerName },
          });
          manufacturerId = manufacturer.id;
        }

        // 2. Resolve Category
        let categoryId: string | null = null;
        if (p.category) {
          const slug = p.category
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

          const category = await this.prisma.category.upsert({
            where: { slug },
            update: { name: p.category },
            create: { name: p.category, slug },
          });
          categoryId = category.id;
        }

        // 3. Upsert canonical Product by MPN + manufacturerId
        const product = await this.prisma.product.upsert({
          where: {
            mpn_manufacturerId: {
              mpn: p.mpn,
              manufacturerId: manufacturerId || '__none__',
            },
          },
          update: {
            title: p.title,
            description: p.description || undefined,
            globalCategoryId: categoryId,
            gtin: p.gtin || undefined,
          },
          create: {
            mpn: p.mpn,
            gtin: p.gtin,
            title: p.title,
            description: p.description,
            manufacturerId,
            globalCategoryId: categoryId,
          },
        });

        result.productsCreated++;

        // 4. Upsert SupplierListing with raw_payload
        const listing = await this.prisma.supplierListing.upsert({
          where: {
            supplierId_supplierSku: {
              supplierId,
              supplierSku: p.mpn, // using MPN as the supplier SKU if not separately provided
            },
          },
          update: {
            rawPayload: p.rawPayload,
            isActive: true,
          },
          create: {
            productId: product.id,
            supplierId,
            supplierSku: p.mpn,
            rawPayload: p.rawPayload,
            isActive: true,
          },
        });

        result.listingsCreated++;

        // 5. Upsert ProductAttributes with normalized values
        const normalizedAttrs: Record<string, any> = {};
        const attributeUnits: Record<string, string | null> = {};

        for (const [key, nav] of Object.entries(p.normalizedAttributes)) {
          normalizedAttrs[key] = nav.value;
          attributeUnits[key] = nav.unit;
        }

        await this.prisma.productAttributes.upsert({
          where: { productId: product.id },
          update: {
            normalizedAttributes: normalizedAttrs,
            attributeUnits,
          },
          create: {
            productId: product.id,
            normalizedAttributes: normalizedAttrs,
            attributeUnits,
          },
        });

        // 6. Create InventorySnapshot for time-series tracking
        await this.prisma.inventorySnapshot.create({
          data: {
            supplierListingId: listing.id,
            count: p.inventoryCount,
            price: p.price,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Failed to save product ${p.mpn}: ${message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }
}