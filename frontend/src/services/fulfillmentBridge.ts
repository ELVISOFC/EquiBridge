/**
 * FulfillmentBridge — Connects the BullMQ order worker to the fulfillment pipeline.
 *
 * This bridge loads a RESERVED order from Prisma, processes it through the
 * freight project's `processOrderFulfillment()` (LTL freight quoting + PDF
 * document generation), and transitions the order to FULFILLED on success.
 *
 * ## Architecture
 *
 *   orderWorker (BullMQ) → handleOrderFulfillment(orderId)
 *                            ├─ load order + items from Prisma
 *                            ├─ processOrderFulfillment() from freight project
 *                            │   ├─ LtlFreightEngine quote
 *                            │   ├─ Packing slip PDF (branded)
 *                            │   └─ Warranty passport PDF
 *                            ├─ on success: update order → FULFILLED, store result, emit event
 *                            └─ on failure: log, emit order.failed event
 */

import prisma from '../db';
import { emitOrderEvent } from './eventBus';

// Import from the freight project
import { processOrderFulfillment } from '../../../equibridge-freight/src/services/orderFulfillment';
import type { FulfillmentInput, FulfillmentResult } from '../../../equibridge-freight/src/services/orderFulfillment';

// Re-export types for consumers
export type { FulfillmentInput, FulfillmentResult };

// ---------------------------------------------------------------------------
// Bridge handler — called by the BullMQ worker
// ---------------------------------------------------------------------------

/**
 * Handle order fulfillment for a single order.
 *
 * 1. Load the order + items from Prisma
 * 2. Call the freight project's processOrderFulfillment() with the order data
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
    // 2. Process fulfillment via the freight engine
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
