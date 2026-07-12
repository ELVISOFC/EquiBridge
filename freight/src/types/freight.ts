// ────────────────────────────────────────────────
// EquiBridge — Freight & Logistics Type Definitions
// ────────────────────────────────────────────────

/**
 * NMFC (National Motor Freight Classification) freight class.
 * Lower class = lighter/denser = cheaper per pound.
 * Higher class = bulkier/fragile = more expensive.
 */
export type FreightClass =
  | 50 | 55 | 60 | 65 | 70 | 77_5
  | 85 | 92_5 | 100 | 110 | 125
  | 150 | 175 | 200 | 250 | 300
  | 400 | 500;

/**
 * Physical dimensions of a shipment item or pallet.
 */
export interface Dimensions {
  /** Length in inches */
  lengthIn: number;
  /** Width in inches */
  widthIn: number;
  /** Height in inches */
  heightIn: number;
}

/**
 * An individual line item / pallet in an LTL shipment.
 */
export interface FreightLineItem {
  /** Unique identifier for this item (e.g. order-line reference) */
  id: string;
  /** Product description */
  description: string;
  /** NMFC freight class */
  freightClass: FreightClass;
  /** Weight in pounds */
  weightLb: number;
  /** Physical dimensions */
  dimensions: Dimensions;
  /** Number of identical pieces/pallets */
  quantity: number;
  /** Whether this item is stackable */
  stackable: boolean;
  /** Whether this item is hazardous materials (hazmat) */
  hazardous: boolean;
}

/**
 * Supported accessorial / value-added services.
 */
export interface AccessorialServices {
  /** Lift-gate required at pickup */
  liftGatePickup: boolean;
  /** Lift-gate required at delivery */
  liftGateDelivery: boolean;
  /** Inside delivery (carrier moves goods into building) */
  insideDelivery: boolean;
  /** Inside pickup */
  insidePickup: boolean;
  /** Residential delivery (not a commercial loading dock) */
  residentialDelivery: boolean;
  /** Residential pickup */
  residentialPickup: boolean;
  /** Limited-access delivery (construction site, school, secured facility) */
  limitedAccessDelivery: boolean;
  /** Appointment required for delivery */
  appointmentRequired: boolean;
  /** Trade show / convention delivery */
  tradeShowDelivery: boolean;
  /** Construction job-site delivery */
  constructionSiteDelivery: boolean;
  /** Notification before delivery (phone call) */
  preDeliveryNotification: boolean;
}

export const DEFAULT_ACCESSORIALS: AccessorialServices = {
  liftGatePickup: false,
  liftGateDelivery: false,
  insideDelivery: false,
  insidePickup: false,
  residentialDelivery: false,
  residentialPickup: false,
  limitedAccessDelivery: false,
  appointmentRequired: false,
  tradeShowDelivery: false,
  constructionSiteDelivery: false,
  preDeliveryNotification: false,
};

/**
 * Address for pickup or delivery.
 */
export interface FreightAddress {
  street: string;
  city: string;
  state: string;        // 2-letter US state code
  zip: string;          // 5-digit or 9-digit ZIP
  country: string;      // ISO 3166-1 alpha-2
  isResidential: boolean;
}

/**
 * A complete LTL rate quote request.
 */
export interface LtlQuoteRequest {
  /** Unique request idempotency key */
  requestId: string;
  /** Pickup address */
  pickup: FreightAddress;
  /** Delivery address */
  delivery: FreightAddress;
  /** Line items / pallets in this shipment */
  items: FreightLineItem[];
  /** Optional accessorial services */
  accessorials?: Partial<AccessorialServices>;
  /** Earliest pickup date (ISO 8601) */
  pickupDate?: string;
  /** Preferred delivery date window start (ISO 8601) */
  deliveryDateStart?: string;
  /** Preferred delivery date window end (ISO 8601) */
  deliveryDateEnd?: string;
}

/**
 * A single carrier rate quote.
 */
export interface CarrierQuote {
  /** Carrier name (e.g. "Old Dominion", "XPO", "Estes", "Saia", "FedEx Freight") */
  carrierName: string;
  /** SCAC (Standard Carrier Alpha Code) */
  scac: string;
  /** Net freight charge (excluding fuel surcharge) in USD */
  netChargeUsd: number;
  /** Fuel surcharge in USD */
  fuelSurchargeUsd: number;
  /** Total charge in USD */
  totalChargeUsd: number;
  /** Transit time estimate (business days, e.g. "2-3") */
  transitDays: string;
  /** Service level description */
  serviceLevel: string;
  /** Whether this quote is guaranteed */
  guaranteed: boolean;
  /** The accessorials included in this quote */
  includedAccessorials: AccessorialServices;
  /** Any additional accessorial fees */
  additionalFees: { name: string; amountUsd: number }[];
  /** Quote expiry (ISO 8601) */
  quoteExpiresAt: string;
}

/**
 * Full response to an LTL quote request.
 */
export interface LtlQuoteResponse {
  requestId: string;
  quotes: CarrierQuote[];
  /** When this quote was generated (ISO 8601) */
  generatedAt: string;
  /** Best (cheapest) quote */
  bestQuote: CarrierQuote | null;
  /** Fastest quote */
  fastestQuote: CarrierQuote | null;
  /** Cheapest quote that includes lift-gate delivery */
  bestWithLiftGate: CarrierQuote | null;
}

/**
 * Status of a shipment in transit.
 */
export type ShipmentStatus =
  | "pickup_scheduled"
  | "pickup_completed"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "delayed"
  | "lost"
  | "damaged";

/**
 * A tracking event / scan.
 */
export interface TrackingEvent {
  timestamp: string;            // ISO 8601
  status: ShipmentStatus;
  location: string;             // City, ST
  description: string;          // Human-readable event description
  latitude?: number;
  longitude?: number;
}

/**
 * Shipment tracking record.
 */
export interface ShipmentTracking {
  /** Carrier-generated PRO number */
  proNumber: string;
  /** SCAC */
  scac: string;
  carrierName: string;
  status: ShipmentStatus;
  events: TrackingEvent[];
  estimatedDelivery?: string;   // ISO 8601
  actualDelivery?: string;      // ISO 8601
  lastUpdated: string;          // ISO 8601
  /** Current location description */
  currentLocation?: string;
}

/**
 * Dimensional weight calculation result.
 */
export interface DimensionalWeight {
  /** The actual weight in lb */
  actualWeightLb: number;
  /** The dimensional weight in lb (L×W×H / dimFactor) */
  dimensionalWeightLb: number;
  /** The billable weight (greater of actual vs dimensional) in lb */
  billableWeightLb: number;
  /** The dimensional factor used */
  dimFactor: number;
}