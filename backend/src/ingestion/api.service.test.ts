import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ApiIngestionService } from './api.service';
import axios from 'axios';
import { SupplierType } from '@prisma/client';

vi.mock('axios');
const mockedAxios = axios as any;

describe('ApiIngestionService', () => {
  let prisma: any;
  let service: ApiIngestionService;

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
    service = new ApiIngestionService(prisma as any);
  });

  it('should ingest products from API', async () => {
    const supplier: any = {
      id: 's1',
      name: 'Supplier A',
      type: SupplierType.API,
      config: { endpoint: 'https://api.supplier.com/products', apiKey: 'key' }
    };

    const rawData = [
      { id: 'SKU1', name: 'Product 1', price: 100 }
    ];

    mockedAxios.get.mockResolvedValue({ data: rawData });
    prisma.supplierAttributeMap.findMany.mockResolvedValue([
      { sourceAttribute: 'id', targetAttribute: 'sku' },
      { sourceAttribute: 'name', targetAttribute: 'name' },
      { sourceAttribute: 'price', targetAttribute: 'price' },
    ]);
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.product.create.mockResolvedValue({ id: 'p1' });
    prisma.supplierSku.upsert.mockResolvedValue({ id: 'ss1' });

    await service.ingest(supplier);

    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.supplier.com/products', expect.any(Object));
    expect(prisma.product.create).toHaveBeenCalled();
    expect(prisma.supplierSku.upsert).toHaveBeenCalled();
    expect(prisma.inventorySnapshot.create).toHaveBeenCalled();
  });
});
