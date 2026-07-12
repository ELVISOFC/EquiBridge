import type { Supplier } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import { IngestionService } from './base.service';
import { DataTransformer } from './transformer';

export class CsvIngestionService extends IngestionService {
  async ingest(supplier: Supplier): Promise<void> {
    const config = supplier.config as any;
    if (!config?.filePath) {
      throw new Error(`Supplier ${supplier.id} is missing file path config.`);
    }

    console.log(`Ingesting from CSV: ${config.filePath} for supplier ${supplier.name}`);

    try {
      // 1. Read and parse CSV
      if (!fs.existsSync(config.filePath)) {
        throw new Error(`CSV file not found at ${config.filePath}`);
      }
      
      const content = fs.readFileSync(config.filePath, 'utf-8');
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        ...(config.csvOptions || {})
      });

      if (!Array.isArray(records)) {
        throw new Error(`CSV parsing for ${supplier.name} did not result in an array.`);
      }

      // 2. Get mapping rules
      const maps = await this.getMappings(supplier.id);

      // 3. Transform
      const normalizedProducts = records.map(raw => DataTransformer.transform(raw, maps));

      // 4. Persistence
      await this.saveNormalizedProducts(supplier.id, normalizedProducts);
      
    } catch (err) {
      console.error(`CSV Ingestion failed for ${supplier.name}:`, err);
      throw err;
    }
  }
}
