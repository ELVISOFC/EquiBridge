// ────────────────────────────────────────────────
// EquiBridge — Order Fulfillment Service
// ────────────────────────────────────────────────
//
// Integration layer between the order pipeline and the freight/PDF engines.
// The order pipeline calls processOrderFulfillment() when an order reaches
// RESERVED status. This module orchestrates:
//   1. LTL rate quoting via LtlFreightEngine
//   2. Blind-branded packing slip PDF generation
//   3. Commercial Warranty Passport PDF generation
//
// All outputs are written to a configurable output directory. The caller
// (order pipeline) receives document URLs it can pass downstream.

import path from "node:path";
import fs from "node:fs/promises";
import { LtlFreightEngine } from "../freight/LtlFreightEngine.js";
import { generatePackingSlipPdf, generateWarrantyPassportPdf, shutdownPdfEngine } from "../pdf/renderer.js";
import { generateProNumber, estimateDistanceByZip } from "../freight/index.js";
import type { FreightAddress, FreightLineItem, FreightClass, LtlQuoteResponse, CarrierQuote } from "../types/freight.js";
import type { SellerBrand } from "../pdf/blindBranding.js";

// ─── Types ──────────────────────────────────────

/**
 * Input from the order pipeline when an order reaches RESERVED status.
 */
export interface FulfillmentInput {
  /** Unique order identifier */
  orderId: string;
  /** Seller / storefront identifier */
  sellerId: string;
  /** Line items in the order */
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
  }>;
  /** Customer shipping address as freeform key-value pairs */
  shippingAddress: Record<string, unknown>;
}

/**
 * Result returned to the order pipeline after fulfillment processing.
 */
export interface FulfillmentResult {
  /** LTL quote information (undefined if shipment is below LTL threshold) */
  ltlQuote?: {
    carrier: string;
    estimatedCost: number;
    estimatedTransitDays: number;
    proNumber: string;
  };
  /** File path or URL to the generated packing slip PDF */
  packingSlipUrl?: string;
  /** File path or URL to the generated warranty passport PDF */
  warrantyPassportUrl?: string;
  /** Timestamp when fulfillment processing completed */
  issuedAt: Date;
}

// ─── Configuration ──────────────────────────────

export interface FulfillmentConfig {
  /** Directory where generated PDFs are stored */
  outputDir: string;
  /** Seller branding configuration */
  sellerBrand: SellerBrand;
  /** Default freight class to use when items lack dimension data */
  defaultFreightClass?: FreightClass;
  /** Default weight per item (lb) when not specified */
  defaultItemWeightLb?: number;
  /** Default dims per item (inches) when not specified */
  defaultItemDimensions?: { lengthIn: number; widthIn: number; heightIn: number };
  /** Diesel price per gallon for fuel surcharge (default: 3.50) */
  dieselPricePerGallon?: number;
  /** Minimum weight in lb to trigger LTL quoting (default: 150) */
  ltlMinimumWeightLb?: number;
}

const DEFAULT_CONFIG: Required<Pick<FulfillmentConfig, "defaultFreightClass" | "defaultItemWeightLb" | "defaultItemDimensions" | "dieselPricePerGallon" | "ltlMinimumWeightLb">> = {
  defaultFreightClass: 100,
  defaultItemWeightLb: 50,
  defaultItemDimensions: { lengthIn: 24, widthIn: 18, heightIn: 12 },
  dieselPricePerGallon: 3.50,
  ltlMinimumWeightLb: 150,
};

// ─── Default Seller Brand (placeholder) ─────────

export const DEFAULT_SELLER_BRAND: SellerBrand = {
  storeName: "EquiBridge Seller",
  phone: "1-800-555-0000",
  email: "orders@equibridge.example.com",
  website: "equibridge.example.com",
  address: {
    street: "100 Commerce Way",
    city: "Portland",
    state: "OR",
    zip: "97201",
  },
  footer: "Thank you for your business!",
};

// ─── Helpers ─────────────────────────────────────

/**
 * Extract a FreightAddress from freeform shippingAddress record.
 * Tries common field name patterns and falls back to defaults.
 */
function extractFreightAddress(
  raw: Record<string, unknown>,
): FreightAddress {
  const str = (key: string, fallback = ""): string =>
    typeof raw[key] === "string" ? (raw[key] as string) : fallback;

  // Try common field name conventions
  const street = str("street") || str("address") || str("address1") || str("addressLine1") || "123 Main St";
  const city = str("city") || "Portland";
  const state = str("state") || "OR";
  const zip = str("zip") || str("zipCode") || str("postalCode") || "97201";
  const country = str("country") || "US";

  const isResidential = raw.isResidential === true ||
    raw.is_residential === true ||
    raw.residential === true;

  return { street, city, state, zip, country, isResidential };
}

