// ────────────────────────────────────────────────
// EquiBridge — LTL Freight Engine
// ────────────────────────────────────────────────

import type {
  LtlQuoteRequest,
  LtlQuoteResponse,
  CarrierQuote,
  FreightLineItem,
  FreightClass,
  AccessorialServices,
} from "../types/freight.js";
import {
  DEFAULT_ACCESSORIALS,
} from "../types/freight.js";
import {
  calculateTotalBillableWeight,
  calculateBaseRatePerCwt,
  calculateAccessorialFees,
  calculateFuelSurchargePercent,
  calculateTotalCube,
} from "./rates.js";

// ─── Carrier Profile ────────────────────────────

interface CarrierProfile {
  name: string;
  scac: string;
  serviceLevel: string;
  /** Market coverage: base rate multiplier per carrier (their pricing competitiveness) */
  rateMultiplier: number;
  /** Fuel surcharge basis: how this carrier handles fuel */
  fuelSurchargeBasis: "percent_of_net" | "flat_per_mile";
  fuelSurchargeRate: number; // percentage or $/mile depending on basis
  /** Max weight they accept in a single shipment (lb) */
  maxWeightLb: number;
  /** Max cubic feet they accept */
  maxCubeCuFt: number;
  /** Whether they offer guaranteed services */
  offersGuaranteed: boolean;
  /** Minimum charge floor */
  minimumChargeUsd: number;
  /** Transit time matrix keyed by distance bands (miles) */
  transitDays: (distanceMi: number) => string;
  /** Service area: ZIP code prefixes they serve */
  serviceArea: string[]; // ["0", "1", "2", ...] — all if ["*"]
  /** Accessorials this carrier can fulfill */
  supportedAccessorials: (keyof AccessorialServices)[];
}

// ─── Default Carrier Profiles ─────────────────────

const DEFAULT_CARRIERS: CarrierProfile[] = [
  {
    name: "Old Dominion Freight Line",
    scac: "ODFL",
    serviceLevel: "Standard LTL",
    rateMultiplier: 1.00,
    fuelSurchargeBasis: "percent_of_net",
    fuelSurchargeRate: 0,
    maxWeightLb: 45000,
    maxCubeCuFt: 3200,
    offersGuaranteed: true,
    minimumChargeUsd: 89.00,
    transitDays: (d: number) =>
      d < 250 ? "1-2" : d < 600 ? "2-3" : d < 1200 ? "3-4" : "4-6",
    serviceArea: ["*"],
    supportedAccessorials: [
      "liftGatePickup", "liftGateDelivery", "insideDelivery", "insidePickup",
      "residentialDelivery", "residentialPickup", "limitedAccessDelivery",
      "appointmentRequired", "constructionSiteDelivery", "preDeliveryNotification",
    ],
  },
  {
    name: "XPO Logistics",
    scac: "XPOL",
    serviceLevel: "Standard LTL",
    rateMultiplier: 0.95,
    fuelSurchargeBasis: "percent_of_net",
    fuelSurchargeRate: 0,
    maxWeightLb: 40000,
    maxCubeCuFt: 3000,
    offersGuaranteed: true,
    minimumChargeUsd: 85.00,
    transitDays: (d: number) =>
      d < 300 ? "1-2" : d < 700 ? "2-3" : d < 1400 ? "3-5" : "5-7",
    serviceArea: ["*"],
    supportedAccessorials: [
      "liftGatePickup", "liftGateDelivery", "insideDelivery",
      "residentialDelivery", "residentialPickup", "limitedAccessDelivery",
      "appointmentRequired", "constructionSiteDelivery",
    ],
  },
  {
    name: "Estes Express Lines",
    scac: "ESTE",
    serviceLevel: "Standard LTL",
    rateMultiplier: 0.97,
    fuelSurchargeBasis: "percent_of_net",
    fuelSurchargeRate: 0,
    maxWeightLb: 50000,
    maxCubeCuFt: 3500,
    offersGuaranteed: true,
    minimumChargeUsd: 87.00,
    transitDays: (d: number) =>
      d < 200 ? "1" : d < 500 ? "2" : d < 1000 ? "3" : "4-6",
    serviceArea: ["*"],
    supportedAccessorials: [
      "liftGatePickup", "liftGateDelivery", "insideDelivery",
      "residentialDelivery", "residentialPickup", "limitedAccessDelivery",
      "appointmentRequired", "constructionSiteDelivery", "tradeShowDelivery",
    ],
  },
  {
    name: "Saia LTL Freight",
    scac: "SAIA",
    serviceLevel: "Standard LTL",
    rateMultiplier: 0.98,
    fuelSurchargeBasis: "percent_of_net",
    fuelSurchargeRate: 0,
    maxWeightLb: 40000,
    maxCubeCuFt: 2800,
    offersGuaranteed: true,
    minimumChargeUsd: 83.00,
    transitDays: (d: number) =>
      d < 250 ? "1-2" : d < 550 ? "2-3" : d < 1100 ? "3-4" : "4-6",
    serviceArea: ["*"],
    supportedAccessorials: [
      "liftGatePickup", "liftGateDelivery", "insideDelivery",
      "residentialDelivery", "residentialPickup", "limitedAccessDelivery",
      "appointmentRequired", "constructionSiteDelivery",
    ],
  },
  {
    name: "FedEx Freight",
    scac: "FXFE",
    serviceLevel: "Priority LTL",
    rateMultiplier: 1.08,
    fuelSurchargeBasis: "percent_of_net",
    fuelSurchargeRate: 0,
    maxWeightLb: 30000,
    maxCubeCuFt: 2500,
    offersGuaranteed: false,
    minimumChargeUsd: 95.00,
    transitDays: (d: number) =>
      d < 250 ? "1" : d < 600 ? "2" : d < 1200 ? "3" : "3-5",
    serviceArea: ["*"],
    supportedAccessorials: [
      "liftGateDelivery", "insideDelivery",
      "residentialDelivery", "residentialPickup", "limitedAccessDelivery",
      "appointmentRequired",
    ],
  },
];

