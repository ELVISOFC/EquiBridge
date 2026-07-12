/**
 * Unit Tests — DataTransformer & Unit Conversion Pipeline
 *
 * Tests the core transformation logic including:
 * - Basic attribute mapping
 * - Unit detection and normalization
 * - Taxonomy registry lookups
 * - Conversion factors (pressure, voltage, temperature, length, weight, torque)
 * - Full pipeline with mock supplier maps
 */

import { describe, it, expect } from 'vitest';
import {
  DataTransformer,
  detectUnit,
  convertUnit,
  normalizeAttribute,
  TaxonomyEntry,
} from '../src/ingestion/transformer';

// ---------------------------------------------------------------------------
// detectUnit
// ---------------------------------------------------------------------------

describe('detectUnit', () => {
  it('should parse "15 bar" as 15 and bar', () => {
    const result = detectUnit('15 bar');
    expect(result.value).toBe(15);
    expect(result.unit).toBe('bar');
  });

  it('should parse "240V" as 240 and V', () => {
    const result = detectUnit('240V');
    expect(result.value).toBe(240);
    expect(result.unit).toBe('V');
  });

  it('should parse "100 psi" as 100 and psi', () => {
    const result = detectUnit('100 psi');
    expect(result.value).toBe(100);
    expect(result.unit).toBe('psi');
  });

  it('should parse "10.5 ft-lb" as 10.5 and ft-lb', () => {
    const result = detectUnit('10.5 ft-lb');
    expect(result.value).toBe(10.5);
    expect(result.unit).toBe('ft-lb');
  });

  it('should parse "217.55" (no unit) as 217.55 and null', () => {
    const result = detectUnit('217.55');
    expect(result.value).toBe(217.55);
    expect(result.unit).toBeNull();
  });

  it('should handle plain numbers', () => {
    const result = detectUnit(42);
    expect(result.value).toBe(42);
    expect(result.unit).toBeNull();
  });

  it('should handle negative values', () => {
    const result = detectUnit('-40 °F');
    expect(result.value).toBe(-40);
    expect(result.unit).toBe('°F');
  });

  it('should return 0 for unparseable strings', () => {
    const result = detectUnit('N/A');
    expect(result.value).toBe(0);
    expect(result.unit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// convertUnit — Pressure
// ---------------------------------------------------------------------------

describe('convertUnit — Pressure', () => {
  it('should convert bar to psi (15 bar → 217.56 psi)', () => {
    const result = convertUnit(15, 'bar', 'psi');
    expect(result).toBe(217.56);
  });

  it('should convert kPa to psi (100 kPa → 14.5 psi)', () => {
    const result = convertUnit(100, 'kPa', 'psi');
    expect(result).toBe(14.5);
  });

  it('should leave psi as-is', () => {
    const result = convertUnit(50, 'psi', 'psi');
    expect(result).toBe(50);
  });

  it('should convert bar to kPa (1 bar → 100 kPa)', () => {
    // 1 bar = 14.5038 psi, 1 kPa = 0.145038 psi → 1 bar / 1 kPa = 14.5038 / 0.145038 = 100
    const result = convertUnit(1, 'bar', 'kPa');
    expect(result).toBeCloseTo(100, 0);
  });
});

// ---------------------------------------------------------------------------
// convertUnit — Voltage
// ---------------------------------------------------------------------------

describe('convertUnit — Voltage', () => {
  it('should convert kV to V (1 kV → 1000 V)', () => {
    const result = convertUnit(1, 'kV', 'V');
    expect(result).toBe(1000);
  });

  it('should convert V to kV (1000 V → 1 kV)', () => {
    const result = convertUnit(1000, 'V', 'kV');
    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// convertUnit — Temperature
// ---------------------------------------------------------------------------

describe('convertUnit — Temperature', () => {
  it('should convert °C to °F (100°C → 212°F)', () => {
    const result = convertUnit(100, '°C', '°F');
    expect(result).toBe(212);
  });

  it('should convert °F to °C (32°F → 0°C)', () => {
    const result = convertUnit(32, '°F', '°C');
    expect(result).toBe(0);
  });

  it('should leave °F as-is', () => {
    const result = convertUnit(100, '°F', '°F');
    expect(result).toBe(100);
  });

  it('-40°C should equal -40°F', () => {
    const result = convertUnit(-40, '°C', '°F');
    expect(result).toBe(-40);
  });
});

// ---------------------------------------------------------------------------
// convertUnit — Length
// ---------------------------------------------------------------------------

describe('convertUnit — Length', () => {
  it('should convert ft to in (1 ft → 12 in)', () => {
    const result = convertUnit(1, 'ft', 'in');
    expect(result).toBe(12);
  });

  it('should convert mm to in (25.4 mm → 1 in)', () => {
    const result = convertUnit(25.4, 'mm', 'in');
    expect(result).toBe(1);
  });

  it('should convert m to in (1 m → 39.37 in)', () => {
    const result = convertUnit(1, 'm', 'in');
    expect(result).toBe(39.37);
  });
});

// ---------------------------------------------------------------------------
// convertUnit — Weight
// ---------------------------------------------------------------------------

describe('convertUnit — Weight', () => {
  it('should convert kg to lbs (1 kg → 2.2 lbs)', () => {
    const result = convertUnit(1, 'kg', 'lbs');
    expect(result).toBeCloseTo(2.2, 1);
  });

  it('should convert oz to lbs (16 oz → 1 lb)', () => {
    const result = convertUnit(16, 'oz', 'lbs');
    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// convertUnit — Torque
// ---------------------------------------------------------------------------

describe('convertUnit — Torque', () => {
  it('should convert Nm to ft-lb (1 Nm → 0.74 ft-lb)', () => {
    const result = convertUnit(1, 'Nm', 'ft-lb');
    expect(result).toBeCloseTo(0.74, 1);
  });
});

// ---------------------------------------------------------------------------
// normalizeAttribute with Taxonomy
// ---------------------------------------------------------------------------

describe('normalizeAttribute', () => {
  const pressureTaxonomy: TaxonomyEntry = {
    attributeKey: 'operating_pressure',
    expectedDataType: 'NUMERIC',
    allowedUnits: ['psi', 'bar', 'kPa'],
    baseUnit: 'psi',
  };

  const materialTaxonomy: TaxonomyEntry = {
    attributeKey: 'material',
    expectedDataType: 'STRING',
    allowedUnits: null,
    baseUnit: null,
  };

  it('should convert "15 bar" to 217.56 psi', () => {
    const result = normalizeAttribute('15 bar', pressureTaxonomy);
    expect(result.value).toBe(217.56);
    expect(result.unit).toBe('psi');
    expect(result.dataType).toBe('NUMERIC');
  });

  it('should keep psi as-is', () => {
    const result = normalizeAttribute('100 psi', pressureTaxonomy);
    expect(result.value).toBe(100);
    expect(result.unit).toBe('psi');
  });

  it('should handle STRING type without conversion', () => {
    const result = normalizeAttribute('carbon steel', materialTaxonomy);
    expect(result.value).toBe(0);
    expect(result.unit).toBeNull();
    expect(result.dataType).toBe('STRING');
  });

  it('should handle unknown taxonomy gracefully', () => {
    const result = normalizeAttribute('1500 RPM', null);
    expect(result.value).toBe(1500);
    expect(result.unit).toBe('RPM');
    expect(result.dataType).toBe('STRING');
  });
});

// ---------------------------------------------------------------------------
// DataTransformer — Full Pipeline
// ---------------------------------------------------------------------------

describe('DataTransformer', () => {
  it('should transform raw data using mapping rules', () => {
    const rawData = {
      product_code: 'PMP-100',
      product_name: 'Industrial Pump',
      spec_price: 499.99,
      spec_volts: '240V',
      spec_pressure: '15 bar',
      spec_material: 'cast iron',
      stock_qty: 25,
    };

    const maps = [
      { id: '1', supplierId: 's1', sourceAttribute: 'product_code', targetAttribute: 'mpn', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
      { id: '2', supplierId: 's1', sourceAttribute: 'product_name', targetAttribute: 'title', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
      { id: '3', supplierId: 's1', sourceAttribute: 'spec_price', targetAttribute: 'price', transformationRule: 'number', createdAt: new Date(), updatedAt: new Date() },
      { id: '4', supplierId: 's1', sourceAttribute: 'stock_qty', targetAttribute: 'inventoryCount', transformationRule: 'number', createdAt: new Date(), updatedAt: new Date() },
      { id: '5', supplierId: 's1', sourceAttribute: 'spec_volts', targetAttribute: 'voltage', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
      { id: '6', supplierId: 's1', sourceAttribute: 'spec_pressure', targetAttribute: 'operating_pressure', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
      { id: '7', supplierId: 's1', sourceAttribute: 'spec_material', targetAttribute: 'material', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
    ];

    const taxonomyMap = new Map<string, TaxonomyEntry>();
    taxonomyMap.set('voltage', {
      attributeKey: 'voltage',
      expectedDataType: 'NUMERIC',
      allowedUnits: ['V', 'kV'],
      baseUnit: 'V',
    });
    taxonomyMap.set('operating_pressure', {
      attributeKey: 'operating_pressure',
      expectedDataType: 'NUMERIC',
      allowedUnits: ['psi', 'bar', 'kPa'],
      baseUnit: 'psi',
    });

    const result = DataTransformer.transform(rawData, maps as any, taxonomyMap);

    expect(result.mpn).toBe('PMP-100');
    expect(result.title).toBe('Industrial Pump');
    expect(result.price).toBe(499.99);
    expect(result.inventoryCount).toBe(25);

    // Normalized attributes with unit conversion
    expect(result.normalizedAttributes.voltage.value).toBe(240);
    expect(result.normalizedAttributes.voltage.unit).toBe('V');

    expect(result.normalizedAttributes.operating_pressure.value).toBe(217.56);
    expect(result.normalizedAttributes.operating_pressure.unit).toBe('psi');

    expect(result.normalizedAttributes.material.value).toBe(0);
    expect(result.normalizedAttributes.material.dataType).toBe('STRING');

    // Raw payload preserved
    expect(result.rawPayload.product_code).toBe('PMP-100');
  });

  it('should handle empty mapping gracefully', () => {
    const result = DataTransformer.transform({ name: 'test' }, []);
    expect(result.mpn).toBe('');
    expect(result.title).toBe('');
  });

  it('should apply transformation rules', () => {
    const rawData = { desc: '  HEAVY-DUTY VALVE  ' };

    const maps = [
      { id: '1', supplierId: 's1', sourceAttribute: 'desc', targetAttribute: 'title', transformationRule: 'trim', createdAt: new Date(), updatedAt: new Date() },
      { id: '2', supplierId: 's1', sourceAttribute: 'desc', targetAttribute: 'description', transformationRule: 'lowercase', createdAt: new Date(), updatedAt: new Date() },
    ];

    const result = DataTransformer.transform(rawData, maps as any);
    expect(result.title).toBe('HEAVY-DUTY VALVE');
    expect(result.description).toBe('  heavy-duty valve  ');
  });

  it('should handle nested source paths', () => {
    const rawData = {
      specs: {
        dimensions: { width: 12, length: 24 },
      },
    };

    const maps = [
      { id: '1', supplierId: 's1', sourceAttribute: 'specs.dimensions.width', targetAttribute: 'width', transformationRule: 'number', createdAt: new Date(), updatedAt: new Date() },
      { id: '2', supplierId: 's1', sourceAttribute: 'specs.dimensions.length', targetAttribute: 'length', transformationRule: 'number', createdAt: new Date(), updatedAt: new Date() },
    ];

    const result = DataTransformer.transform(rawData, maps as any);
    expect(result.normalizedAttributes.width?.value).toBe(12);
    expect(result.normalizedAttributes.length?.value).toBe(24);
  });

  it('should treat missing source paths as undefined', () => {
    const result = DataTransformer.transform({}, [
      { id: '1', supplierId: 's1', sourceAttribute: 'nonexistent.path', targetAttribute: 'title', transformationRule: null, createdAt: new Date(), updatedAt: new Date() },
    ] as any);
    expect(result.title).toBe('');
  });
});