/**
 * EventBus — Simple typed event emitter for order lifecycle notifications.
 * Used to broadcast order status changes, fraud flags, and stock events
 * to downstream consumers (webhooks, BullMQ workers, logging).
 */

export type OrderEventType =
  | 'order.imported'
  | 'order.reserved'
  | 'order.fulfilled'
  | 'order.failed'
  | 'order.cancelled'
  | 'order.fraud_flagged'
  | 'order.fraud_cleared'
  | 'order.stock_insufficient'
  | 'order.stock_reserved';

export interface OrderEventPayload {
  eventType: OrderEventType;
  orderId: string;
  sellerId: string;
  externalOrderId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

type EventHandler = (payload: OrderEventPayload) => void | Promise<void>;

const handlers = new Map<OrderEventType, EventHandler[]>();

/**
 * Register a listener for a specific order event type.
 */
export function onOrderEvent(
  eventType: OrderEventType,
  handler: EventHandler,
): void {
  const existing = handlers.get(eventType) || [];
  existing.push(handler);
  handlers.set(eventType, existing);
}

/**
 * Remove a previously registered listener.
 */
export function offOrderEvent(
  eventType: OrderEventType,
  handler: EventHandler,
): void {
  const existing = handlers.get(eventType) || [];
  handlers.set(
    eventType,
    existing.filter((h) => h !== handler),
  );
}

/**
 * Emit an order event to all registered listeners.
 * Catches and logs errors per listener so one failure does not block others.
 */
export async function emitOrderEvent(
  eventType: OrderEventType,
  payload: Omit<OrderEventPayload, 'eventType' | 'timestamp'>,
): Promise<void> {
  const event: OrderEventPayload = {
    ...payload,
    eventType,
    timestamp: new Date(),
  };

  const listeners = handlers.get(eventType) || [];
  for (const handler of listeners) {
    try {
      await handler(event);
    } catch (err) {
      console.error(
        `[EventBus] Handler failed for ${eventType} (order ${payload.orderId}):`,
        err,
      );
    }
  }
}

/**
 * Clear all registered handlers (useful in tests).
 */
export function clearHandlers(): void {
  handlers.clear();
}