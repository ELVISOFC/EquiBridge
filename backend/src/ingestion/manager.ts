import { PrismaClient, SupplierType } from '@prisma/client';
import type { Supplier } from '@prisma/client';
import { ApiIngestionService } from './api.service';
import { CsvIngestionService } from './csv.service';
import { IngestionService } from './base.service';

export class IngestionManager {
  private prisma: PrismaClient;
  private services: Record<string, IngestionService>;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.services = {
      [SupplierType.API]: new ApiIngestionService(prisma),
      [SupplierType.FTP_CSV]: new CsvIngestionService(prisma),
    };
  }

  async runAll(): Promise<void> {
    const suppliers = await this.prisma.supplier.findMany();
    console.log(`Starting ingestion for ${suppliers.length} suppliers`);

    for (const supplier of suppliers) {
      const service = this.services[supplier.type];
      if (service) {
        try {
          await service.ingest(supplier);
        } catch (err) {
          console.error(`Failed to ingest supplier ${supplier.name}:`, err);
        }
      } else {
        console.warn(`No ingestion service for type ${supplier.type} (supplier: ${supplier.name})`);
      }
    }
  }

  async runForSupplier(supplierId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      throw new Error(`Supplier with ID ${supplierId} not found`);
    }

    const service = this.services[supplier.type];
    if (!service) {
      throw new Error(`No ingestion service for type ${supplier.type}`);
    }

    await service.ingest(supplier);
  }
}