// ─── Distance Estimation ─────────────────────────

/**
 * Approximate distance between two US ZIP codes using centroid-based
 * lookup tables. Real implementation would use a geocoding service
 * (e.g. Google Maps, Mapbox) for driving distance.
 *
 * For now, uses a ZIP → lat/lng lookup of the first digit as a crude proxy.
 */
const ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "0": { lat: 44.5, lng: -71.5 },    // Northeast (ME, NH, VT, MA, RI, CT)
  "1": { lat: 40.8, lng: -74.0 },    // NY, NJ, PA, DE
  "2": { lat: 38.5, lng: -77.5 },    // VA, MD, DC, WV, NC
  "3": { lat: 33.8, lng: -84.5 },    // GA, FL, AL, MS, TN, SC
  "4": { lat: 39.0, lng: -83.5 },    // OH, KY, IN, MI
  "5": { lat: 42.5, lng: -93.0 },    // IA, MN, WI, ND, SD, MT
  "6": { lat: 41.5, lng: -89.0 },    // IL, MO, NE, KS
  "7": { lat: 32.0, lng: -94.0 },    // AR, LA, OK, TX
  "8": { lat: 39.5, lng: -107.0 },   // CO, WY, UT, NV, AZ, NM
  "9": { lat: 37.5, lng: -120.5 },   // CA, OR, WA, ID, AK, HI
};

function zipToCentroid(zip: string): { lat: number; lng: number } {
  const prefix = zip.charAt(0);
  return ZIP_CENTROIDS[prefix] ?? ZIP_CENTROIDS["0"];
}

/**
 * Estimate great-circle distance between two ZIP codes in miles.
 */
export function estimateDistanceByZip(zip1: string, zip2: string): number {
  const a = zipToCentroid(zip1);
  const b = zipToCentroid(zip2);

  // Haversine formula
  const R = 3959; // Earth radius in miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Determine the dominant freight class in a shipment (the class with the
 * highest billable weight).
 */
function dominantFreightClass(items: FreightLineItem[]): FreightClass {
  const { itemWeights } = calculateTotalBillableWeight(items);
  let maxWeight = 0;
  let dominant: FreightClass = 100;

  for (let i = 0; i < items.length; i++) {
    const billable = itemWeights[i].billableWeightLb * items[i].quantity;
    if (billable > maxWeight) {
      maxWeight = billable;
      dominant = items[i].freightClass;
    }
  }
  return dominant;
}

// ─── LTL Freight Engine ──────────────────────────

export interface LtlFreightEngineOptions {
  /** Custom carrier profiles (overrides defaults) */
  carriers?: CarrierProfile[];
  /** Current diesel price per gallon for fuel surcharge calc */
  dieselPricePerGallon?: number;
  /** Freight margin markup as a decimal (e.g. 0.12 = 12%) */
  freightMargin?: number;
}

export class LtlFreightEngine {
  private carriers: CarrierProfile[];
  private dieselPricePerGallon: number;
  private freightMargin: number;

  constructor(options: LtlFreightEngineOptions = {}) {
    this.carriers = options.carriers ?? DEFAULT_CARRIERS;
    this.dieselPricePerGallon = options.dieselPricePerGallon ?? 3.50;
    this.freightMargin = options.freightMargin ?? 0.08; // 8% default margin
  }

