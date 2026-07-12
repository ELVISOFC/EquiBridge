import type { SupplierAttributeMap } from '@prisma/client';

export interface NormalizedProduct {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  price: number;
  specifications: Record<string, any>;
  certifications: string[];
  inventoryCount: number;
}

export class DataTransformer {
  /**
   * Transforms raw supplier data into a normalized format based on mapping rules.
   */
  static transform(rawData: Record<string, any>, maps: SupplierAttributeMap[]): NormalizedProduct {
    const normalized: any = {
      specifications: {},
      certifications: [],
      inventoryCount: 0,
    };

    for (const map of maps) {
      let value = this.getValueByPath(rawData, map.sourceAttribute);
      
      if (value === undefined || value === null) continue;

      if (map.transformationRule) {
        value = this.applyRule(value, map.transformationRule);
      }

      this.setNormalizedValue(normalized, map.targetAttribute, value);
    }

    return normalized as NormalizedProduct;
  }

  private static getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }

  private static setNormalizedValue(normalized: any, target: string, value: any): void {
    const topLevelFields = ['sku', 'name', 'description', 'category', 'price', 'inventoryCount'];
    
    if (topLevelFields.includes(target)) {
      if (target === 'price' || target === 'inventoryCount') {
        normalized[target] = Number(value);
      } else {
        normalized[target] = String(value);
      }
    } else if (target === 'certifications') {
      normalized.certifications = Array.isArray(value) ? value : [String(value)];
    } else {
      // Everything else goes into specifications JSONB
      normalized.specifications[target] = value;
    }
  }

  private static applyRule(value: any, rule: string): any {
    // Simple rules for now: 'trim', 'lowercase', 'uppercase', 'number'
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
