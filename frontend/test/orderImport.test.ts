/**
 * Unit Tests — Order Import API, Stock Verification & Fraud Gating
 *
 * Tests the core business logic in isolation by mocking Prisma.
 * Covers: fraud gating rules, stock check logic, event bus, order import orchestration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock Prisma ---
vi.mock('../src/db', () => {
  const mockCount = vi.fn();
  return {
    default: {
      order: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        count: mockCount,
        create: vi.fn(),
        update: vi.fn(),
      },
      orderItem: { create: vi.fn() },
      seller: { findUnique: vi.fn() },
      supplierSku: { findMany: vi.fn(), findFirst: vi.fn() },
      inventorySnapshot: {
        findFirst: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
      },
    },
  };
});

// Mock the queue (BullMQ)
vi.mock('../src/queue', () => ({
  addOrderToQueue: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '../src/db';
import { addOrderToQueue } from '../src/queue';

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------
import {
  onOrderEvent,
  offOrderEvent,
  emitOrderEvent,
  clearHandlers,
} from '../src/services/eventBus';

describe('EventBus', () => {
  beforeEach(() => clearHandlers());

  it('should emit and receive events', async () => {
    const handler = vi.fn();
    onOrderEvent('order.imported', handler);

    await emitOrderEvent('order.imported', {
      orderId: 'ord-1',
      sellerId: 'sel-1',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const payload = handler.mock.calls[0][0];
    expect(payload.eventType).toBe('order.imported');
    expect(payload.orderId).toBe('ord-1');
    expect(payload.sellerId).toBe('sel-1');
    expect(payload.timestamp).toBeInstanceOf(Date);
  });

  it('should support unsubscribe', async () => {
    const handler = vi.fn();
    onOrderEvent('order.reserved', handler);
    offOrderEvent('order.reserved', handler);

    await emitOrderEvent('order.reserved', {
      orderId: 'ord-2',
      sellerId: 'sel-2',
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not throw if a handler fails', async () => {
    onOrderEvent('order.fraud_flagged', async () => {
      throw new Error('handler crash');
    });

    await expect(
      emitOrderEvent('order.fraud_flagged', {
        orderId: 'ord-3',
        sellerId: 'sel-3',
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fraud Gating
// ---------------------------------------------------------------------------
import { checkFraud, shouldBlockOrder } from '../src/services/fraudGating';

describe('FraudGating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass for a normal order under $5k with prior history', async () => {
    // First count call (prior orders with status filter) = 5
    // Second count call (velocity with createdAt filter) = 0
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 5; // prior orders
      return 0; // velocity (no recent orders)
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-1',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    });

    const result = await checkFraud({
      sellerId: 'sel-1',
      totalAmount: 2500,
    });

    expect(result.passed).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('should flag orders over $5k (HIGH_TICKET)', async () => {
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 5;
      return 0;
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-1',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    const result = await checkFraud({
      sellerId: 'sel-1',
      totalAmount: 7500,
    });

    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.rule === 'HIGH_TICKET')).toBe(true);
  });

  it('should flag first-time sellers (FIRST_TIME_SELLER)', async () => {
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 0; // no prior orders
      return 0; // no recent orders either
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-new',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    const result = await checkFraud({
      sellerId: 'sel-new',
      totalAmount: 500,
    });

    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.rule === 'FIRST_TIME_SELLER')).toBe(true);
  });

  it('should flag velocity abuse (>3 orders in last hour)', async () => {
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.createdAt) return 4; // velocity: 4 recent orders
      return 5; // some prior orders
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-fast',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    const result = await checkFraud({
      sellerId: 'sel-fast',
      totalAmount: 100,
    });

    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.rule === 'VELOCITY')).toBe(true);
  });

  it('should flag new sellers (<24h old) placing $1k+ orders', async () => {
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 0; // no prior orders
      return 0; // velocity: 0 recent orders
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-fresh',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    });

    const result = await checkFraud({
      sellerId: 'sel-fresh',
      totalAmount: 1500,
    });

    expect(result.passed).toBe(false);
    expect(result.flags.some((f) => f.rule === 'NEW_CUSTOMER')).toBe(true);
  });

  it('shouldBlockOrder return true when HIGH severity flags present', () => {
    expect(
      shouldBlockOrder({
        passed: false,
        flags: [
          { rule: 'FIRST_TIME_SELLER', reason: 'test', severity: 'HIGH' },
        ],
      }),
    ).toBe(true);
  });

  it('shouldBlockOrder return false when only MEDIUM severity flags', () => {
    expect(
      shouldBlockOrder({
        passed: false,
        flags: [
          { rule: 'HIGH_TICKET', reason: 'test', severity: 'MEDIUM' },
        ],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stock Verification
// ---------------------------------------------------------------------------
import {
  checkStockAvailability,
  reserveStock,
} from '../src/services/stockVerification';

describe('StockVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return passed=true when stock is sufficient', async () => {
    (prisma.supplierSku.findMany as any).mockResolvedValue([
      {
        id: 'sku-1',
        inventorySnapshots: [{ count: 50, price: 100 }],
      },
    ]);

    const result = await checkStockAvailability([
      { productId: 'prod-1', quantity: 10 },
    ]);

    expect(result.passed).toBe(true);
    expect(result.reserved).toHaveLength(1);
    expect(result.reserved[0].reserved).toBe(10);
    expect(result.insufficient).toHaveLength(0);
  });

  it('should return passed=false when stock is insufficient', async () => {
    (prisma.supplierSku.findMany as any).mockResolvedValue([
      {
        id: 'sku-1',
        inventorySnapshots: [{ count: 3, price: 100 }],
      },
    ]);

    const result = await checkStockAvailability([
      { productId: 'prod-1', quantity: 10 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.insufficient).toHaveLength(1);
    expect(result.insufficient[0].available).toBe(3);
    expect(result.insufficient[0].requested).toBe(10);
  });

  it('should handle products with no supplier SKUs', async () => {
    (prisma.supplierSku.findMany as any).mockResolvedValue([]);

    const result = await checkStockAvailability([
      { productId: 'prod-none', quantity: 1 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.insufficient[0].available).toBe(0);
  });

  it('should distribute reservations across multiple SKUs', async () => {
    (prisma.supplierSku.findMany as any).mockResolvedValue([
      {
        id: 'sku-1',
        inventorySnapshots: [{ count: 5, price: 100 }],
      },
      {
        id: 'sku-2',
        inventorySnapshots: [{ count: 10, price: 110 }],
      },
    ]);

    const result = await checkStockAvailability([
      { productId: 'prod-multi', quantity: 12 },
    ]);

    expect(result.passed).toBe(true);
    expect(result.reserved).toHaveLength(2);
    expect(result.reserved[0].reserved).toBe(5);
    expect(result.reserved[1].reserved).toBe(7);
  });

  it('reserveStock should create snapshot records', async () => {
    (prisma.supplierSku.findMany as any).mockResolvedValue([
      {
        id: 'sku-1',
        inventorySnapshots: [{ count: 20, price: 50 }],
      },
    ]);
    (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
      count: 20,
      price: 50,
    });
    (prisma.inventorySnapshot.create as any).mockResolvedValue({});

    const result = await reserveStock(
      [{ productId: 'prod-1', quantity: 5 }],
      'ord-reserve',
    );

    expect(result.passed).toBe(true);
    expect(prisma.inventorySnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierSkuId: 'sku-1',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Order Import Orchestration
// ---------------------------------------------------------------------------
import { importOrder, importOrdersBulk } from '../src/services/orderImportService';

describe('OrderImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    sellerId: 'sel-1',
    totalAmount: 1000,
    shippingAddress: { line1: '123 Main St' },
    billingAddress: { line1: '123 Main St' },
    items: [{ productId: 'prod-1', quantity: 2, unitPrice: 500 }],
    source: 'shopify' as const,
  };

  it('should successfully import a valid order', async () => {
    // Fraud check: pass (5 prior orders, 0 recent)
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 5; // prior orders
      return 0; // velocity
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-1',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    // Stock check: pass
    (prisma.supplierSku.findMany as any).mockResolvedValue([
      { id: 'sku-1', inventorySnapshots: [{ count: 50, price: 500 }] },
    ]);

    // Order create
    (prisma.order.create as any).mockResolvedValue({
      id: 'ord-imported',
      sellerId: 'sel-1',
      status: 'PENDING',
    });

    // Inventory snapshot for reserve
    (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
      count: 50,
      price: 500,
    });
    (prisma.inventorySnapshot.create as any).mockResolvedValue({});

    // Order update
    (prisma.order.update as any).mockResolvedValue({
      id: 'ord-imported',
      status: 'RESERVED',
    });

    const result = await importOrder(validInput);

    expect(result.success).toBe(true);
    expect(result.status).toBe('RESERVED');
    expect(result.orderId).toBe('ord-imported');
    expect(result.errors).toHaveLength(0);
    expect(addOrderToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ord-imported' }),
    );
  });

  it('should block orders with HIGH severity fraud flags', async () => {
    // Fraud: first-time seller (HIGH)
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 0; // no prior orders
      return 0; // no recent orders
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-new',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    // Order will still be persisted as PENDING for review
    (prisma.order.create as any).mockResolvedValue({
      id: 'ord-blocked',
      sellerId: 'sel-new',
      status: 'PENDING',
    });

    const result = await importOrder({
      ...validInput,
      sellerId: 'sel-new',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('PENDING'); // persisted for review
    expect(result.fraudResult?.flags.some((f) => f.rule === 'FIRST_TIME_SELLER')).toBe(true);
  });

  it('should block orders with insufficient stock', async () => {
    // Fraud: pass
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 5; // prior orders
      return 0; // velocity
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-1',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    // Stock: fail
    (prisma.supplierSku.findMany as any).mockResolvedValue([
      { id: 'sku-1', inventorySnapshots: [{ count: 1, price: 500 }] },
    ]);

    const result = await importOrder({
      ...validInput,
      items: [{ productId: 'prod-1', quantity: 10, unitPrice: 100 }],
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('BLOCKED');
    expect(result.stockResult?.insufficient).toHaveLength(1);
  });

  it('should reject orders with missing sellerId', async () => {
    const result = await importOrder({
      ...validInput,
      sellerId: '',
    } as any);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('sellerId is required');
  });

  it('should reject orders with no items', async () => {
    const result = await importOrder({
      ...validInput,
      items: [],
    } as any);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('at least one item is required');
  });

  it('should handle bulk import with mixed results', async () => {
    // First order: success
    (prisma.order.count as any).mockImplementation((args: any) => {
      if (args?.where?.status) return 5; // prior orders
      return 0; // velocity
    });
    (prisma.seller.findUnique as any).mockResolvedValue({
      id: 'sel-1',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });
    (prisma.supplierSku.findMany as any).mockResolvedValue([
      { id: 'sku-1', inventorySnapshots: [{ count: 50, price: 100 }] },
    ]);
    (prisma.order.create as any).mockResolvedValue({
      id: 'ord-bulk-1',
      sellerId: 'sel-1',
      status: 'PENDING',
    });
    (prisma.inventorySnapshot.findFirst as any).mockResolvedValue({
      count: 50,
      price: 100,
    });
    (prisma.inventorySnapshot.create as any).mockResolvedValue({});
    (prisma.order.update as any).mockResolvedValue({
      id: 'ord-bulk-1',
      status: 'RESERVED',
    });

    const results = await importOrdersBulk([validInput, validInput]);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });
});