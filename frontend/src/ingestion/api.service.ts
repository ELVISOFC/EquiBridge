import { Supplier } from '@prisma/client';
import { IngestionService, IngestionResult } from './base.service';
import { DataTransformer } from './transformer';

/**
 * Type A Ingestion — REST API integration (polled every 15 minutes).
 */
export class ApiIngestionService extends IngestionService {
  async ingest(supplier: Supplier): Promise<IngestionResult> {
    console.log(`[ApiIngestion] Starting ingestion for supplier: ${supplier.name} (${supplier.id})`);

    const config = supplier.config as Record<string, any> | null;
    if (!config?.url) {
      return { success: false, productsCreated: 0, listingsCreated: 0, errors: ['No API URL configured'] };
    }

    try {
      // Fetch data from supplier API
      const response = await fetch(config.url, {
        method: 'GET',
        headers: {
          Authorization: config.apiKey ? `Bearer ${config.apiKey}` : '',
          'Content-Type': 'application/json',
          ...(config.headers || {}),
        },
      });

      if (!response.ok) {
        return {
          success: false,
          productsCreated: 0,
          listingsCreated: 0,
          errors: [`API returned ${response.status}`],
        };
      }

      const data = await response.json();
      const items = Array.isArray(data) ? data : data?.products || data?.items || [];

      // Load mapping rules and taxonomy
      const maps = await this.getMappings(supplier.id);

      // Transform each item
      const normalizedProducts = items.map((item: any) =>
        DataTransformer.transform(item, maps),
      );

      // Save to database
      const result = await this.saveNormalizedProducts(supplier.id, normalizedProducts);
      console.log(
        `[ApiIngestion] Completed for ${supplier.name}: ${result.productsCreated} products, ${result.listingsCreated} listings`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, productsCreated: 0, listingsCreated: 0, errors: [message] };
    }
  }
}