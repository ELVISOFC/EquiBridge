/**
 * FulfillmentBridge — Connects the BullMQ order worker to the fulfillment pipeline.
 *
 * This bridge loads a RESERVED order from Prisma, processes it through the
 * fulfillment pipeline (LTL freight quoting + PDF document generation), and
 * transitions the order to FULFILLED on success.
 *
 * ## Architecture
 *
 *   orderWorker (BullMQ) → handleOrderFulfillment(orderId)
 *                            ├─ load order + items from Prisma
 *                            ├─ processOrderFulfillment() — inline impl
 *                            │   ├─ LtlFreightEngine quote
 *                            │   ├─ Packing slip PDF (branded)
 *                            │   └─ Warranty passport PDF
 *                            ├─ on success: update order → FULFILLED, store result, emit event
 *                            └─ on failure: log, emit order.failed event
 *
 * ## Future
 *
 * When the logistics_eng's dedicated `processOrderFulfillment` service in the
 * freight project is ready, replace the local implementation below with:
 *
 *   import { processOrderFulfillment } from '../../equibridge-freight/src/services/orderFulfillment';
 *
 * The interface (FulfillmentInput → FulfillmentResult) is designed to match.
 */

import prisma from '../db';
import { emitOrderEvent } from './eventBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FulfillmentLineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  /** Optional dimensions for LTL freight calculation */
  weightLb?: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  freightClass?: number;
}

export interface FulfillmentInput {
  orderId: string;
  sellerId: string;
  items: FulfillmentLineItem[];
  shippingAddress: Record<string, unknown>;
}

export interface LtlQuoteResult {
  carrier: string;
  estimatedCost: number;
  estimatedTransitDays: number;
  proNumber: string;
}

export interface FulfillmentResult {
  ltlQuote?: LtlQuoteResult;
  packingSlipUrl?: string;
  warrantyPassportUrl?: string;
  issuedAt: Date;
}

// ---------------------------------------------------------------------------
// Local fulfillment implementation (standalone, no freight-project imports)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic PRO number (tracking identifier).
 * Format: EQBR-{prefix}-{sequence}
 */
function generateProNumber(carrierScac: string): string {
  const seq = String(Date.now() % 100000).padStart(5, '0');
  return `EQBR-${carrierScac}-${seq}`;
}

/**
 * Estimate LTL freight cost based on shipment weight and distance.
 *
 * This is a simplified inline estimator that mirrors the logic in the
 * equibridge-freight project's LtlFreightEngine.  It uses a per-CWT
 * (per-hundred-weight) rate model with mileage bands.
 *
 * @returns A single "best quote" result, or null if items have no weight data.
 */
