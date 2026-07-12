// ────────────────────────────────────────────────
// EquiBridge — Usage Example
// ────────────────────────────────────────────────
//
// This example demonstrates the full pipeline:
//   1. Create an LTL quote request
//   2. Get carrier quotes
//   3. Generate a blind-branded packing slip PDF
//   4. Generate a Commercial Warranty Passport PDF
//
// Run: npx tsx examples/usage.ts

import { LtlFreightEngine } from "../src/freight/LtlFreightEngine.js";
import { generatePackingSlipPdf, generateWarrantyPassportPdf } from "../src/pdf/renderer.js";
import type { LtlQuoteRequest, FreightLineItem, FreightAddress } from "../src/types/freight.js";
import type { SellerBrand } from "../src/pdf/blindBranding.js";
import type { WarrantyCoverage } from "../src/pdf/templates/warrantyPassport.js";

const SELLER: SellerBrand = {
  storeName: "Acme Commercial Supply",
  phone: "1-800-555-0199",
  email: "orders@acmecommercial.example.com",
  website: "acmecommercial.example.com",
  address: {
    street: "100 Commerce Way",
    city: "Portland",
    state: "OR",
    zip: "97201",
  },
  footer: "Thank you for your partnership!",
};

const PICKUP: FreightAddress = {
  street: "123 Industrial Blvd",
  city: "Atlanta",
  state: "GA",
  zip: "30301",
  country: "US",
  isResidential: false,
};

const DELIVERY: FreightAddress = {
  street: "456 Commerce Dr",
  city: "Charlotte",
  state: "NC",
  zip: "28201",
  country: "US",
  isResidential: true,
};

const ITEMS: FreightLineItem[] = [
  {
    id: "CR-5000",
    description: "Commercial Refrigeration Unit - Model CR-5000",
    freightClass: 150,
    weightLb: 850,
    dimensions: { lengthIn: 48, widthIn: 40, heightIn: 60 },
    quantity: 1,
    stackable: false,
    hazardous: false,
  },
  {
    id: "ST-72",
    description: "Stainless Steel Prep Table - 72-inch",
    freightClass: 100,
    weightLb: 220,
    dimensions: { lengthIn: 72, widthIn: 36, heightIn: 8 },
    quantity: 2,
    stackable: true,
    hazardous: false,
  },
];