/**
 * Build FreightLineItem[] from the order items, using defaults for
 * dimensions/weight/class when items lack that data.
 */
function buildFreightItems(
  items: FulfillmentInput["items"],
  config: Required<Pick<FulfillmentConfig, "defaultFreightClass" | "defaultItemWeightLb" | "defaultItemDimensions">>,
): FreightLineItem[] {
  return items.map((item, idx) => ({
    id: item.productId ?? `item-${idx}`,
    description: `Product ${item.productId ?? idx}`,
    freightClass: config.defaultFreightClass,
    weightLb: config.defaultItemWeightLb * item.quantity,
    dimensions: { ...config.defaultItemDimensions },
    quantity: item.quantity,
    stackable: true,
    hazardous: false,
  }));
}

/**
 * Calculate total weight across all items for LTL threshold check.
 */
function calculateTotalWeight(items: FreightLineItem[]): number {
  return items.reduce((sum, it) => sum + it.weightLb * it.quantity, 0);
}

/**
 * Pick the best quote for the result.
 */
function pickBestQuote(response: LtlQuoteResponse): CarrierQuote | undefined {
  // Prefer guaranteed, then best price
  const guaranteed = response.quotes.find((q) => q.guaranteed);
  return guaranteed ?? response.bestQuote ?? undefined;
}

