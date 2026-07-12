// ────────────────────────────────────────────────
// EquiBridge — Headless Chrome PDF Renderer
// ────────────────────────────────────────────────

import { chromium } from "playwright";
import type { Browser } from "playwright";

/**
 * Subset of Page.pdf() options that this engine accepts.
 */
interface PdfPageOptions {
  format?: "Letter" | "Legal" | "Tabloid" | "Ledger" | "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  landscape?: boolean;
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  scale?: number;
  tagged?: boolean;
}
import { getBrandedCss, type SellerBrand } from "./blindBranding.js";
import { renderPackingSlipHtml, type PackingSlipData } from "./templates/packingSlip.js";
import { renderWarrantyPassportHtml, type WarrantyPassportData } from "./templates/warrantyPassport.js";

export type DocumentType = "packing-slip" | "warranty-passport";

export interface PdfRenderOptions {
  /** Seller brand for document header/footer */
  seller: SellerBrand;
  /** Document type */
  docType: DocumentType;
  /** Scale factor (default: 1.0) */
  scale?: number;
  /** Whether to generate a tagged/accessible PDF (default: false) */
  tagged?: boolean;
  /** Custom footer HTML (overrides default) */
  footerHtml?: string;
  /** Custom header HTML (overrides default) */
  headerHtml?: string;
  /** Paper format (default: "Letter") */
  format?: "Letter" | "Legal" | "Tabloid" | "Ledger" | "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  /** Landscape orientation (default: false) */
  landscape?: boolean;
  /** Margins in inches (default: 0.5in all sides) */
  margin?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
}

// ─── Browser Pool ────────────────────────────────

let _browser: Browser | null = null;
let _browserRefCount = 0;

/**
 * Get or create a shared headless Chromium browser instance.
 * Uses reference counting so we don't launch browsers unnecessarily.
 */
async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  _browserRefCount++;
  return _browser;
}

/**
 * Release a browser reference. When all references are released,
 * the browser will be closed.
 */
async function releaseBrowser(): Promise<void> {
  _browserRefCount--;
  if (_browserRefCount <= 0 && _browser) {
    await _browser.close();
    _browser = null;
    _browserRefCount = 0;
  }
}

// ─── PDF Generation ───────────────────────────────

/**
 * Render an HTML document to PDF using Headless Chrome.
 *
 * @param html — Fully formed HTML string to render
 * @param outputPath — File path to write the PDF to
 * @param options — Rendering options (page size, margins, etc.)
 */
export async function renderHtmlToPdf(
  html: string,
  outputPath: string,
  options: PdfPageOptions = {},
): Promise<void> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: 816, height: 1056 }, // Letter proportions
    deviceScaleFactor: 2, // High-quality rendering
  });

  try {
    await page.setContent(html, {
      waitUntil: "networkidle",
    });

    await page.pdf({
      path: outputPath,
      format: options.format ?? "Letter",
      landscape: options.landscape ?? false,
      margin: options.margin ?? {
        top: "0.5in",
        bottom: "0.5in",
        left: "0.5in",
        right: "0.5in",
      },
      scale: options.scale ?? 1.0,
      tagged: options.tagged ?? false,
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await page.close();
    await releaseBrowser();
  }
}

/**
 * Generate a blind-branded packing slip PDF.
 *
 * @param data — Packing slip data
 * @param outputPath — File path to write to
 * @param options — PDF rendering options
 */
export async function generatePackingSlipPdf(
  data: PackingSlipData,
  outputPath: string,
  options: Partial<PdfRenderOptions> = {},
): Promise<void> {
  // Inject the seller's branded CSS
  const css = getBrandedCss(data.seller, "packing-slip");
  const html = renderPackingSlipHtml(data);

  // Wrap the HTML with the CSS
  const fullHtml = wrapWithStyles(html, css);

  await renderHtmlToPdf(fullHtml, outputPath, {
    format: options.format,
    landscape: options.landscape,
    margin: options.margin,
    scale: options.scale,
    tagged: options.tagged,
  });
}

/**
 * Generate a Commercial Warranty Passport PDF.
 *
 * @param data — Warranty passport data
 * @param outputPath — File path to write to
 * @param options — PDF rendering options
 */
export async function generateWarrantyPassportPdf(
  data: WarrantyPassportData,
  outputPath: string,
  options: Partial<PdfRenderOptions> = {},
): Promise<void> {
  const css = getBrandedCss(data.seller, "warranty-passport");
  const html = renderWarrantyPassportHtml(data);

  const fullHtml = wrapWithStyles(html, css);

  await renderHtmlToPdf(fullHtml, outputPath, {
    format: options.format,
    landscape: options.landscape,
    margin: options.margin,
    scale: options.scale,
    tagged: options.tagged,
  });
}

/**
 * Clean up and close the shared browser instance.
 * Call this when your application is shutting down.
 */
export async function shutdownPdfEngine(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
    _browserRefCount = 0;
  }
}

// ─── Internal Helpers ─────────────────────────────

function wrapWithStyles(bodyHtml: string, css: string): string {
  // If the HTML already has a <style> tag, inject before it
  if (bodyHtml.includes("</head>")) {
    return bodyHtml.replace(
      "</head>",
      `<style>${css}</style></head>`,
    );
  }
  // Otherwise wrap the body in a full document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}