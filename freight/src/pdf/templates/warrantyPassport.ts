// ────────────────────────────────────────────────
// EquiBridge — Commercial Warranty Passport Template
// ────────────────────────────────────────────────

import type { SellerBrand } from "../blindBranding.js";
import type { FreightLineItem } from "../../types/freight.js";

/**
 * Warranty coverage type.
 */
export type WarrantyType = "manufacturer" | "extended" | "labor_only" | "parts_only";

/**
 * A warranty coverage record for a specific product.
 */
export interface WarrantyCoverage {
  /** Product/item identifier */
  itemId: string;
  /** Product description */
  description: string;
  /** Warranty type */
  type: WarrantyType;
  /** Warranty duration description (e.g. "2 Years", "90 Days") */
  duration: string;
  /** Warranty start date (ISO 8601) */
  startDate: string;
  /** Warranty end date (ISO 8601) */
  endDate: string;
  /** What is covered */
  coverageDetails: string;
  /** What is NOT covered */
  exclusions: string;
  /** Any specific claim instructions */
  claimInstructions: string;
}

export interface WarrantyPassportData {
  /** Unique passport ID */
  passportId: string;
  /** Seller (storefront) branding */
  seller: SellerBrand;
  /** Customer name */
  customerName: string;
  /** Customer order number */
  orderNumber: string;
  /** Invoice/reference number */
  invoiceNumber: string;
  /** Purchase date (ISO 8601) */
  purchaseDate: string;
  /** Shipping address for the equipment */
  equipmentLocation: string;
  /** All warranty coverages included in this passport */
  coverages: WarrantyCoverage[];
  /** Any compliance certificates included (NSF, UL, COI, etc.) */
  complianceCertificates?: {
    name: string;
    certificateId: string;
    issuingBody: string;
    issueDate: string;
    expiryDate?: string;
  }[];
  /** List of line items covered */
  items: FreightLineItem[];
}

/**
 * Generate a Commercial Warranty Passport HTML string.
 *
 * This is a digital document issued at shipment time that serves as the
 * customer's single source of truth for all warranty and compliance info.
 */