/**
 * Sanitize a seller ID into a filesystem-safe prefix.
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

// ─── Fulfillment Engine ─────────────────────────

export class OrderFulfillmentService {
  private config: Required<FulfillmentConfig>;
  private freightEngine: LtlFreightEngine;

  constructor(config: FulfillmentConfig) {
    this.config = {
      outputDir: config.outputDir,
      sellerBrand: config.sellerBrand,
      defaultFreightClass: config.defaultFreightClass ?? DEFAULT_CONFIG.defaultFreightClass,
      defaultItemWeightLb: config.defaultItemWeightLb ?? DEFAULT_CONFIG.defaultItemWeightLb,
      defaultItemDimensions: config.defaultItemDimensions ?? DEFAULT_CONFIG.defaultItemDimensions,
      dieselPricePerGallon: config.dieselPricePerGallon ?? DEFAULT_CONFIG.dieselPricePerGallon,
      ltlMinimumWeightLb: config.ltlMinimumWeightLb ?? DEFAULT_CONFIG.ltlMinimumWeightLb,
    };

    this.freightEngine = new LtlFreightEngine({
      dieselPricePerGallon: this.config.dieselPricePerGallon,
    });
  }

  /**
   * Process an order for fulfillment.
   *
   * 1. Build freight items from the order's line items (applying defaults)
   * 2. Optionally get an LTL rate quote if weight exceeds threshold
   * 3. Generate a blind-branded packing slip PDF
   * 4. Generate a Commercial Warranty Passport PDF
   * 5. Return the combined result
   */
  async processOrder(input: FulfillmentInput): Promise<FulfillmentResult> {
    const issuedAt = new Date();
    const outputDir = this.config.outputDir;

    // Ensure output directory exists (best effort — if it fails, individual
    // file writes will be caught by their own try/catch)
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch {
      // proceed — PDF writes will fail and be caught individually
    }

    const safeOrderId = sanitizeId(input.orderId);

    // ── Step 1: Build freight items ──────────────────
    const freightItems = buildFreightItems(input.items, {
      defaultFreightClass: this.config.defaultFreightClass,
      defaultItemWeightLb: this.config.defaultItemWeightLb,
      defaultItemDimensions: this.config.defaultItemDimensions,
    });

    const totalWeightLb = calculateTotalWeight(freightItems);
    const needsLtl = totalWeightLb >= this.config.ltlMinimumWeightLb;

    // ── Step 2: LTL Rate Quote ───────────────────────
    let ltlQuote: FulfillmentResult["ltlQuote"];
    const proNumber = generateProNumber();

    if (needsLtl) {
      const shipTo = extractFreightAddress(input.shippingAddress);

      // Use a default pickup address (seller's warehouse)
      const pickupAddr: FreightAddress = {
        street: this.config.sellerBrand.address?.street ?? "100 Commerce Way",
        city: this.config.sellerBrand.address?.city ?? "Portland",
        state: this.config.sellerBrand.address?.state ?? "OR",
        zip: this.config.sellerBrand.address?.zip ?? "97201",
        country: "US",
        isResidential: false,
      };

      try {
        const quoteResponse = await this.freightEngine.getQuotes({
          requestId: `fulfill-${input.orderId}`,
          pickup: pickupAddr,
          delivery: shipTo,
          items: freightItems,
          accessorials: {
            liftGateDelivery: shipTo.isResidential,
            residentialDelivery: shipTo.isResidential,
          },
        });

        const best = pickBestQuote(quoteResponse);

        if (best) {
          ltlQuote = {
            carrier: best.carrierName,
            estimatedCost: best.totalChargeUsd,
            estimatedTransitDays: parseInt(best.transitDays.split("-")[0], 10) || 1,
            proNumber,
          };
        }
      } catch (err) {
        // If quoting fails, proceed without LTL quote rather than failing the order
        console.warn(`[Fulfillment] LTL quoting failed for order ${input.orderId}:`, (err as Error).message);
      }
    }

    // ── Step 3: Generate Packing Slip PDF ────────────
    let packingSlipUrl: string | undefined;

    try {
      const shipTo = extractFreightAddress(input.shippingAddress);
      const shipDate = issuedAt.toISOString().split("T")[0];
      const pdfPath = path.join(outputDir, `${safeOrderId}-packing-slip.pdf`);

      await generatePackingSlipPdf(
        {
          orderNumber: input.orderId,
          seller: this.config.sellerBrand,
          shipTo,
          billTo: {
            name: extractFreightAddress(input.shippingAddress).street,
            street: shipTo.street,
            city: shipTo.city,
            state: shipTo.state,
            zip: shipTo.zip,
          },
          items: freightItems,
          totalWeightLb,
          packageCount: freightItems.reduce((s, it) => s + it.quantity, 0),
          shipDate,
          carrierName: ltlQuote?.carrier ?? "TBD",
          proNumber: ltlQuote?.proNumber ?? proNumber,
          specialInstructions: shipTo.isResidential ? "Residential delivery — lift gate may be required" : undefined,
        },
        pdfPath,
      );

      packingSlipUrl = pdfPath;
    } catch (err) {
      console.warn(`[Fulfillment] Packing slip PDF generation failed for order ${input.orderId}:`, (err as Error).message);
    }

    // ── Step 4: Generate Warranty Passport PDF ───────
    let warrantyPassportUrl: string | undefined;

    try {
      const shipTo = extractFreightAddress(input.shippingAddress);
      const eqLocation = `${shipTo.street}, ${shipTo.city}, ${shipTo.state} ${shipTo.zip}`;
      const today = issuedAt.toISOString();
      const pdfPath = path.join(outputDir, `${safeOrderId}-warranty-passport.pdf`);

      // Build warranty coverages (one per item, placeholder)
      const coverages = freightItems.map((item, i) => ({
        itemId: item.id,
        description: item.description,
        type: "manufacturer" as const,
        duration: "2 Years",
        startDate: today,
        endDate: new Date(issuedAt.getFullYear() + 2, issuedAt.getMonth(), issuedAt.getDate()).toISOString(),
        coverageDetails: "Parts and labor — manufacturing defects",
        exclusions: "Normal wear, abuse, unauthorized modifications",
        claimInstructions: `Contact ${this.config.sellerBrand.storeName} with order #${input.orderId}`,
      }));

      await generateWarrantyPassportPdf(
        {
          passportId: `WP-${input.orderId}`,
          seller: this.config.sellerBrand,
          customerName: eqLocation, // placeholder; real pipeline provides customer name
          orderNumber: input.orderId,
          invoiceNumber: `INV-${input.orderId}`,
          purchaseDate: today,
          equipmentLocation: eqLocation,
          coverages,
          complianceCertificates: [
            {
              name: "Certificate of Compliance",
              certificateId: `COC-${input.orderId}`,
              issuingBody: this.config.sellerBrand.storeName,
              issueDate: today,
            },
          ],
          items: freightItems,
        },
        pdfPath,
      );

      warrantyPassportUrl = pdfPath;
    } catch (err) {
      console.warn(`[Fulfillment] Warranty passport PDF generation failed for order ${input.orderId}:`, (err as Error).message);
    }

    return {
      ltlQuote,
      packingSlipUrl,
      warrantyPassportUrl,
      issuedAt,
    };
  }

  /**
   * Clean up any shared resources (e.g. browser pool).
   */
  async shutdown(): Promise<void> {
    await shutdownPdfEngine();
  }
}

// ─── Top-level convenience wrapper ───────────────

let _defaultService: OrderFulfillmentService | null = null;

/**
 * Process an order using the default service instance.
 *
 * Convenience wrapper so the order pipeline can call one function.
 * The service is lazily initialized on first call.
 */
export async function processOrderFulfillment(
  input: FulfillmentInput,
  config?: Partial<FulfillmentConfig>,
): Promise<FulfillmentResult> {
  if (!_defaultService) {
    _defaultService = new OrderFulfillmentService({
      outputDir: path.join(process.cwd(), "fulfillment-output"),
      sellerBrand: config?.sellerBrand ?? DEFAULT_SELLER_BRAND,
      ...config,
    });
  }

  return _defaultService.processOrder(input);
}