import type { Supplier } from '@prisma/client';
import axios from 'axios';
import { IngestionService } from './base.service';
import { DataTransformer } from './transformer';

export class ApiIngestionService extends IngestionService {
  async ingest(supplier: Supplier): Promise<void> {
    const config = supplier.config as any;
    if (!config?.endpoint) {
      throw new Error(`Supplier ${supplier.id} is missing API endpoint config.`);
    }

    console.log(`Ingesting from API: ${config.endpoint} for supplier ${supplier.name}`);
    
    try {
      // 1. Fetch raw data from supplier API
      const response = await axios.get(config.endpoint, {
        headers: {
          'Authorization': config.apiKey ? `Bearer ${config.apiKey}` : undefined,
          'Accept': 'application/json',
          ...(config.headers || {})
        },
      });

      // Handle both direct array or wrapped data (e.g. { products: [...] })
      let rawProducts = response.data;
      if (config.dataPath) {
        rawProducts = config.dataPath.split('.').reduce((acc: any, part: string) => acc && acc[part], response.data);
      }

      if (!Array.isArray(rawProducts)) {
        throw new Error(`API response for ${supplier.name} did not result in an array. dataPath: ${config.dataPath || 'root'}`);
      }

      // 2. Get mapping rules from DB
      const maps = await this.getMappings(supplier.id);

      // 3. Transform each raw product into our canonical format
      const normalizedProducts = rawProducts.map(raw => DataTransformer.transform(raw, maps));
      
      // 4. Persistence
      await this.saveNormalizedProducts(supplier.id, normalizedProducts);
      
    } catch (err) {
      console.error(`API Ingestion failed for ${supplier.name}:`, err);
      throw err;
    }
  }
}
