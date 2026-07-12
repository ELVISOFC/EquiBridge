import { describe, it, expect } from 'vitest';
import { DataTransformer } from './transformer';

describe('DataTransformer', () => {
  it('should transform raw data based on mapping rules', () => {
    const rawData = {
      sku_code: 'TEST-SKU',
      title: 'Test Product',
      details: {
        voltage_v: '220V',
        power_hp: '1.5'
      },
      qty: 50
    };

    const maps: any[] = [
      { id: '1', supplierId: 's1', sourceAttribute: 'sku_code', targetAttribute: 'sku', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
      { id: '2', supplierId: 's1', sourceAttribute: 'title', targetAttribute: 'name', transformationRule: 'uppercase', createdAt: new Date(), updatedAt: new Date() },
      { id: '3', supplierId: 's1', sourceAttribute: 'details.voltage_v', targetAttribute: 'voltage', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
      { id: '4', supplierId: 's1', sourceAttribute: 'qty', targetAttribute: 'inventoryCount', transformationRule: 'number', createdAt: new Date(), updatedAt: new Date() }
    ];

    const result = DataTransformer.transform(rawData, maps);

    expect(result.sku).toBe('TEST-SKU');
    expect(result.name).toBe('TEST PRODUCT');
    expect(result.specifications.voltage).toBe('220V');
    expect(result.inventoryCount).toBe(50);
  });

  it('should handle nested paths correctly', () => {
    const rawData = {
      a: { b: { c: 'deep value' } }
    };
    const maps: any[] = [
      { id: '1', supplierId: 's1', sourceAttribute: 'a.b.c', targetAttribute: 'sku', transformationRule: null, createdAt: new Date(), updatedAt: new Date() }
    ];
    const result = DataTransformer.transform(rawData, maps);
    expect(result.sku).toBe('deep value');
  });

  it('should apply transformation rules (trim, lowercase, uppercase, number)', () => {
    const rawData = {
      val1: '  trimmed  ',
      val2: 'LOWER',
      val3: 'upper',
      val4: '123.45'
    };
    const maps: any[] = [
      { id: '1', supplierId: 's1', sourceAttribute: 'val1', targetAttribute: 'attr1', transformationRule: 'trim', createdAt: new Date(), updatedAt: new Date() },
      { id: '2', supplierId: 's1', sourceAttribute: 'val2', targetAttribute: 'attr2', transformationRule: 'lowercase', createdAt: new Date(), updatedAt: new Date() },
      { id: '3', supplierId: 's1', sourceAttribute: 'val3', targetAttribute: 'attr3', transformationRule: 'uppercase', createdAt: new Date(), updatedAt: new Date() },
      { id: '4', supplierId: 's1', sourceAttribute: 'val4', targetAttribute: 'price', transformationRule: 'number', createdAt: new Date(), updatedAt: new Date() }
    ];
    const result = DataTransformer.transform(rawData, maps);
    expect(result.specifications.attr1).toBe('trimmed');
    expect(result.specifications.attr2).toBe('lower');
    expect(result.specifications.attr3).toBe('UPPER');
    expect(result.price).toBe(123.45);
  });
});
