import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CsvIngestionService } from './csv.service';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { SupplierType } from '@prisma/client';

vi.mock('fs');
vi.mock('csv-parse/sync');

describe('CsvIngestionService', () => {
  let prisma: any;
  let service: CsvIngestionService;

  beforeEach(() => {
    prisma = {
      supplierAttributeMap: {
        findMany: vi.fn(),
      },
      product: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      supplierSku: {
        upsert: vi.fn(),
      },
      inventorySnapshot: {
        create: vi.fn(),
      },
    };
    service = new CsvIngestionService(prisma as any);
  });

  it('should ingest products from CSV', async () => {
    const supplier: any = {
      id: 's2',
      name: 'Supplier B',
      type: SupplierType.FTP_CSV,
      config: { filePath: '/path/to/file.csv' }
    };

    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('csv content');
    (parse as any).mockReturnValue([
      { sku: 'CSV1', name: 'CSV Product', price: '50' }
    ]);

    prisma.supplierAttributeMap.findMany.mockResolvedValue([
      { sourceAttribute: 'sku', targetAttribute: 'sku' },
      { sourceAttribute: 'name', targetAttribute: 'name' },
      { sourceAttribute: 'price', targetAttribute: 'price', transformationRule: 'number' },
    ]);
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.product.create.mockResolvedValue({ id: 'p2' });
    prisma.supplierSku.upsert.mockResolvedValue({ id: 'ss2' });

    await service.ingest(supplier);

    expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/file.csv', 'utf-8');
    expect(prisma.product.create).toHaveBeenCalled();
    expect(prisma.supplierSku.upsert).toHaveBeenCalled();
  });
});