export function renderWarrantyPassportHtml(data: WarrantyPassportData): string {
  const {
    passportId, seller, customerName, orderNumber, invoiceNumber,
    purchaseDate, equipmentLocation, coverages, complianceCertificates, items,
  } = data;

  const coverageRows = coverages
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.itemId)}</td>
        <td>${escapeHtml(c.description)}</td>
        <td><span class="badge badge-${c.type}">${escapeHtml(warrantyLabel(c.type))}</span></td>
        <td>${escapeHtml(c.duration)}</td>
        <td>${formatDate(c.startDate)}</td>
        <td>${formatDate(c.endDate)}</td>
        <td>${escapeHtml(c.coverageDetails)}</td>
      </tr>`,
    )
    .join("\n");

  const certRows = (complianceCertificates ?? [])
    .map(
      (cert) => `
      <tr>
        <td>${escapeHtml(cert.name)}</td>
        <td>${escapeHtml(cert.certificateId)}</td>
        <td>${escapeHtml(cert.issuingBody)}</td>
        <td>${formatDate(cert.issueDate)}</td>
        <td>${cert.expiryDate ? formatDate(cert.expiryDate) : "N/A"}</td>
      </tr>`,
    )
    .join("\n");

  const itemRows = items
    .map(
      (item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(item.description)}</td>
        <td>${item.quantity}</td>
        <td>${item.weightLb} lbs</td>
        <td>Class ${item.freightClass}</td>
      </tr>`,
    )
    .join("\n");

  const exclusionsSection = coverages.length > 0 ? `
  <div class="section">
    <h3>Exclusions & Claim Instructions</h3>
    ${coverages
      .map(
        (c) => `
      <div style="margin-bottom: 12px;">
        <strong>${escapeHtml(c.description)}</strong><br>
        <strong>Exclusions:</strong> ${escapeHtml(c.exclusions)}<br>
        <strong>To file a claim:</strong> ${escapeHtml(c.claimInstructions)}<br>
        <strong>Contact:</strong> ${escapeHtml(seller.storeName)}
        ${seller.phone ? " — " + escapeHtml(seller.phone) : ""}
        ${seller.email ? " — " + escapeHtml(seller.email) : ""}
      </div>`,
      )
      .join("\n")}
  </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Commercial Warranty Passport — ${escapeHtml(passportId)}</title>
  <style>
    .badge-manufacturer { background: #1a56db; }
    .badge-extended { background: #0d9488; }
    .badge-labor_only { background: #7c3aed; }
    .badge-parts_only { background: #d97706; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <h1>${escapeHtml(seller.storeName)}</h1>
      <div class="subtitle">Commercial Warranty Passport</div>
    </div>
    <div class="doc-title">
      <h2>WARRANTY PASSPORT</h2>
      <div class="doc-number">ID: ${escapeHtml(passportId)}</div>
    </div>
  </div>

  <div class="section">
    <h3>Passport Information</h3>
    <table>
      <tr><td style="width: 160px; font-weight: bold;">Passport ID</td><td>${escapeHtml(passportId)}</td></tr>
      <tr><td style="font-weight: bold;">Customer</td><td>${escapeHtml(customerName)}</td></tr>
      <tr><td style="font-weight: bold;">Order #</td><td>${escapeHtml(orderNumber)}</td></tr>
      <tr><td style="font-weight: bold;">Invoice #</td><td>${escapeHtml(invoiceNumber)}</td></tr>
      <tr><td style="font-weight: bold;">Purchase Date</td><td>${formatDate(purchaseDate)}</td></tr>
      <tr><td style="font-weight: bold;">Equipment Location</td><td>${escapeHtml(equipmentLocation)}</td></tr>
      <tr><td style="font-weight: bold;">Issued By</td><td>${escapeHtml(seller.storeName)}</td></tr>
    </table>
  </div>

  <div class="section">
    <h3>Warranty Coverages</h3>
    <table>
      <thead>
        <tr>
          <th>Item ID</th>
          <th>Product</th>
          <th>Type</th>
          <th>Duration</th>
          <th>Start</th>
          <th>End</th>
          <th>Coverage</th>
        </tr>
      </thead>
      <tbody>
        ${coverageRows}
      </tbody>
    </table>
  </div>

  ${complianceCertificates && complianceCertificates.length > 0 ? `
  <div class="section">
    <h3>Compliance Certificates</h3>
    <table>
      <thead>
        <tr>
          <th>Certificate</th>
          <th>ID</th>
          <th>Issuing Body</th>
          <th>Issue Date</th>
          <th>Expiry</th>
        </tr>
      </thead>
      <tbody>
        ${certRows}
      </tbody>
    </table>
  </div>` : ""}

  ${exclusionsSection}

  <div class="section">
    <h3>Covered Items</h3>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th>Qty</th>
          <th>Weight</th>
          <th>Class</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <div class="section" style="font-size: 9pt; color: #6b7280; border: 1px solid #e5e7eb; padding: 12px; border-radius: 4px;">
    <strong>Important:</strong> This Warranty Passport is your official record of warranty coverage for the equipment listed above.
    Please retain this document for the duration of the warranty period. To file a claim, contact
    ${escapeHtml(seller.storeName)} with your Passport ID (${escapeHtml(passportId)}) and Order Number (${escapeHtml(orderNumber)}).
    This document is a binding warranty certificate issued by ${escapeHtml(seller.storeName)}.
  </div>

  <div class="footer">
    ${seller.footer ?? "Commercial Warranty Passport — EquiBridge Platform"}
    <br>
    Passport ID: ${escapeHtml(passportId)} | Generated: ${new Date().toISOString().split("T")[0]}
  </div>
</body>
</html>`;
}

function warrantyLabel(type: WarrantyType): string {
  switch (type) {
    case "manufacturer": return "Manufacturer";
    case "extended": return "Extended";
    case "labor_only": return "Labor Only";
    case "parts_only": return "Parts Only";
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}