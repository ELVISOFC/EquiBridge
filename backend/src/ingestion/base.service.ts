import { PrismaClient } from '@prisma/client';
import type { Supplier, SupplierAttributeMap } from '@prisma/client';
import { DataTransformer } from './transformer';
import type { NormalizedProduct } from './transformer';

export abstract class IngestionService {
  protected prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Main entry point for ingesting a supplier's catalog.
   */
  abstract ingest(supplier: Supplier): Promise<void>;

  protected async getMappings(supplierId: string): Promise<SupplierAttributeMap[]> {
    return this.prisma.supplierAttributeMap.findMany({
      where: { supplierId },
    });
  }

  /**
   * Processes and saves normalized products to the database.
   */
  protected async saveNormalizedProducts(supplierId: string, products: NormalizedProduct[]): Promise<void> {
    console.log(`Saving ${products.length} products for supplier ${supplierId}`);
    
    for (const p of products) {
      try {
        // 1. Match or create a canonical Product
        // For the MVP, we'll use the product name as a simple matching key.
        let product = await this.prisma.product.findFirst({
          where: { name: p.name }
        });

        if (!product) {
          product = await this.prisma.product.create({
            data: {
              name: p.name,
              description: p.description,
              category: p.category,
              specifications: p.specifications,
              certifications: p.certifications,
            },
          });
        } else {
          // Update product info (enrichment)
          await this.prisma.product.update({
            where: { id: product.id },
            data: {
              description: p.description || product.description,
              category: p.category || product.category,
              // Merge specifications
              specifications: {
                ...(product.specifications as object),
                ...p.specifications
              },
            }
          });
        }

        // 2. Upsert SupplierSku
        const supplierSku = await this.prisma.supplierSku.upsert({
          where: {
            supplierId_sku: {
              supplierId: supplierId,
              sku: p.sku,
            },
          },
          update: {
            price: p.price,
            inventoryCount: p.inventoryCount,
            productId: product.id,
          },
          create: {
            supplierId: supplierId,
            sku: p.sku,
            price: p.price,
            inventoryCount: p.inventoryCount,
            productId: product.id,
          },
        });

        // 3. Create Inventory Snapshot for historical tracking
        await this.prisma.inventorySnapshot.create({
          data: {
            supplierSkuId: supplierSku.id,
            count: p.inventoryCount,
            price: p.price,
          },
        });
      } catch (err) {
        console.error(`Failed to save product ${p.sku}:`, err);
      }
    }
  }
}
