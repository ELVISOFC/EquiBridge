// ────────────────────────────────────────────────
// EquiBridge — PDF Rendering Tests
// ────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { renderPackingSlipHtml } from "../src/pdf/templates/packingSlip.js";
import { renderWarrantyPassportHtml } from "../src/pdf/templates/warrantyPassport.js";
import { getBrandedCss } from "../src/pdf/blindBranding.js";
import type { SellerBrand } from "../src/pdf/blindBranding.js";
import type { FreightLineItem, FreightAddress } from "../src/types/freight.js";

const testSeller: SellerBrand = {
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
  footer: "Thank you for choosing Acme Commercial Supply!",
};

const testAddress: FreightAddress = {
  street: "742 Evergreen Terrace",
  city: "Springfield",
  state: "IL",
  zip: "62701",
  country: "US",
  isResidential: true,
};

const testItems: FreightLineItem[] = [
  {
    id: "item-001",
    description: "Commercial Refrigeration Unit - Model CR-5000",
    freightClass: 150,
    weightLb: 850,
    dimensions: { lengthIn: 48, widthIn: 40, heightIn: 60 },
    quantity: 1,
    stackable: false,
    hazardous: false,
  },
  {
    id: "item-002",
    description: "Stainless Steel Prep Table - 72-inch",
    freightClass: 100,
    weightLb: 220,
    dimensions: { lengthIn: 72, widthIn: 36, heightIn: 8 },
    quantity: 2,
    stackable: true,
    hazardous: false,
  },
];

describe("Packing Slip HTML", () => {
  it("renders valid HTML with all required fields", () => {
    const html = renderPackingSlipHtml({
      orderNumber: "ORD-2026-001",
      seller: testSeller,
      shipTo: testAddress,
      billTo: {
        name: "Springfield Restaurant Group",
        street: "742 Evergreen Terrace",
        city: "Springfield",
        state: "IL",
        zip: "62701",
      },
      items: testItems,
      totalWeightLb: 1290,
      packageCount: 3,
      shipDate: "2026-06-17",
      carrierName: "Old Dominion Freight Line",
      proNumber: "12345678901",
      specialInstructions: "Call 30 minutes before delivery",
    });

    expect(html).toContain("PACKING SLIP");
    expect(html).toContain("ORD-2026-001");
    expect(html).toContain("Acme Commercial Supply");
    expect(html).toContain("Old Dominion Freight Line");
    expect(html).toContain("Commercial Refrigeration Unit");
    expect(html).toContain("1290 lbs");
    expect(html).toContain("Springfield, IL 62701");
    expect(html).toContain("Call 30 minutes before delivery");
  });

  it("does NOT contain any supplier identifiers", () => {
    const html = renderPackingSlipHtml({
      orderNumber: "ORD-2026-002",
      seller: testSeller,
      shipTo: testAddress,
      billTo: {
        name: "Test Customer",
        street: "123 Main St",
        city: "Portland",
        state: "OR",
        zip: "97201",
      },
      items: testItems,
      totalWeightLb: 1290,
      packageCount: 3,
      shipDate: "2026-06-17",
      carrierName: "Estes Express Lines",
      proNumber: "98765432100",
    });

    // Should NOT contain typical supplier identifiers
    expect(html).not.toContain("Supplier");
    expect(html).not.toContain("Distributor");
    // Seller brand is present, not supplier
    expect(html).toContain("Acme Commercial Supply");
  });
});

describe("Warranty Passport HTML", () => {
  it("renders valid HTML with coverage table", () => {
    const html = renderWarrantyPassportHtml({
      passportId: "WP-2026-0001",
      seller: testSeller,
      customerName: "Springfield Restaurant Group",
      orderNumber: "ORD-2026-001",
      invoiceNumber: "INV-2026-001",
      purchaseDate: "2026-06-17",
      equipmentLocation: "742 Evergreen Terrace, Springfield, IL 62701",
      coverages: [
        {
          itemId: "item-001",
          description: "Commercial Refrigeration Unit - Model CR-5000",
          type: "manufacturer",
          duration: "3 Years",
          startDate: "2026-06-17",
          endDate: "2029-06-17",
          coverageDetails: "Parts and labor — compressor, condenser, evaporator, controls",
          exclusions: "Damage from improper installation, unauthorized modifications, cosmetic issues",
          claimInstructions: "Contact Acme Commercial Supply with order number and photos of the issue",
        },
      ],
      complianceCertificates: [
        {
          name: "NSF/ANSI 7",
          certificateId: "NSF-CERT-2026-1234",
          issuingBody: "NSF International",
          issueDate: "2026-01-15",
          expiryDate: "2027-01-15",
        },
        {
          name: "UL 471",
          certificateId: "UL-E123456",
          issuingBody: "Underwriters Laboratories",
          issueDate: "2026-02-01",
        },
      ],
      items: testItems,
    });

    expect(html).toContain("WARRANTY PASSPORT");
    expect(html).toContain("WP-2026-0001");
    expect(html).toContain("Acme Commercial Supply");
    expect(html).toContain("Springfield Restaurant Group");
    expect(html).toContain("3 Years");
    expect(html).toContain("NSF/ANSI 7");
    expect(html).toContain("UL 471");
    expect(html).toContain("Parts and labor");
  });
});

describe("Blind Branding CSS", () => {
  it("generates valid CSS for packing slips", () => {
    const css = getBrandedCss(testSeller, "packing-slip");
    expect(css).toContain("font-family");
    expect(css).toContain("@page");
    expect(css).toContain(".header");
    expect(css).toContain(".footer");
  });

  it("generates valid CSS for warranty passports", () => {
    const css = getBrandedCss(testSeller, "warranty-passport");
    expect(css).toContain("font-family");
    expect(css).toContain("@page");
  });

  it("applies CSS overrides when provided", () => {
    const overrideSeller: SellerBrand = {
      ...testSeller,
      cssOverrides: "body { color: red; }",
    };
    const css = getBrandedCss(overrideSeller, "packing-slip");
    expect(css).toContain("color: red");
  });
});