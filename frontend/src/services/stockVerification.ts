/**
 * StockVerificationService — Checks inventory availability across supplier SKUs
 * and creates atomic inventory reserves via InventorySnapshot records.
 *
 * Design:
 * - Looks up the most recent InventorySnapshot for each product's supplier SKUs.
 * - Compares available quantity to requested quantity.
 * - Creates a reserve record (an InventorySnapshot with negative count) to "hold" stock.
 * - Returns a summary of what was reserved vs what is insufficient.
 */

import prisma from '../db';
import { emitOrderEvent } from './eventBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockCheckLineItem {
  productId: string;
  quantity: number;
}

export interface StockCheckResult {
  passed: boolean;
  reserved: Array<{
    productId: string;
    supplierSkuId: string;
    requested: number;
    available: number;
    reserved: number;
  }>;
  insufficient: Array<{
    productId: string;
    supplierSkuId: string;
    requested: number;
    available: number;
  }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const HIGH_TICKET_THRESHOLD = 5000; // USD — orders above this amount get extra scrutiny

/**
 * Verify stock availability for a given list of line items.
 * Returns the aggregate result without persisting reserves.
 */
export async function checkStockAvailability(
  items: StockCheckLineItem[],
): Promise<StockCheckResult> {
  const result: StockCheckResult = {
    passed: true,
    reserved: [],
    insufficient: [],
  };

  for (const item of items) {
    // Find the latest snapshot for each supplier SKU linked to this product
    const supplierSkus = await prisma.supplierSku.findMany({
      where: { productId: item.productId },
      include: {
        inventorySnapshots: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    if (supplierSkus.length === 0) {
      result.insufficient.push({
        productId: item.productId,
        supplierSkuId: 'none',
        requested: item.quantity,
        available: 0,
      });
      result.passed = false;
      continue;
    }

    // Sum available stock across all supplier SKUs for this product
    let totalAvailable = 0;
    for (const sku of supplierSkus) {
      const latestSnapshot = sku.inventorySnapshots[0];
      const available = latestSnapshot ? latestSnapshot.count : 0;
      totalAvailable += available;
    }

    if (totalAvailable < item.quantity) {
      result.insufficient.push({
        productId: item.productId,
        supplierSkuId: supplierSkus[0].id,
        requested: item.quantity,
        available: totalAvailable,
      });
      result.passed = false;
    } else {
      // Reserve from the first SKU that has enough (simple strategy)
      let remaining = item.quantity;
      for (const sku of supplierSkus) {
        if (remaining <= 0) break;
        const latestSnapshot = sku.inventorySnapshots[0];
        const available = latestSnapshot ? latestSnapshot.count : 0;
        const take = Math.min(remaining, available);
        if (take > 0) {
          result.reserved.push({
            productId: item.productId,
            supplierSkuId: sku.id,
            requested: take,
            available,
            reserved: take,
          });
          remaining -= take;
        }
      }
    }
  }

  return result;
}

/**
 * Reserve inventory by creating InventorySnapshot records with reduced counts.
 * Called AFTER fraud check passes.
 */
export async function reserveStock(
  items: StockCheckLineItem[],
  orderId: string,
): Promise<StockCheckResult> {
  const check = await checkStockAvailability(items);

  if (!check.passed) {
    await emitOrderEvent('order.stock_insufficient', {
      orderId,
      sellerId: '',
      metadata: {
        insufficient: check.insufficient,
      },
    });
    return check;
  }

  // Write reserve snapshots (negative delta)
  for (const r of check.reserved) {
    const latest = await prisma.inventorySnapshot.findFirst({
      where: { supplierSkuId: r.supplierSkuId },
      orderBy: { timestamp: 'desc' },
    });

    const currentCount = latest ? latest.count : 0;
    const newCount = Math.max(0, currentCount - r.reserved);

    await prisma.inventorySnapshot.create({
      data: {
        supplierSkuId: r.supplierSkuId,
        count: newCount,
        price: latest?.price ?? 0,
      },
    });
  }

  await emitOrderEvent('order.stock_reserved', {
    orderId,
    sellerId: '',
    metadata: {
      reserved: check.reserved,
    },
  });

  return check;
}

/**
 * Release previously reserved stock when an order is cancelled.
 */
export async function releaseStock(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) return;

  for (const item of order.items) {
    const supplierSkus = await prisma.supplierSku.findMany({
      where: { productId: item.productId },
      include: {
        inventorySnapshots: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    for (const sku of supplierSkus) {
      const latest = sku.inventorySnapshots[0];
      const currentCount = latest ? latest.count : 0;

      await prisma.inventorySnapshot.create({
        data: {
          supplierSkuId: sku.id,
          count: currentCount + item.quantity,
          price: latest?.price ?? 0,
        },
      });
    }
  }
}

export { HIGH_TICKET_THRESHOLD };