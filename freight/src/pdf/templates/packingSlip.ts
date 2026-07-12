// ────────────────────────────────────────────────
// EquiBridge — Packing Slip HTML Template
// ────────────────────────────────────────────────

import type { SellerBrand } from "../blindBranding.js";
import type { FreightAddress, FreightLineItem } from "../../types/freight.js";

export interface PackingSlipData {
  /** Order / invoice reference number */
  orderNumber: string;
  /** Seller (storefront) branding */
  seller: SellerBrand;
  /** Customer shipping address */
  shipTo: FreightAddress;
  /** Customer billing address */
  billTo: {
    name: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  /** Line items being shipped */
  items: FreightLineItem[];
  /** Total weight of shipment */
  totalWeightLb: number;
  /** Number of packages/pallets */
  packageCount: number;
  /** Ship date */
  shipDate: string;
  /** Carrier name */
  carrierName: string;
  /** PRO number */
  proNumber: string;
  /** Any special instructions */
  specialInstructions?: string;
}

/**
 * Generate a fully blind-branded packing slip HTML string.
 *
 * The packing slip shows only the seller's branding (not the supplier's).
 * All supplier identifiers have been stripped.
 */
export function renderPackingSlipHtml(data: PackingSlipData): string {
  const { seller, shipTo, billTo, items, totalWeightLb, packageCount, shipDate, carrierName, proNumber, specialInstructions, orderNumber } = data;

  const itemsHtml = items
    .map(
      (item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(item.description)}</td>
        <td>${item.quantity}</td>
        <td>${item.weightLb} lbs</td>
        <td>${item.dimensions.lengthIn}"×${item.dimensions.widthIn}"×${item.dimensions.heightIn}"</td>
        <td>Class ${item.freightClass}</td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Packing Slip — ${escapeHtml(orderNumber)}</title>
  <style>
    ${seller.footer ? "" : ""}
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <h1>${escapeHtml(seller.storeName)}</h1>
      ${seller.website ? `<div class="subtitle">${escapeHtml(seller.website)}</div>` : ""}
      ${seller.phone ? `<div class="subtitle">${escapeHtml(seller.phone)}</div>` : ""}
    </div>
    <div class="doc-title">
      <h2>PACKING SLIP</h2>
      <div class="doc-number">Order #${escapeHtml(orderNumber)}</div>
    </div>
  </div>

  <div class="section">
    <div class="address-block">
      <div>
        <h4>Ship To</h4>
        ${escapeHtml(shipTo.street)}<br>
        ${escapeHtml(shipTo.city)}, ${escapeHtml(shipTo.state)} ${escapeHtml(shipTo.zip)}<br>
        ${shipTo.isResidential ? '<span class="badge">Residential</span>' : ""}
      </div>
      <div>
        <h4>Bill To</h4>
        ${escapeHtml(billTo.name)}<br>
        ${escapeHtml(billTo.street)}<br>
        ${escapeHtml(billTo.city)}, ${escapeHtml(billTo.state)} ${escapeHtml(billTo.zip)}
      </div>
    </div>
  </div>

  <div class="section">
    <h3>Shipment Details</h3>
    <p>
      <strong>Ship Date:</strong> ${escapeHtml(shipDate)} &nbsp;|&nbsp;
      <strong>Carrier:</strong> ${escapeHtml(carrierName)} &nbsp;|&nbsp;
      <strong>PRO#:</strong> ${escapeHtml(proNumber)} &nbsp;|&nbsp;
      <strong>Pallets/Packages:</strong> ${packageCount} &nbsp;|&nbsp;
      <strong>Total Weight:</strong> ${totalWeightLb} lbs
    </p>
  </div>

  <div class="section">
    <h3>Items Shipped</h3>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th>Qty</th>
          <th>Weight</th>
          <th>Dimensions</th>
          <th>Class</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
  </div>

  ${specialInstructions ? `
  <div class="section">
    <h3>Special Instructions</h3>
    <p>${escapeHtml(specialInstructions)}</p>
  </div>` : ""}

  ${seller.address ? `
  <div class="section" style="font-size: 9pt; color: #6b7280;">
    <p>
      ${escapeHtml(seller.storeName)} &bull;
      ${seller.address.street ? escapeHtml(seller.address.street) + " &bull; " : ""}
      ${seller.address.city ? escapeHtml(seller.address.city) + ", " : ""}${seller.address.state ?? ""} ${seller.address.zip ?? ""}
      ${seller.phone ? "&bull; " + escapeHtml(seller.phone) : ""}
      ${seller.email ? "&bull; " + escapeHtml(seller.email) : ""}
    </p>
  </div>` : ""}

  <div class="footer">
    ${seller.footer ? escapeHtml(seller.footer) : "Thank you for your business!"}
    <br>
    This document is confidential. Do not disclose supplier information.
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}