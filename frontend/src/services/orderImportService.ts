/**
 * OrderImportService — Orchestrates the full order import pipeline:
 *
 * 1. Validate input
 * 2. Fraud check (high-ticket / velocity / first-time seller)
 * 3. Stock verification
 * 4. Inventory reserve
 * 5. Persist order + items
 * 6. Queue for background processing (logistics, warranty, etc.)
 * 7. Emit events
 */

import prisma from '../db';
import { addOrderToQueue } from '../queue';
import { emitOrderEvent } from './eventBus';
import { checkFraud, shouldBlockOrder, FraudCheckResult, FraudCheckInput } from './fraudGating';
import {
  checkStockAvailability,
  reserveStock,
  StockCheckLineItem,
} from './stockVerification';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface ImportOrderInput {
  sellerId: string;
  externalOrderId?: string;
  totalAmount: number;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  customerEmail?: string;
  customerPhone?: string;
  items: ImportOrderItem[];
  source?: string; // 'shopify' | 'amazon' | 'manual'
}

export interface ImportOrderResult {
  success: boolean;
  orderId?: string;
  status: 'PENDING' | 'RESERVED' | 'BLOCKED';
  fraudResult?: FraudCheckResult;
  stockResult?: import('./stockVerification').StockCheckResult;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Import a single order through the full pipeline:
 * fraud check → stock check → reserve → persist → queue.
 */
export async function importOrder(
  input: ImportOrderInput,
): Promise<ImportOrderResult> {
  const errors: string[] = [];

  // --- Validate input ---
  if (!input.sellerId) errors.push('sellerId is required');
  if (!input.items || input.items.length === 0)
    errors.push('at least one item is required');
  if (input.totalAmount <= 0)
    errors.push('totalAmount must be positive');

  if (errors.length > 0) {
    return { success: false, status: 'BLOCKED', errors };
  }

  // --- Step 1: Fraud check ---
  const fraudInput: FraudCheckInput = {
    sellerId: input.sellerId,
    totalAmount: input.totalAmount,
    externalOrderId: input.externalOrderId,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    shippingAddress: input.shippingAddress,
  };

  const fraudResult = await checkFraud(fraudInput);

  if (shouldBlockOrder(fraudResult)) {
    // Still persist the order as PENDING so it can be reviewed
    const order = await prisma.order.create({
      data: {
        sellerId: input.sellerId,
        externalOrderId: input.externalOrderId,
        totalAmount: input.totalAmount,
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress,
        status: 'PENDING',
      },
    });

    // Persist items so the review dashboard has the full picture
    for (const item of input.items) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });
    }

    await emitOrderEvent('order.imported', {
      orderId: order.id,
      sellerId: input.sellerId,
      externalOrderId: input.externalOrderId,
      metadata: { fraudFlags: fraudResult.flags, blocked: true },
    });

    return {
      success: false,
      orderId: order.id,
      status: 'PENDING',
      fraudResult,
      errors: fraudResult.flags.map((f) => f.reason),
    };
  }

  // --- Step 2: Stock verification ---
  const stockLineItems: StockCheckLineItem[] = input.items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
  }));

  const stockCheck = await checkStockAvailability(stockLineItems);

  if (!stockCheck.passed) {
    return {
      success: false,
      status: 'BLOCKED',
      stockResult: stockCheck,
      errors: stockCheck.insufficient.map(
        (i) =>
          `Insufficient stock for product ${i.productId}: requested ${i.requested}, available ${i.available}`,
      ),
    };
  }

  // --- Step 3: Create the order (PENDING initially) ---
  const order = await prisma.order.create({
    data: {
      sellerId: input.sellerId,
      externalOrderId: input.externalOrderId,
      totalAmount: input.totalAmount,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress,
      status: 'PENDING',
    },
  });

  // Persist order items
  for (const item of input.items) {
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      },
    });
  }

  // --- Step 4: Reserve stock ---
  const reserveResult = await reserveStock(stockLineItems, order.id);

  if (!reserveResult.passed) {
    // Reserve failed — leave order as PENDING for manual intervention
    return {
      success: false,
      orderId: order.id,
      status: 'PENDING',
      stockResult: reserveResult,
      errors: reserveResult.insufficient.map(
        (i) =>
          `Stock reserve failed for product ${i.productId}`,
      ),
    };
  }

  // --- Step 5: Update order status to RESERVED ---
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'RESERVED' },
  });

  await emitOrderEvent('order.reserved', {
    orderId: order.id,
    sellerId: input.sellerId,
    externalOrderId: input.externalOrderId,
  });

  // --- Step 6: Queue for background processing (logistics, warranty, etc.) ---
  await addOrderToQueue({
    orderId: order.id,
    externalOrderId: input.externalOrderId,
    source: input.source || 'manual',
    sellerId: input.sellerId,
  });

  return {
    success: true,
    orderId: order.id,
    status: 'RESERVED',
    fraudResult,
    stockResult: reserveResult,
    errors: [],
  };
}

/**
 * Bulk import: process multiple orders sequentially.
 * Each order is independently validated and processed.
 */
export async function importOrdersBulk(
  orders: ImportOrderInput[],
): Promise<ImportOrderResult[]> {
  const results: ImportOrderResult[] = [];
  for (const order of orders) {
    try {
      const result = await importOrder(order);
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        success: false,
        status: 'BLOCKED',
        errors: [`Unexpected error: ${message}`],
      });
    }
  }
  return results;
}