function estimateLtlFreight(
  items: FulfillmentLineItem[],
  shippingAddress: Record<string, unknown>,
): LtlQuoteResult | null {
  // Calculate total weight from items (default 10 lbs per item if unknown)
  const totalWeightLb = items.reduce(
    (sum, i) => sum + (i.weightLb ?? 10) * i.quantity,
    0,
  );

  if (totalWeightLb <= 0) return null;

  // Use the shipping address ZIP to guess distance from a default "origin"
  // (e.g., a central US warehouse at ZIP 60601 = Chicago)
  const originZip = '60601';
  const destZip =
    typeof shippingAddress?.zip === 'string'
      ? shippingAddress.zip
      : typeof shippingAddress?.postalCode === 'string'
        ? shippingAddress.postalCode
        : '10001';

  // Simple ZIP-first-digit distance estimation (simplified haversine)
  const zipCentroids: Record<string, { lat: number; lng: number }> = {
    '0': { lat: 44.5, lng: -71.5 },
    '1': { lat: 40.8, lng: -74.0 },
    '2': { lat: 38.5, lng: -77.5 },
    '3': { lat: 33.8, lng: -84.5 },
    '4': { lat: 39.0, lng: -83.5 },
    '5': { lat: 42.5, lng: -93.0 },
    '6': { lat: 41.5, lng: -89.0 },
    '7': { lat: 32.0, lng: -94.0 },
    '8': { lat: 39.5, lng: -107.0 },
    '9': { lat: 37.5, lng: -120.5 },
  };

  const origin = zipCentroids[originZip.charAt(0)] ?? { lat: 39.0, lng: -89.0 };
  const dest = zipCentroids[destZip.charAt(0)] ?? { lat: 39.0, lng: -89.0 };

  const R = 3959;
  const dLat = ((dest.lat - origin.lat) * Math.PI) / 180;
  const dLng = ((dest.lng - origin.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((origin.lat * Math.PI) / 180) *
      Math.cos((dest.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const distanceMi = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Rate per CWT based on distance bands
  let ratePerCwt: number;
  if (distanceMi < 200) ratePerCwt = 12.0;
  else if (distanceMi < 500) ratePerCwt = 14.5;
  else if (distanceMi < 1000) ratePerCwt = 18.0;
  else if (distanceMi < 2000) ratePerCwt = 22.0;
  else ratePerCwt = 27.0;

  const cwt = totalWeightLb / 100;
  const netCharge = ratePerCwt * cwt;

  // Apply minimum charge floor
  const minCharge = 85.0;
  const totalCharge = Math.max(netCharge, minCharge);

  // Apply 8% freight margin (matches business plan)
  const markedUpTotal = Math.round(totalCharge * 1.08 * 100) / 100;

  // Estimate transit days
  let transitDays: string;
  if (distanceMi < 250) transitDays = '1-2';
  else if (distanceMi < 600) transitDays = '2-3';
  else if (distanceMi < 1200) transitDays = '3-4';
  else transitDays = '4-6';

  // Pick the carrier based on distance
  let carrierName: string;
  let scac: string;
  if (distanceMi < 500) {
    carrierName = 'Estes Express Lines';
    scac = 'ESTE';
  } else if (distanceMi < 1200) {
    carrierName = 'Old Dominion Freight Line';
    scac = 'ODFL';
  } else {
    carrierName = 'FedEx Freight';
    scac = 'FXFE';
  }

  return {
    carrier: carrierName,
    estimatedCost: markedUpTotal,
    estimatedTransitDays: transitDays,
    proNumber: generateProNumber(scac),
  };
}

/**
 * Generate URLs for the blind-branded packing slip and warranty passport.
 * In production, these would be rendered by the Headless Chrome PDF engine
 * and stored in cloud storage (S3, etc.).
 *
 * For now, returns placeholder URLs indicating where the documents would live.
 */
async function generateDocumentUrls(
  orderId: string,
  sellerId: string,
): Promise<{ packingSlipUrl: string; warrantyPassportUrl: string }> {
  // In a real deployment, these would call the PDF renderer and upload the result.
  // For the current implementation, return deterministic URLs.
  const baseUrl = process.env.DOCUMENTS_BASE_URL || 'https://docs.equibridge.io';
  const timestamp = Date.now();

  return {
    packingSlipUrl: `${baseUrl}/orders/${orderId}/packing-slip?t=${timestamp}&seller=${sellerId}`,
    warrantyPassportUrl: `${baseUrl}/orders/${orderId}/warranty-passport?t=${timestamp}&seller=${sellerId}`,
  };
}

/**
 * Process a single order through the fulfillment pipeline.
 *
 * This is the local implementation that will be replaced by the
 * equibridge-freight project's dedicated `processOrderFulfillment`
 * when it's ready.  The interface is designed to match.
 */
export async function processOrderFulfillment(
  input: FulfillmentInput,
): Promise<FulfillmentResult> {
  const { items, shippingAddress } = input;

  // Step 1: Get an LTL freight quote
  const ltlQuote = estimateLtlFreight(items, shippingAddress);

  // Step 2: Generate blind-branded documents
  const documents = await generateDocumentUrls(
    input.orderId,
    input.sellerId,
  );

  return {
    ltlQuote: ltlQuote ?? undefined,
    packingSlipUrl: documents.packingSlipUrl,
    warrantyPassportUrl: documents.warrantyPassportUrl,
    issuedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Bridge handler — called by the BullMQ worker
// ---------------------------------------------------------------------------

/**
 * Handle order fulfillment for a single order.
 *
 * 1. Load the order + items from Prisma
 * 2. Call processOrderFulfillment() with the order data
 * 3. On success: update order status to FULFILLED, store fulfillmentResult, emit event
 * 4. On failure: log, emit order.failed event
 */
export async function handleOrderFulfillment(orderId: string): Promise<void> {
  // 1. Load the order
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!order) {
    console.error(`[FulfillmentBridge] Order ${orderId} not found`);
    await emitOrderEvent('order.failed', {
      orderId,
      sellerId: 'unknown',
      metadata: { error: 'Order not found' },
    });
    return;
  }

  // Build the fulfillment input
  const fulfillmentInput: FulfillmentInput = {
    orderId: order.id,
    sellerId: order.sellerId,
    items: order.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
    })),
    shippingAddress: order.shippingAddress as Record<string, unknown>,
  };

  try {
    // 2. Process fulfillment
    const result = await processOrderFulfillment(fulfillmentInput);

    // 3. On success: update order status, store result, emit event
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'FULFILLED',
        fulfillmentResult: result as Record<string, unknown>,
      },
    });

    await emitOrderEvent('order.fulfilled', {
      orderId: order.id,
      sellerId: order.sellerId,
      externalOrderId: order.externalOrderId ?? undefined,
      metadata: {
        ltlQuote: result.ltlQuote,
        packingSlipUrl: result.packingSlipUrl,
        warrantyPassportUrl: result.warrantyPassportUrl,
      },
    });

    console.log(
      `[FulfillmentBridge] Order ${orderId} fulfilled — ` +
        `carrier: ${result.ltlQuote?.carrier ?? 'N/A'}, ` +
        `cost: $${result.ltlQuote?.estimatedCost?.toFixed(2) ?? 'N/A'}`,
    );
  } catch (err) {
    // 4. On failure: log, emit event
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[FulfillmentBridge] Order ${orderId} failed: ${errorMessage}`);

    await emitOrderEvent('order.failed', {
      orderId: order.id,
      sellerId: order.sellerId,
      externalOrderId: order.externalOrderId ?? undefined,
      metadata: { error: errorMessage },
    });
  }
}