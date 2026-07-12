// ────────────────────────────────────────────────
// EquiBridge — Freight Engine Tests
// ────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { LtlFreightEngine } from "../src/freight/LtlFreightEngine.js";
import {
  calculateDimensionalWeight,
  calculateBillableWeight,
  calculateTotalBillableWeight,
  calculateTotalCube,
  calculateBaseRatePerCwt,
  calculateFuelSurchargePercent,
} from "../src/freight/rates.js";
import { generateProNumber, formatTrackingSummary } from "../src/freight/tracking.js";
import type { FreightLineItem, LtlQuoteRequest } from "../src/types/freight.js";

// ─── Rate Utilities ──────────────────────────────

describe("calculateDimensionalWeight", () => {
  it("computes dim weight for standard dimensions", () => {
    // 48×40×36 = 69120 cu in / 166 = 416.4 → ceil 417
    const result = calculateDimensionalWeight(
      { lengthIn: 48, widthIn: 40, heightIn: 36 },
      166,
    );
    expect(result).toBe(417);
  });

  it("uses default dim factor of 166", () => {
    const result = calculateDimensionalWeight({
      lengthIn: 24,
      widthIn: 20,
      heightIn: 18,
    });
    expect(result).toBe(53); // 8640 / 166 = 52.05 → ceil 53
  });

  it("returns at least 1 for tiny items", () => {
    const result = calculateDimensionalWeight({
      lengthIn: 1,
      widthIn: 1,
      heightIn: 1,
    });
    expect(result).toBe(1);
  });
});

describe("calculateBillableWeight", () => {
  const item: FreightLineItem = {
    id: "item-1",
    description: "Test Widget",
    freightClass: 100,
    weightLb: 250,
    dimensions: { lengthIn: 48, widthIn: 40, heightIn: 36 },
    quantity: 1,
    stackable: true,
    hazardous: false,
  };

  it("uses the greater of actual vs dim weight", () => {
    const result = calculateBillableWeight(item);
    // actual=250, dim=417 → billable=417
    expect(result.billableWeightLb).toBe(417);
    expect(result.actualWeightLb).toBe(250);
    expect(result.dimensionalWeightLb).toBe(417);
  });

  it("uses actual weight when it exceeds dim weight", () => {
    const heavyItem = { ...item, weightLb: 500 };
    const result = calculateBillableWeight(heavyItem);
    expect(result.billableWeightLb).toBe(500);
  });
});

describe("calculateTotalBillableWeight", () => {
  it("sums billable weights across items", () => {
    const items: FreightLineItem[] = [
      {
        id: "a",
        description: "Pallet A",
        freightClass: 100,
        weightLb: 200,
        dimensions: { lengthIn: 40, widthIn: 40, heightIn: 40 },
        quantity: 2,
        stackable: true,
        hazardous: false,
      },
      {
        id: "b",
        description: "Pallet B",
        freightClass: 85,
        weightLb: 150,
        dimensions: { lengthIn: 48, widthIn: 36, heightIn: 24 },
        quantity: 1,
        stackable: true,
        hazardous: false,
      },
    ];
    const result = calculateTotalBillableWeight(items);
    // Pallet A: 40×40×40 = 64000/166 = 386 (ceil) * 2 = 772
    // Pallet B: 48×36×24 = 41472/166 = 250 (ceil) * 1 = 250
    // Total = 1022
    expect(result.totalWeightLb).toBe(1022);
  });
});

describe("calculateTotalCube", () => {
  it("computes total cubic feet", () => {
    const items: FreightLineItem[] = [
      {
        id: "a",
        description: "Pallet A",
        freightClass: 100,
        weightLb: 200,
        dimensions: { lengthIn: 48, widthIn: 40, heightIn: 36 },
        quantity: 2,
        stackable: true,
        hazardous: false,
      },
    ];
    // 48*40*36 = 69120 cu in × 2 = 138240 / 1728 = 80 cu ft
    expect(calculateTotalCube(items)).toBeCloseTo(80, 0);
  });
});

describe("calculateBaseRatePerCwt", () => {
  it("returns sensible values for common scenarios", () => {
    // 500 miles, class 100, 2000 lbs
    const rate = calculateBaseRatePerCwt(500, 100, 2000);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(50);
  });

  it("higher class = higher rate", () => {
    const lowClass = calculateBaseRatePerCwt(500, 70, 2000);
    const highClass = calculateBaseRatePerCwt(500, 200, 2000);
    expect(highClass).toBeGreaterThan(lowClass);
  });

  it("longer distance = higher rate", () => {
    const short = calculateBaseRatePerCwt(100, 100, 2000);
    const long = calculateBaseRatePerCwt(2500, 100, 2000);
    expect(long).toBeGreaterThan(short);
  });
});

