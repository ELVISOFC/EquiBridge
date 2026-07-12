// ────────────────────────────────────────────────
// EquiBridge — Shipment Tracking
// ────────────────────────────────────────────────

import type { ShipmentTracking, TrackingEvent, ShipmentStatus } from "../types/freight.js";

// ─── Mock Tracking Data ──────────────────────────
// In production, this module would call carrier APIs (e.g. SMC³, P44, or
// direct carrier track endpoints) or poll a TMS webhook.

const TRACKING_EVENT_DESCRIPTIONS: Record<ShipmentStatus, string> = {
  pickup_scheduled: "Pickup has been scheduled",
  pickup_completed: "Pickup completed — shipment in carrier network",
  in_transit: "Shipment in transit to destination",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered — signed for",
  exception: "Exception encountered — carrier notified",
  delayed: "Shipment delayed",
  lost: "Shipment declared lost — investigation opened",
  damaged: "Shipment reported damaged",
};

/**
 * Generate a realistic-looking PRO number.
 */
export function generateProNumber(): string {
  const prefix = String(Math.floor(100 + Math.random() * 900));
  const seq = String(Math.floor(10000000 + Math.random() * 90000000));
  return `${prefix}${seq}`;
}

/**
 * Poll carrier tracking for a given PRO number.
 *
 * In production, this would make an HTTP request to the carrier's tracking
 * API. Here we return a plausible mock for engineering/testing purposes.
 *
 * @param proNumber — Carrier PRO number
 * @param scac — Carrier SCAC code
 * @param carrierName — Human-readable carrier name
 */
export async function trackShipment(
  proNumber: string,
  scac: string,
  carrierName: string,
): Promise<ShipmentTracking> {
  // In production: const response = await fetch(carrierTrackUrl(scac, proNumber));
  // Then parse and normalize the response.

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  const events: TrackingEvent[] = [
    {
      timestamp: twoDaysAgo.toISOString(),
      status: "pickup_completed",
      location: "Charlotte, NC",
      description: "Pickup completed — shipment in carrier network",
    },
    {
      timestamp: oneDayAgo.toISOString(),
      status: "in_transit",
      location: "Greensboro, NC",
      description: "Arrived at hub terminal",
    },
    {
      timestamp: twelveHoursAgo.toISOString(),
      status: "in_transit",
      location: "Richmond, VA",
      description: "Departed hub terminal",
    },
  ];

  return {
    proNumber,
    scac,
    carrierName,
    status: "in_transit",
    events,
    estimatedDelivery: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    lastUpdated: now.toISOString(),
    currentLocation: "Richmond, VA",
  };
}

/**
 * Build a human-readable tracking summary.
 */
export function formatTrackingSummary(tracking: ShipmentTracking): string {
  const statusEmoji: Record<ShipmentStatus, string> = {
    pickup_scheduled: "📅",
    pickup_completed: "📦",
    in_transit: "🚚",
    out_for_delivery: "🚛",
    delivered: "✅",
    exception: "⚠️",
    delayed: "⏰",
    lost: "🔍",
    damaged: "🔧",
  };

  const lines: string[] = [
    `${statusEmoji[tracking.status]} ${tracking.carrierName} — PRO# ${tracking.proNumber}`,
    `Status: ${tracking.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}`,
    `Current Location: ${tracking.currentLocation ?? "Unknown"}`,
    tracking.estimatedDelivery
      ? `Est. Delivery: ${new Date(tracking.estimatedDelivery).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
      : "",
    "",
    "Tracking History:",
    ...tracking.events.map(
      (e) =>
        `  ${new Date(e.timestamp).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })} — ${e.location}: ${e.description}`,
    ),
  ];

  return lines.filter(Boolean).join("\n");
}

/**
 * Generate a URL for carrier tracking page (if available).
 */
export function getCarrierTrackingUrl(scac: string, proNumber: string): string | null {
  const urls: Record<string, string> = {
    ODFL: `https://www.odfl.com/tracking?pro=${proNumber}`,
    XPOL: `https://www.xpo.com/tracking/${proNumber}`,
    ESTE: `https://www.estes-express.com/tracking/${proNumber}`,
    SAIA: `https://www.saia.com/tracking?pro=${proNumber}`,
    FXFE: `https://www.fedex.com/freight/tracking?pro=${proNumber}`,
  };
  return urls[scac] ?? null;
}