  /**
   * Request LTL rate quotes from all carriers.
   */
  async getQuotes(request: LtlQuoteRequest): Promise<LtlQuoteResponse> {
    const { pickup, delivery, items, accessorials: accReq } = request;

    // Merge requested accessorials with defaults
    const accessorials: AccessorialServices = {
      ...DEFAULT_ACCESSORIALS,
      ...(accReq ?? {}),
    };

    // Calculate shipment-level totals
    const distance = estimateDistanceByZip(pickup.zip, delivery.zip);
    const { totalWeightLb } = calculateTotalBillableWeight(items);
    const totalCube = calculateTotalCube(items);
    const dominantClass = dominantFreightClass(items);

    const fuelSurchargePct = calculateFuelSurchargePercent(this.dieselPricePerGallon);
    const accessorialFees = calculateAccessorialFees(accessorials);
    const totalAccessorialFeesUsd = accessorialFees.reduce((s, f) => s + f.amountUsd, 0);

    // Generate quotes from each eligible carrier
    const quotes: CarrierQuote[] = [];

    for (const carrier of this.carriers) {
      // Check eligibility
      if (totalWeightLb > carrier.maxWeightLb) continue;
      if (totalCube > carrier.maxCubeCuFt) continue;

      // Check service area
      if (!carrier.serviceArea.includes("*")) {
        const pickupOk = carrier.serviceArea.some((p) => pickup.zip.startsWith(p));
        const deliveryOk = carrier.serviceArea.some((p) => delivery.zip.startsWith(p));
        if (!pickupOk || !deliveryOk) continue;
      }

      // Base rate calculation
      const cwt = totalWeightLb / 100;
      const baseRatePerCwt = calculateBaseRatePerCwt(distance, dominantClass, totalWeightLb);
      const netCharge = baseRatePerCwt * cwt * carrier.rateMultiplier;

      // Apply minimum charge
      let netChargeUsd = Math.max(netCharge, carrier.minimumChargeUsd);

      // Fuel surcharge
      let fuelSurchargeUsd = 0;
      if (carrier.fuelSurchargeBasis === "percent_of_net") {
        fuelSurchargeUsd = netChargeUsd * (fuelSurchargePct / 100 + carrier.fuelSurchargeRate);
      } else {
        // flat per mile
        fuelSurchargeUsd = distance * (carrier.fuelSurchargeRate + fuelSurchargePct / 100);
      }

      // Check supported accessorials
      const includedAccessorials: AccessorialServices = { ...DEFAULT_ACCESSORIALS };
      const unsupportedAccessorialFees = accessorialFees.filter((f) => {
        // For simplicity, we check common accessorials against supported list
        const key = accessorialFeeToKey(f.name);
        return !key || !carrier.supportedAccessorials.includes(key as keyof AccessorialServices);
      });

      // Use supported accessorials
          const supportedKeys = carrier.supportedAccessorials;
          for (const key of supportedKeys) {
            if (accessorials[key]) {
              (includedAccessorials as unknown as Record<string, boolean>)[key] = true;
            }
          }

      // Calculate total
      const totalChargeUsd = netChargeUsd + fuelSurchargeUsd + totalAccessorialFeesUsd;

      // Apply freight margin
      const markedUpTotal = totalChargeUsd * (1 + this.freightMargin);

      const transitDays = carrier.transitDays(distance);

      quotes.push({
        carrierName: carrier.name,
        scac: carrier.scac,
        netChargeUsd: Math.round(netChargeUsd * 100) / 100,
        fuelSurchargeUsd: Math.round(fuelSurchargeUsd * 100) / 100,
        totalChargeUsd: Math.round(markedUpTotal * 100) / 100,
        transitDays,
        serviceLevel: carrier.serviceLevel,
        guaranteed: carrier.offersGuaranteed,
        includedAccessorials,
        additionalFees: accessorialFees,
        quoteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Sort by total price ascending
    quotes.sort((a, b) => a.totalChargeUsd - b.totalChargeUsd);

    const bestQuote = quotes.length > 0 ? quotes[0] : null;
    const fastestQuote = [...quotes].sort(
      (a, b) => parseTransitMin(a.transitDays) - parseTransitMin(b.transitDays),
    )[0] ?? null;
    const bestWithLiftGate = quotes.find(
      (q) => q.includedAccessorials.liftGateDelivery,
    ) ?? null;

    return {
      requestId: request.requestId,
      quotes,
      generatedAt: new Date().toISOString(),
      bestQuote,
      fastestQuote,
      bestWithLiftGate,
    };
  }
}

// ─── Helpers ─────────────────────────────────────

function accessorialFeeToKey(name: string): string | null {
  const map: Record<string, string> = {
    "Liftgate Pickup": "liftGatePickup",
    "Liftgate Delivery": "liftGateDelivery",
    "Inside Pickup": "insidePickup",
    "Inside Delivery": "insideDelivery",
    "Residential Pickup": "residentialPickup",
    "Residential Delivery": "residentialDelivery",
    "Limited Access Delivery": "limitedAccessDelivery",
    "Appointment Required": "appointmentRequired",
    "Trade Show Delivery": "tradeShowDelivery",
    "Construction Job-Site Delivery": "constructionSiteDelivery",
    "Pre-Delivery Notification": "preDeliveryNotification",
  };
  return map[name] ?? null;
}

function parseTransitMin(days: string): number {
  const match = days.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 999;
}

// Re-export
export { DEFAULT_CARRIERS };
export type { CarrierProfile };