describe("calculateFuelSurchargePercent", () => {
  it("returns 0 at or below threshold", () => {
    expect(calculateFuelSurchargePercent(1.20)).toBe(0);
    expect(calculateFuelSurchargePercent(1.00)).toBe(0);
  });

  it("returns positive percentage above threshold", () => {
    // $4.20/gal → (4.20 - 1.20) / 0.05 = 60 increments → 60%
    expect(calculateFuelSurchargePercent(4.20)).toBe(60);
  });
});

// ─── LTL Freight Engine ──────────────────────────

describe("LtlFreightEngine", () => {
  const engine = new LtlFreightEngine({ dieselPricePerGallon: 3.50 });

  const sampleRequest: LtlQuoteRequest = {
    requestId: "req-test-001",
    pickup: {
      street: "123 Industrial Blvd",
      city: "Atlanta",
      state: "GA",
      zip: "30301",
      country: "US",
      isResidential: false,
    },
    delivery: {
      street: "456 Commerce Dr",
      city: "Charlotte",
      state: "NC",
      zip: "28201",
      country: "US",
      isResidential: false,
    },
    items: [
      {
        id: "widget-1",
        description: "Commercial Refrigeration Unit",
        freightClass: 150,
        weightLb: 850,
        dimensions: { lengthIn: 48, widthIn: 40, heightIn: 60 },
        quantity: 1,
        stackable: false,
        hazardous: false,
      },
    ],
  };

  it("returns quotes for a valid request", async () => {
    const response = await engine.getQuotes(sampleRequest);
    expect(response.quotes.length).toBeGreaterThan(0);
    expect(response.requestId).toBe("req-test-001");
    expect(response.bestQuote).toBeTruthy();
    expect(response.fastestQuote).toBeTruthy();
  });

  it("quotes have all required fields", async () => {
    const response = await engine.getQuotes(sampleRequest);
    for (const quote of response.quotes) {
      expect(quote.carrierName).toBeTruthy();
      expect(quote.scac).toBeTruthy();
      expect(quote.totalChargeUsd).toBeGreaterThan(0);
      expect(quote.netChargeUsd).toBeGreaterThan(0);
      expect(quote.transitDays).toBeTruthy();
      expect(quote.quoteExpiresAt).toBeTruthy();
    }
  });

  it("includes accessorials when requested", async () => {
    const requestWithLiftGate: LtlQuoteRequest = {
      ...sampleRequest,
      requestId: "req-test-002",
      accessorials: { liftGateDelivery: true, residentialDelivery: true },
    };
    const response = await engine.getQuotes(requestWithLiftGate);
    expect(response.bestWithLiftGate).toBeTruthy();
    for (const quote of response.quotes) {
      expect(quote.additionalFees.length).toBeGreaterThan(0);
    }
  });

  it("sorts quotes by price ascending", async () => {
    const response = await engine.getQuotes(sampleRequest);
    for (let i = 1; i < response.quotes.length; i++) {
      expect(response.quotes[i].totalChargeUsd).toBeGreaterThanOrEqual(
        response.quotes[i - 1].totalChargeUsd,
      );
    }
  });

  it("identifies fastest quote", async () => {
    const response = await engine.getQuotes(sampleRequest);
    if (response.quotes.length > 1) {
      expect(response.fastestQuote).toBeTruthy();
      expect(response.fastestQuote!.transitDays).toBeTruthy();
    }
  });
});

// ─── Tracking ────────────────────────────────────

describe("generateProNumber", () => {
  it("generates a 11-digit PRO number", () => {
    const pro = generateProNumber();
    expect(pro.length).toBe(11);
    expect(pro).toMatch(/^\d{11}$/);
  });
});

describe("formatTrackingSummary", () => {
  it("returns a readable summary", async () => {
    const { trackShipment } = await import("../src/freight/tracking.js");
    const tracking = await trackShipment("12345678901", "ODFL", "Old Dominion");
    const summary = formatTrackingSummary(tracking);
    expect(summary).toContain("Old Dominion");
    expect(summary).toContain("12345678901");
    expect(summary).toContain("Tracking History");
  });
});