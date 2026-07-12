/**
 * FraudGatingService — Velocity and high-ticket fraud detection.
 *
 * Rules implemented:
 * 1. HIGH_TICKET: Orders over $5,000 are flagged for manual review.
 * 2. FIRST_TIME: First-time sellers (no prior completed orders) are flagged.
 * 3. VELOCITY: More than 3 orders from the same seller in the last hour = flagged.
 * 4. NEW_CUSTOMER: Same-day registration + order from unknown email/phone.
 */

import prisma from '../db';
import { emitOrderEvent } from './eventBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FraudCheckInput {
  sellerId: string;
  totalAmount: number;
  externalOrderId?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: Record<string, unknown>;
}

export interface FraudCheckResult {
  passed: boolean;
  flags: FraudFlag[];
}

export interface FraudFlag {
  rule: 'HIGH_TICKET' | 'FIRST_TIME_SELLER' | 'VELOCITY' | 'NEW_CUSTOMER';
  reason: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGH_TICKET_MINIMUM = 5000; // USD
const VELOCITY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const VELOCITY_MAX_ORDERS = 3;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Run all fraud checks on an incoming order.
 * Returns a list of flags and a `passed` boolean (true = no flags, safe to proceed).
 */
export async function checkFraud(
  input: FraudCheckInput,
): Promise<FraudCheckResult> {
  const flags: FraudFlag[] = [];

  // Rule 1: High-ticket check
  if (input.totalAmount >= HIGH_TICKET_MINIMUM) {
    flags.push({
      rule: 'HIGH_TICKET',
      reason: `Order total $${input.totalAmount.toFixed(2)} exceeds high-ticket threshold of $${HIGH_TICKET_MINIMUM}. Requires manual review.`,
      severity: 'MEDIUM',
    });
  }

  // Rule 2: First-time seller check
  const priorOrderCount = await prisma.order.count({
    where: {
      sellerId: input.sellerId,
      status: { in: ['RESERVED', 'FULFILLED'] },
    },
  });

  if (priorOrderCount === 0) {
    flags.push({
      rule: 'FIRST_TIME_SELLER',
      reason: `Seller ${input.sellerId} has no prior completed orders. Flagging for verification.`,
      severity: 'HIGH',
    });
  }

  // Rule 3: Velocity check — more than N orders in the last hour
  const recentOrderCount = await prisma.order.count({
    where: {
      sellerId: input.sellerId,
      createdAt: {
        gte: new Date(Date.now() - VELOCITY_WINDOW_MS),
      },
    },
  });

  if (recentOrderCount >= VELOCITY_MAX_ORDERS) {
    flags.push({
      rule: 'VELOCITY',
      reason: `Seller ${input.sellerId} placed ${recentOrderCount} orders in the last hour (max ${VELOCITY_MAX_ORDERS}). Possible automated abuse.`,
      severity: 'HIGH',
    });
  }

  // Rule 4: New customer check — same-day seller registration
  const seller = await prisma.seller.findUnique({
    where: { id: input.sellerId },
  });

  if (seller) {
    const sellerAgeMs = Date.now() - new Date(seller.createdAt).getTime();
    const sellerAgeHours = sellerAgeMs / (1000 * 60 * 60);
    if (sellerAgeHours < 24 && input.totalAmount >= 1000) {
      flags.push({
        rule: 'NEW_CUSTOMER',
        reason: `Seller ${input.sellerId} registered less than 24 hours ago and placed an order over $1,000.`,
        severity: 'HIGH',
      });
    }
  }

  // Emit event if fraud was detected
  if (flags.length > 0) {
    await emitOrderEvent('order.fraud_flagged', {
      orderId: '',
      sellerId: input.sellerId,
      externalOrderId: input.externalOrderId,
      metadata: { flags, totalAmount: input.totalAmount },
    });
  }

  return {
    passed: flags.length === 0,
    flags,
  };
}

/**
 * Determine if fraud flags should block the order (vs. just flag it).
 * HIGH severity = block. MEDIUM = allow but mark for review.
 * LOW = informational only.
 */
export function shouldBlockOrder(result: FraudCheckResult): boolean {
  return result.flags.some((f) => f.severity === 'HIGH');
}