async function main() {
  console.log("═".repeat(60));
  console.log("  EquiBridge — Freight & Document Engine Demo");
  console.log("═".repeat(60));

  // ── 1. LTL Freight Quote ──────────────────────
  console.log("\n📦 Requesting LTL Quotes...\n");

  const engine = new LtlFreightEngine();
  const quoteRequest: LtlQuoteRequest = {
    requestId: "demo-req-001",
    pickup: PICKUP,
    delivery: DELIVERY,
    items: ITEMS,
    accessorials: {
      liftGateDelivery: true,
      residentialDelivery: true,
      preDeliveryNotification: true,
    },
  };

  const quoteResponse = await engine.getQuotes(quoteRequest);

  console.log(`  Request ID: ${quoteResponse.requestId}`);
  console.log(`  Generated:  ${quoteResponse.generatedAt}`);
  console.log(`  Quotes:     ${quoteResponse.quotes.length} carriers\n`);

  for (const quote of quoteResponse.quotes) {
    console.log(`  ${quote.carrierName} (${quote.scac})`);
    console.log(`    Service:    ${quote.serviceLevel}`);
    console.log(`    Transit:    ${quote.transitDays} business days`);
    console.log(`    Net:        $${quote.netChargeUsd.toFixed(2)}`);
    console.log(`    Fuel Surch: $${quote.fuelSurchargeUsd.toFixed(2)}`);
    console.log(`    Total:      $${quote.totalChargeUsd.toFixed(2)}`);
    if (quote.guaranteed) console.log("    ✅ Guaranteed");
    console.log();
  }

  if (quoteResponse.bestQuote) {
    console.log(`🏆 Best Quote: ${quoteResponse.bestQuote.carrierName} at $${quoteResponse.bestQuote.totalChargeUsd.toFixed(2)}`);
  }

  // ── 2. Generate Packing Slip PDF ──────────────
  console.log("\n📄 Generating blind-branded Packing Slip PDF...");

  await generatePackingSlipPdf(
    {
      orderNumber: "ORD-2026-001",
      seller: SELLER,
      shipTo: DELIVERY,
      billTo: {
        name: "Springfield Restaurant Group",
        street: "742 Evergreen Terrace",
        city: "Springfield",
        state: "IL",
        zip: "62701",
      },
      items: ITEMS,
      totalWeightLb: 1290,
      packageCount: 3,
      shipDate: "2026-06-18",
      carrierName: quoteResponse.bestQuote?.carrierName ?? "TBD",
      proNumber: "12345678901",
      specialInstructions: "Call 30 minutes before delivery. Lift gate required.",
    },
    "/tmp/equibridge-packing-slip.pdf",
  );

  console.log("  ✅ /tmp/equibridge-packing-slip.pdf");

  // ── 3. Generate Warranty Passport PDF ─────────
  console.log("\n📄 Generating Commercial Warranty Passport PDF...");

  const coverages: WarrantyCoverage[] = [
    {
      itemId: "CR-5000",
      description: "Commercial Refrigeration Unit - Model CR-5000",
      type: "manufacturer",
      duration: "3 Years",
      startDate: "2026-06-18",
      endDate: "2029-06-18",
      coverageDetails: "Parts and labor — compressor, condenser, evaporator, temperature controls",
      exclusions: "Damage from improper installation, unauthorized modifications, cosmetic issues, acts of nature",
      claimInstructions: "Contact Acme Commercial Supply at 1-800-555-0199 with order number CR-5000 and photographs of the issue.",
    },
    {
      itemId: "ST-72",
      description: "Stainless Steel Prep Table - 72-inch",
      type: "manufacturer",
      duration: "Lifetime",
      startDate: "2026-06-18",
      endDate: "2060-06-18",
      coverageDetails: "Manufacturing defects in stainless steel — pitting, corrosion, weld integrity",
      exclusions: "Normal wear, scratches, damage from improper cleaning, commercial misuse",
      claimInstructions: "Contact Acme Commercial Supply with proof of purchase and photos of the defect.",
    },
  ];

  await generateWarrantyPassportPdf(
    {
      passportId: "WP-2026-0001",
      seller: SELLER,
      customerName: "Springfield Restaurant Group",
      orderNumber: "ORD-2026-001",
      invoiceNumber: "INV-2026-001",
      purchaseDate: "2026-06-18",
      equipmentLocation: "742 Evergreen Terrace, Springfield, IL 62701",
      coverages,
      complianceCertificates: [
        {
          name: "NSF/ANSI 7 (Commercial Refrigeration)",
          certificateId: "NSF-CERT-2026-1234",
          issuingBody: "NSF International",
          issueDate: "2026-01-15",
          expiryDate: "2027-01-15",
        },
        {
          name: "UL 471 (Commercial Refrigeration)",
          certificateId: "UL-E123456",
          issuingBody: "Underwriters Laboratories",
          issueDate: "2026-02-01",
        },
        {
          name: "Certificate of Insurance",
          certificateId: "COI-2026-ACME-001",
          issuingBody: "Liberty Mutual Insurance",
          issueDate: "2026-01-01",
          expiryDate: "2027-01-01",
        },
      ],
      items: ITEMS,
    },
    "/tmp/equibridge-warranty-passport.pdf",
  );

  console.log("  ✅ /tmp/equibridge-warranty-passport.pdf");

  // ── Summary ───────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  ✅ Documents Generated");
  console.log("═".repeat(60));
  console.log("  Packing Slip:      /tmp/equibridge-packing-slip.pdf");
  console.log("  Warranty Passport: /tmp/equibridge-warranty-passport.pdf");
  console.log("═".repeat(60) + "\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});