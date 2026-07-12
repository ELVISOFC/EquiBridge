import { Supplier } from '@prisma/client';
import { IngestionService, IngestionResult } from './base.service';
import { DataTransformer } from './transformer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Type B Ingestion — CSV batch upload (via FTP or manual upload).
 */
export class CsvIngestionService extends IngestionService {
  async ingest(supplier: Supplier): Promise<IngestionResult> {
    console.log(`[CsvIngestion] Starting ingestion for supplier: ${supplier.name} (${supplier.id})`);

    const config = supplier.config as Record<string, any> | null;
    const csvPath = config?.filePath;

    if (!csvPath || !fs.existsSync(csvPath)) {
      return {
        success: false,
        productsCreated: 0,
        listingsCreated: 0,
        errors: [`CSV file not found: ${csvPath}`],
      };
    }

    try {
      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      if (lines.length < 2) {
        return {
          success: false,
          productsCreated: 0,
          listingsCreated: 0,
          errors: ['CSV file has no data rows'],
        };
      }

      // Parse header
      const headers = this.parseCSVLine(lines[0]);
      const maps = await this.getMappings(supplier.id);

      // Parse each row and transform
      const normalizedProducts = [];
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i]);
        if (values.length === 0) continue;

        const rawRow: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
          rawRow[headers[j]] = values[j] || '';
        }

        const normalized = DataTransformer.transform(rawRow, maps);
        normalizedProducts.push(normalized);
      }

      // Save to database
      const result = await this.saveNormalizedProducts(supplier.id, normalizedProducts);
      console.log(
        `[CsvIngestion] Completed for ${supplier.name}: ${result.productsCreated} products, ${result.listingsCreated} listings`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, productsCreated: 0, listingsCreated: 0, errors: [message] };
    }
  }

  /**
   * Simple CSV line parser (handles quoted fields).
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }
}