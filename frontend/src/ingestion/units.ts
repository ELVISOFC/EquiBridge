/**
 * UnitConverter — Standalone module for unit detection, conversion, and normalization.
 *
 * Used by the DataTransformer during catalog ingestion to normalize supplier attribute
 * values into base units defined in the taxonomy_attributes registry.
 *
 * Supports 6 unit families:
 *   - pressure:    psi ↔ bar ↔ kPa
 *   - voltage:     V ↔ kV
 *   - temperature: °F ↔ °C
 *   - length:      in ↔ ft ↔ mm ↔ cm ↔ m
 *   - weight:      lbs ↔ kg ↔ oz
 *   - torque:      ft-lb ↔ Nm
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedValue {
  value: number;
  unit: string | null;
}

export interface NormalizedAttributeValue {
  value: number | string;
  unit: string | null;
  dataType: 'NUMERIC' | 'STRING';
}

export interface TaxonomyEntry {
  attributeKey: string;
  expectedDataType: 'NUMERIC' | 'STRING';
  allowedUnits: string[] | null;
  baseUnit: string | null;
}

// ---------------------------------------------------------------------------
// Unit Family Registry
// ---------------------------------------------------------------------------

interface UnitFamily {
  base: string;
  factors: Record<string, number>; // conversion factor to this family's base
}

const UNIT_FAMILIES: Record<string, UnitFamily> = {
  pressure: {
    base: 'psi',
    factors: { psi: 1, bar: 14.5038, kPa: 0.145038, kpa: 0.145038 },
  },
  voltage: {
    base: 'V',
    factors: { V: 1, v: 1, kV: 1000, kv: 1000 },
  },
  length: {
    base: 'in',
    factors: { in: 1, '"': 1, ft: 12, mm: 0.0393701, cm: 0.393701, m: 39.3701 },
  },
  weight: {
    base: 'lbs',
    factors: { lbs: 1, lb: 1, kg: 2.20462, oz: 0.0625 },
  },
  torque: {
    base: 'ft-lb',
    factors: { 'ft-lb': 1, nm: 0.737562 },
  },
  flow: {
    base: 'GPM',
    factors: { gpm: 1, lpm: 0.264172 },
  },
};

// For temperature, simple factors don't work — handled specially in convertUnit

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw attribute value string to extract the numeric value and unit.
 *
 * Supports formats like:
 *   "15 bar"     → { value: 15,  unit: "bar" }
 *   "240V"       → { value: 240, unit: "V" }
 *   "100 psi"    → { value: 100, unit: "psi" }
 *   "10.5 ft-lb" → { value: 10.5, unit: "ft-lb" }
 *   "217.55"     → { value: 217.55, unit: null }
 */
export function detectUnit(rawValue: string | number): DetectedValue {
  if (typeof rawValue === 'number') return { value: rawValue, unit: null };
  if (typeof rawValue !== 'string') return { value: Number(rawValue) || 0, unit: null };

  const match = rawValue.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z°"'-].*)?$/);
  if (!match) return { value: Number(rawValue) || 0, unit: null };

  return {
    value: parseFloat(match[1]),
    unit: match[2]?.trim() || null,
  };
}

/**
 * Check whether a unit string represents temperature.
 */
function isTemperatureUnit(unit: string): boolean {
  return ['°F', 'F', '°C', 'C', 'fahrenheit', 'celsius'].includes(unit);
}

/**
 * Convert a value from sourceUnit to targetBaseUnit.
 *
 * For temperature, uses °F = °C × 9/5 + 32 (and inverse).
 * For all other families, uses conversion factors: result = value × sourceFactor / targetFactor.
 *
 * If the units are not recognized or not in the same family, the value is returned unchanged.
 */
export function convertUnit(
  value: number,
  sourceUnit: string,
  targetBaseUnit: string,
): number {
  const src = sourceUnit.trim();
  const tgt = targetBaseUnit.trim();

  // --- Temperature (special formula-based conversion) ---
  if (isTemperatureUnit(src) && isTemperatureUnit(tgt)) {
    const toFahrenheit = (v: number) => parseFloat(((v * 9) / 5 + 32).toFixed(2));
    const toCelsius = (v: number) => parseFloat((((v - 32) * 5) / 9).toFixed(2));

    const srcIsC = src === '°C' || src === 'C' || src === 'celsius';
    const tgtIsC = tgt === '°C' || tgt === 'C' || tgt === 'celsius';

    if (srcIsC && !tgtIsC) return toFahrenheit(value);
    if (!srcIsC && tgtIsC) return toCelsius(value);
    return value;
  }

  // --- Find the unit family containing both source and target ---
  const srcKey = src.toLowerCase();
  const tgtKey = tgt.toLowerCase();

  let family: UnitFamily | undefined;

  for (const [, f] of Object.entries(UNIT_FAMILIES)) {
    const keys = Object.keys(f.factors).map((k) => k.toLowerCase());
    if ((keys.includes(srcKey) || f.base.toLowerCase() === srcKey) &&
        (keys.includes(tgtKey) || f.base.toLowerCase() === tgtKey)) {
      family = f;
      break;
    }
  }

  if (!family) return value;

  // Look up factors
  const sourceFactor = family.factors[src] ?? family.factors[srcKey] ?? null;
  const targetFactor = family.factors[tgt] ?? family.factors[tgtKey] ?? 1;

  if (sourceFactor === null) return value;

  return parseFloat(((value * sourceFactor) / targetFactor).toFixed(2));
}

/**
 * Normalize a single attribute value using the taxonomy registry.
 *
 * - If the taxonomy entry exists and is NUMERIC: detect the unit from the raw value,
 *   convert to the base unit, return the normalized number with base unit.
 * - If STRING or no taxonomy: return the value as-is as a string with original unit.
 */
export function normalizeAttribute(
  rawValue: any,
  taxonomy: TaxonomyEntry | null,
): NormalizedAttributeValue {
  const detected = detectUnit(String(rawValue));

  if (!taxonomy || taxonomy.expectedDataType === 'STRING') {
    return {
      value: detected.value,
      unit: detected.unit || taxonomy?.baseUnit || null,
      dataType: 'STRING',
    };
  }

  // NUMERIC type — perform unit conversion
  if (taxonomy.baseUnit && detected.unit) {
    const converted = convertUnit(detected.value, detected.unit, taxonomy.baseUnit);
    return {
      value: converted,
      unit: taxonomy.baseUnit,
      dataType: 'NUMERIC',
    };
  }

  return {
    value: detected.value,
    unit: taxonomy.baseUnit || detected.unit,
    dataType: 'NUMERIC',
  };
}