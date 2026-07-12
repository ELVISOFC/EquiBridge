export {
  renderHtmlToPdf,
  generatePackingSlipPdf,
  generateWarrantyPassportPdf,
  shutdownPdfEngine,
} from "./renderer.js";
export type { PdfRenderOptions, DocumentType } from "./renderer.js";

export {
  getBrandedCss,
  sanitizeSupplierInfo,
} from "./blindBranding.js";
export type { SellerBrand } from "./blindBranding.js";

export { renderPackingSlipHtml } from "./templates/packingSlip.js";
export type { PackingSlipData } from "./templates/packingSlip.js";

export { renderWarrantyPassportHtml } from "./templates/warrantyPassport.js";
export type { WarrantyPassportData, WarrantyCoverage, WarrantyType } from "./templates/warrantyPassport.js";