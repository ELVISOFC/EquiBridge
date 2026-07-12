import prisma from '../db';

/**
 * Resolves a productId from an external SKU.
 * Checks MPN, GTIN, and SupplierListing SKUs.
 */
export async function resolveProductId(sku: string): Promise<string | null> {
  if (!sku) return null;

  // 1. Try MPN (Manufacturer Part Number)
  const productByMpn = await prisma.product.findFirst({
    where: { mpn: sku },
    select: { id: true }
  });
  if (productByMpn) return productByMpn.id;

  // 2. Try GTIN (Global Trade Item Number)
  const productByGtin = await prisma.product.findFirst({
    where: { gtin: sku },
    select: { id: true }
  });
  if (productByGtin) return productByGtin.id;

  // 3. Try SupplierListing SKU
  const listing = await prisma.supplierListing.findFirst({
    where: { supplierSku: sku },
    select: { productId: true }
  });
  if (listing) return listing.productId;

  return null;
}
