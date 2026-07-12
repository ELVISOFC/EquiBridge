import { SupplierAttributeMap } from '@prisma/client';
import {
  detectUnit,
  normalizeAttribute,
  TaxonomyEntry,
} from './units';

export type { NormalizedAttributeValue, TaxonomyEntry } from './units';

/**
 * Canonical normalized product after transformation.
 */
export interface NormalizedProduct {
  mpn: string;
  gtin?: string;
  title: string;
  description?: string;
  category?: string;
  manufacturerName?: string;
  price: number;
  inventoryCount: number;
  normalizedAttributes: Record<string, import('./units').NormalizedAttributeValue>;
  certifications: string[];
  rawPayload: Record<string, any>;
}

// =============================================================================
// DataTransformer
// =============================================================================

export class DataTransformer {
  /**
   * Transforms raw supplier data into a normalized format based on mapping rules
   * and the taxonomy registry for unit normalization.
   *
   * @param rawData      The raw supplier payload
   * @param maps         Attribute mapping rules for this supplier
   * @param taxonomyMap  Optional map of attribute_key → TaxonomyEntry for unit normalization
   */
  static transform(
    rawData: Record<string, any>,
    maps: SupplierAttributeMap[],
    taxonomyMap?: Map<string, TaxonomyEntry>,
  ): NormalizedProduct {
    const result: any = {
      mpn: '',
      title: '',
      normalizedAttributes: {},
      certifications: [],
      rawPayload: { ...rawData },
      inventoryCount: 0,
      price: 0,
    };

    for (const map of maps) {
      let value = this.getValueByPath(rawData, map.sourceAttribute);
      if (value === undefined || value === null) continue;

      if (map.transformationRule) {
        value = this.applyRule(value, map.transformationRule);
      }

      this.setNormalizedValue(result, map.targetAttribute, value, taxonomyMap);
    }

    return result as NormalizedProduct;
  }

  private static getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce(
      (acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined),
      obj,
    );
  }

  private static setNormalizedValue(
    result: any,
    target: string,
    value: any,
    taxonomyMap?: Map<string, TaxonomyEntry>,
  ): void {
    const topLevelFields = [
      'mpn', 'gtin', 'title', 'description',
      'category', 'manufacturerName', 'price', 'inventoryCount',
    ];

    if (target === 'mpn' || target === 'gtin' || target === 'title') {
      result[target] = String(value);
    } else if (
      target === 'description' ||
      target === 'category' ||
      target === 'manufacturerName'
    ) {
      result[target] = String(value);
    } else if (target === 'price' || target === 'inventoryCount') {
      result[target] = Number(value);
    } else if (target === 'certifications') {
      result.certifications = Array.isArray(value)
        ? value.map(String)
        : [String(value)];
    } else {
      // Attribute — normalize using taxonomy if available
      const taxonomy = taxonomyMap?.get(target) || null;
      const normalized = normalizeAttribute(value, taxonomy);
      result.normalizedAttributes[target] = normalized;
    }
  }

  private static applyRule(value: any, rule: string): any {
    switch (rule.toLowerCase()) {
      case 'trim':
        return typeof value === 'string' ? value.trim() : value;
      case 'lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value;
      case 'uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value;
      case 'number':
        return Number(value);
      default:
        return value;
    }
  }
}

// Re-export for convenience
export { detectUnit, convertUnit, normalizeAttribute } from './units';