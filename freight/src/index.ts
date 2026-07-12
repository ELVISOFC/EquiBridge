// ────────────────────────────────────────────────
// EquiBridge — Freight & PDF Engine
// ────────────────────────────────────────────────

// Freight / Logistics
export type {
  FreightClass,
  Dimensions,
  FreightLineItem,
  AccessorialServices,
  FreightAddress,
  LtlQuoteRequest,
  CarrierQuote,
  LtlQuoteResponse,
  ShipmentStatus,
  TrackingEvent,
  ShipmentTracking,
  DimensionalWeight,
} from "./types/freight.js";

export { DEFAULT_ACCESSORIALS } from "./types/freight.js";

// LTL Freight Engine
export { LtlFreightEngine } from "./freight/index.js";
export type { LtlFreightEngineOptions, CarrierProfile } from "./freight/index.js";

// Freight Rate Utilities
export {
  calculateDimensionalWeight,
  calculateBillableWeight,
  calculateTotalBillableWeight,
  calculateTotalCube,
  calculateBaseRatePerCwt,
  calculateFuelSurchargePercent,
  calculateAccessorialFees,
} from "./freight/rates.js";

// Tracking
export {
  trackShipment,
  formatTrackingSummary,
  generateProNumber,
  getCarrierTrackingUrl,
} from "./freight/tracking.js";

// PDF / Document Rendering
export {
  renderHtmlToPdf,
  generatePackingSlipPdf,
  generateWarrantyPassportPdf,
  shutdownPdfEngine,
  getBrandedCss,
  sanitizeSupplierInfo,
} from "./pdf/index.js";

export type {
  PdfRenderOptions,
  DocumentType,
  SellerBrand,
  PackingSlipData,
  WarrantyPassportData,
  WarrantyCoverage,
  WarrantyType,
} from "./pdf/index.js";