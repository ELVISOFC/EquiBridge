// ────────────────────────────────────────────────
// EquiBridge — Freight Rate Calculation Utilities
// ────────────────────────────────────────────────

import type { Dimensions, FreightLineItem, DimensionalWeight, FreightClass } from "../types/freight.js";

/**
 * Standard LTL dimensional weight factor (166 for domestic US).
 * International uses 139.
 */
export const DOMESTIC_DIM_FACTOR = 166;

/**
 * Calculate dimensional weight for a single set of dimensions.
 *
 * Dimensional weight = (L × W × H) / dimFactor
 * Rounded up to the nearest pound.
 */
export function calculateDimensionalWeight(
  dims: Dimensions,
  dimFactor: number = DOMESTIC_DIM_FACTOR,
): number {
  const cubicInches = dims.lengthIn * dims.widthIn * dims.heightIn;
  return Math.ceil(cubicInches / dimFactor);
}

/**
 * Calculate billable weight for a single line item.
 * The greater of actual weight vs dimensional weight.
 */
export function calculateBillableWeight(
  item: FreightLineItem,
  dimFactor: number = DOMESTIC_DIM_FACTOR,
): DimensionalWeight {
  const actualWeightLb = item.weightLb;
  const dimensionalWeightLb = calculateDimensionalWeight(item.dimensions, dimFactor);
  const billable = Math.max(actualWeightLb, dimensionalWeightLb);

  return {
    actualWeightLb,
    dimensionalWeightLb,
    billableWeightLb: billable,
    dimFactor,
  };
}

/**
 * Calculate total billable weight across all items in a shipment.
 * Billable weight is the *per-item* billable weight × quantity summed.
 */
export function calculateTotalBillableWeight(
  items: FreightLineItem[],
  dimFactor: number = DOMESTIC_DIM_FACTOR,
): { totalWeightLb: number; itemWeights: DimensionalWeight[] } {
  const itemWeights = items.map((item) => calculateBillableWeight(item, dimFactor));
  const totalWeightLb = itemWeights.reduce(
    (sum, w, i) => sum + w.billableWeightLb * items[i].quantity,
    0,
  );
  return { totalWeightLb, itemWeights };
}

/**
 * Get the "cube" (total cubic feet) for a shipment.
 * Useful for space-based carrier rate adjustments.
 */
export function calculateTotalCube(items: FreightLineItem[]): number {
  const totalCuIn = items.reduce(
    (sum, item) =>
      sum + item.dimensions.lengthIn * item.dimensions.widthIn * item.dimensions.heightIn * item.quantity,
    0,
  );
  return totalCuIn / 1728; // cubic inches → cubic feet
}

/**
 * Rate adjustment factor based on freight class.
 * Higher class = higher cost per hundredweight (CWT).
 *
 * These are example factors for a model carrier. Real implementations
 * would pull these from a carrier rate table or API.
 */
export function freightClassRateFactor(freightClass: FreightClass): number {
  // Base factor at class 100 = 1.0
  const factors: Record<number, number> = {
    50:   0.40,
    55:   0.48,
    60:   0.56,
    65:   0.64,
    70:   0.72,
    77.5: 0.85,
    85:   0.92,
    92.5: 0.96,
    100:  1.00,
    110:  1.10,
    125:  1.25,
    150:  1.50,
    175:  1.75,
    200:  2.00,
    250:  2.50,
    300:  3.00,
    400:  4.00,
    500:  5.00,
  };
  return factors[freightClass] ?? 1.0;
}

/**
 * Fuel surcharge percentage based on national average diesel price.
 * Real implementation would poll EIA weekly data; this is a simplified model.
 *
 * @param dieselPricePerGallon — Current national average diesel price in USD
 */
export function calculateFuelSurchargePercent(dieselPricePerGallon: number): number {
  // Common LTL fuel surcharge formula:
  // Base threshold = $1.20/gal (historically), surcharge = (current - threshold) * 0.01 per $0.05
  // Simplified: every $0.05 above $1.20 adds 1%
  const threshold = 1.20;
  if (dieselPricePerGallon <= threshold) return 0;
  const centsAbove = (dieselPricePerGallon - threshold) / 0.05;
  return Math.round(centsAbove * 1.0 * 100) / 100; // percentage points
}

/**
 * Calculate base rate per hundredweight (CWT) for an origin-destination pair.
 *
 * Uses a simple distance-and-density model. Real implementation would query
 * a carrier rate table / tariff API.
 *
 * @param distanceMi — Great-circle or road distance in miles
 * @param freightClass — Dominant freight class
 * @param totalWeightLb — Total billable weight
 */
export function calculateBaseRatePerCwt(
  distanceMi: number,
  freightClass: FreightClass,
  totalWeightLb: number,
): number {
  // Base CWT rate for class 100 at 250 miles
  const BASE_RATE = 12.50; // $/cwt
  const BASE_DISTANCE = 250;
  const BASE_WEIGHT = 1000; // lb threshold for minimum charge

  // Distance factor: roughly linear with diminishing marginal cost at long distances
  const distanceFactor = Math.pow(distanceMi / BASE_DISTANCE, 0.85);

  // Weight discount: heavier shipments get better rates per cwt
  const weightDiscount = totalWeightLb < 500 ? 1.35
    : totalWeightLb < 1000 ? 1.15
    : totalWeightLb < 5000 ? 1.00
    : totalWeightLb < 10000 ? 0.88
    : totalWeightLb < 20000 ? 0.78
    : 0.70;

  // Class factor
  const classFactor = freightClassRateFactor(freightClass);

  return BASE_RATE * distanceFactor * weightDiscount * classFactor;
}

/**
 * Accessorial fee schedule (example rates).
 * Real implementations would use carrier-specific tariff.
 */
export function calculateAccessorialFees(
  services: {
    liftGatePickup?: boolean;
    liftGateDelivery?: boolean;
    insideDelivery?: boolean;
    insidePickup?: boolean;
    residentialDelivery?: boolean;
    residentialPickup?: boolean;
    limitedAccessDelivery?: boolean;
    appointmentRequired?: boolean;
    tradeShowDelivery?: boolean;
    constructionSiteDelivery?: boolean;
    preDeliveryNotification?: boolean;
  },
): { name: string; amountUsd: number }[] {
  const fees: { name: string; amountUsd: number }[] = [];

  if (services.liftGatePickup) fees.push({ name: "Liftgate Pickup", amountUsd: 85.00 });
  if (services.liftGateDelivery) fees.push({ name: "Liftgate Delivery", amountUsd: 95.00 });
  if (services.insidePickup) fees.push({ name: "Inside Pickup", amountUsd: 65.00 });
  if (services.insideDelivery) fees.push({ name: "Inside Delivery", amountUsd: 75.00 });
  if (services.residentialPickup) fees.push({ name: "Residential Pickup", amountUsd: 35.00 });
  if (services.residentialDelivery) fees.push({ name: "Residential Delivery", amountUsd: 45.00 });
  if (services.limitedAccessDelivery) fees.push({ name: "Limited Access Delivery", amountUsd: 85.00 });
  if (services.appointmentRequired) fees.push({ name: "Appointment Required", amountUsd: 50.00 });
  if (services.tradeShowDelivery) fees.push({ name: "Trade Show Delivery", amountUsd: 120.00 });
  if (services.constructionSiteDelivery) fees.push({ name: "Construction Job-Site Delivery", amountUsd: 100.00 });
  if (services.preDeliveryNotification) fees.push({ name: "Pre-Delivery Notification", amountUsd: 15.00 });

  return fees;
}