/**
 * Unit Tests — Fulfillment Bridge
 *
 * Tests the order fulfillment pipeline in isolation by mocking Prisma.
 * Covers: success path, failure handling, LTL estimating, document URL generation,
 * order-not-found edge case, and event emission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock Prisma ---
vi.mock('../src/db', () => {
  return {
    default: {
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

// Mock the event bus
vi.mock('../src/services/eventBus', () => ({
  emitOrderEvent: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '../src/db';
import { emitOrderEvent } from '../src/services/eventBus';

// ---------------------------------------------------------------------------
// FulfillmentBridge
// ---------------------------------------------------------------------------
import {
  handleOrderFulfillment,
  processOrderFulfillment,
  FulfillmentInput,
  FulfillmentResult,
} from '../src/services/fulfillmentBridge';

describe('FulfillmentBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // processOrderFulfillment — the core fulfillment logic
  // -----------------------------------------------------------------------

  describe('processOrderFulfillment', () => {
    const baseInput: FulfillmentInput = {
      orderId: 'ord-1',
      sellerId: 'sel-1',
      items: [
        { productId: 'prod-1', quantity: 2, unitPrice: 500 },
        { productId: 'prod-2', quantity: 1, unitPrice: 1200 },
      ],
      shippingAddress: {
        street: '123 Industrial Blvd',
        city: 'Houston',
        state: 'TX',
        zip: '77001',
        country: 'US',
      },
    };

    it('should return a fulfillment result with LTL quote and document URLs', async () => {
      const result = await processOrderFulfillment(baseInput);

      expect(result).toBeDefined();
      expect(result.issuedAt).toBeInstanceOf(Date);
      expect(result.packingSlipUrl).toContain('packing-slip');
      expect(result.warrantyPassportUrl).toContain('warranty-passport');
      expect(result.ltlQuote).toBeDefined();
      if (result.ltlQuote) {
        expect(result.ltlQuote.carrier).toBeTruthy();
        expect(result.ltlQuote.estimatedCost).toBeGreaterThan(0);
        expect(result.ltlQuote.estimatedTransitDays).toBeTruthy();
        expect(result.ltlQuote.proNumber).toMatch(/^EQBR-/);
      }
    });

    it('should return a result without LTL quote when items have no weight data', async () => {
      const result = await processOrderFulfillment({
        ...baseInput,
        items: [],
      });

      expect(result).toBeDefined();
      expect(result.issuedAt).toBeInstanceOf(Date);
      // Empty items → no weight → no LTL quote
      expect(result.ltlQuote).toBeUndefined();
      // Documents should still be generated
      expect(result.packingSlipUrl).toBeTruthy();
      expect(result.warrantyPassportUrl).toBeTruthy();
    });

    it('should generate consistent document URLs', async () => {
      const result1 = await processOrderFulfillment({
        ...baseInput,
        orderId: 'ord-1',
      });
      const result2 = await processOrderFulfillment({
        ...baseInput,
        orderId: 'ord-2',
      });

      // Different orders should have different URLs
      expect(result1.packingSlipUrl).toContain('ord-1');
      expect(result2.packingSlipUrl).toContain('ord-2');
    });
  });

  // -----------------------------------------------------------------------
  // handleOrderFulfillment — the bridge handler called by the worker
  // -----------------------------------------------------------------------

  describe('handleOrderFulfillment', () => {
    it('should load order, process fulfillment, and update status to FULFILLED', async () => {
      // Mock order with items
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-test',
        sellerId: 'sel-1',
        status: 'RESERVED',
        externalOrderId: 'ext-1',
        shippingAddress: {
          street: '456 Oak Ave',
          city: 'Dallas',
          state: 'TX',
          zip: '75201',
          country: 'US',
        },
        billingAddress: {},
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            quantity: 3,
            unitPrice: 100,
            product: { id: 'prod-1', title: 'Widget A' },
          },
        ],
      });

      // Mock success update
      (prisma.order.update as any).mockResolvedValue({
        id: 'ord-test',
        status: 'FULFILLED',
      });

      await handleOrderFulfillment('ord-test');

      // Verify order was loaded
      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'ord-test' },
        include: { items: { include: { product: true } } },
      });

      // Verify order was updated to FULFILLED with fulfillmentResult
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-test' },
        data: expect.objectContaining({
          status: 'FULFILLED',
          fulfillmentResult: expect.any(Object),
        }),
      });

      // Verify event was emitted
      expect(emitOrderEvent).toHaveBeenCalledWith(
        'order.fulfilled',
        expect.objectContaining({
          orderId: 'ord-test',
          sellerId: 'sel-1',
          externalOrderId: 'ext-1',
        }),
      );
    });

    it('should handle order not found gracefully', async () => {
      (prisma.order.findUnique as any).mockResolvedValue(null);

      await handleOrderFulfillment('ord-missing');

      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(emitOrderEvent).toHaveBeenCalledWith(
        'order.failed',
        expect.objectContaining({
          orderId: 'ord-missing',
          metadata: { error: 'Order not found' },
        }),
      );
    });

    it('should emit order.failed event when fulfillment throws', async () => {
      // Mock order that exists
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-crash',
        sellerId: 'sel-1',
        status: 'RESERVED',
        externalOrderId: null,
        shippingAddress: { zip: '10001' },
        billingAddress: {},
        items: [],
      });

      // Make the update throw to simulate a DB failure
      (prisma.order.update as any).mockRejectedValue(new Error('DB connection lost'));

      await handleOrderFulfillment('ord-crash');

      // Should have tried to update
      expect(prisma.order.update).toHaveBeenCalled();

      // Should emit failed event
      expect(emitOrderEvent).toHaveBeenCalledWith(
        'order.failed',
        expect.objectContaining({
          orderId: 'ord-crash',
          sellerId: 'sel-1',
          metadata: expect.objectContaining({
            error: expect.stringContaining('DB connection lost'),
          }),
        }),
      );
    });

    it('should include LTL quote details in the fulfillment result', async () => {
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-ltl',
        sellerId: 'sel-1',
        status: 'RESERVED',
        externalOrderId: null,
        shippingAddress: {
          street: '789 Warehouse Row',
          city: 'Memphis',
          state: 'TN',
          zip: '38101',
          country: 'US',
        },
        billingAddress: {},
        items: [
          {
            id: 'item-1',
            productId: 'prod-hvy',
            quantity: 5,
            unitPrice: 2000,
            product: { id: 'prod-hvy', title: 'Heavy Assembly' },
          },
        ],
      });

      (prisma.order.update as any).mockResolvedValue({});

      await handleOrderFulfillment('ord-ltl');

      // Verify the fulfillment result stored on the order has LTL data
      const updateCall = (prisma.order.update as any).mock.calls[0][0];
      const fulfillmentResult = updateCall.data.fulfillmentResult as FulfillmentResult;

      expect(fulfillmentResult.ltlQuote).toBeDefined();
      expect(fulfillmentResult.ltlQuote?.carrier).toBeTruthy();
      expect(fulfillmentResult.ltlQuote?.estimatedCost).toBeGreaterThan(0);
      expect(fulfillmentResult.ltlQuote?.proNumber).toMatch(/^EQBR-/);
      expect(fulfillmentResult.packingSlipUrl).toBeTruthy();
      expect(fulfillmentResult.warrantyPassportUrl).toBeTruthy();
      expect(fulfillmentResult.issuedAt).toBeTruthy();
    });
  });
});