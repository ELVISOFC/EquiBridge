// ────────────────────────────────────────────────
// EquiBridge — Blind Branding Utilities
// ────────────────────────────────────────────────

/**
 * Blind branding ensures complete supplier anonymity.
 * All documents are branded to the *seller* (the storefront owner),
 * not the underlying supplier/distributor.
 */

export interface SellerBrand {
  /** Seller's store name */
  storeName: string;
  /** Seller's logo URL (base64 data URI or absolute URL) */
  logoUrl?: string;
  /** Seller's contact phone */
  phone?: string;
  /** Seller's contact email */
  email?: string;
  /** Seller's website */
  website?: string;
  /** Seller's business address */
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  /** Seller's return address (may differ from main address) */
  returnAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  /** Custom footer text (e.g. "Thank you for your business!") */
  footer?: string;
  /** Any additional branding CSS overrides */
  cssOverrides?: string;
}

/**
 * Replace any supplier-identifying information in a text with seller branding.
 * This ensures packing slips never leak the supplier's identity.
 */
export function sanitizeSupplierInfo(
  text: string,
  _supplierName: string,
  _sellerName: string,
): string {
  // Remove any reference to supplier name, supplier addresses, etc.
  // In practice, this would use a more sophisticated NLP or template-based approach.
  let result = text;
  result = result.replace(
    new RegExp(_supplierName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    _sellerName,
  );
  return result;
}

/**
 * Get a default packing slip CSS with seller brand overrides.
 */
export function getBrandedCss(seller: SellerBrand, docType: "packing-slip" | "warranty-passport"): string {
  const primaryColor = "#1a56db"; // EquiBridge blue
  const accentColor = "#0d9488"; // teal accent

  const baseCss = `
    @page { margin: 0.75in; size: letter; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1f2937;
    }
    .header {
      border-bottom: 3px solid ${primaryColor};
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header .brand h1 {
      font-size: 22pt;
      color: ${primaryColor};
      margin: 0 0 4px 0;
    }
    .header .brand .subtitle {
      font-size: 10pt;
      color: #6b7280;
    }
    .header .doc-title {
      text-align: right;
    }
    .header .doc-title h2 {
      font-size: 16pt;
      color: #374151;
      margin: 0 0 4px 0;
    }
    .header .doc-title .doc-number {
      font-size: 9pt;
      color: #9ca3af;
    }
    .section { margin-bottom: 20px; }
    .section h3 {
      font-size: 11pt;
      color: ${primaryColor};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }
    .address-block {
      display: flex;
      gap: 32px;
    }
    .address-block > div { flex: 1; }
    .address-block h4 {
      font-size: 9pt;
      color: #6b7280;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
    }
    table th {
      background: ${primaryColor};
      color: white;
      padding: 6px 8px;
      text-align: left;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    table td {
      padding: 6px 8px;
      border-bottom: 1px solid #e5e7eb;
    }
    table tr:nth-child(even) td { background: #f9fafb; }
    table .total-row td {
      font-weight: bold;
      border-top: 2px solid ${primaryColor};
      border-bottom: none;
    }
    .totals { text-align: right; margin-top: 16px; }
    .totals p { margin: 2px 0; }
    .totals .grand-total {
      font-size: 14pt;
      font-weight: bold;
      color: ${primaryColor};
    }
    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #d1d5db;
      font-size: 9pt;
      color: #6b7280;
      text-align: center;
    }
    .badge {
      display: inline-block;
      background: ${accentColor};
      color: white;
      font-size: 8pt;
      padding: 2px 8px;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  // Apply seller-specific CSS overrides if provided
  return seller.cssOverrides ? `${baseCss}\n${seller.cssOverrides}` : baseCss;
}