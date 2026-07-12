import { importOrder, importOrdersBulk, ImportOrderInput } from '../services/orderImportService';

/**
 * POST /orders/import
 * Single order import with full stock verification, inventory reserve,
 * and high-ticket fraud/velocity gating.
 *
 * Request body:
 * {
 *   sellerId: string,
 *   externalOrderId?: string,
 *   totalAmount: number,
 *   shippingAddress: object,
 *   billingAddress: object,
 *   customerEmail?: string,
 *   customerPhone?: string,
 *   items: [{ productId: string, quantity: number, unitPrice: number }],
 *   source?: "shopify" | "amazon" | "manual"
 * }
 */
export const importSingleOrder = async (req: any, res: any) => {
  try {
    const input: ImportOrderInput = {
      sellerId: req.body.sellerId,
      externalOrderId: req.body.externalOrderId,
      totalAmount: parseFloat(req.body.totalAmount) || 0,
      shippingAddress: req.body.shippingAddress || {},
      billingAddress: req.body.billingAddress || {},
      customerEmail: req.body.customerEmail,
      customerPhone: req.body.customerPhone,
      items: (req.body.items || []).map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
      })),
      source: req.body.source || 'manual',
    };

    const result = await importOrder(input);

    if (result.success) {
      return res.status(201).json({
        message: 'Order imported and stock reserved',
        orderId: result.orderId,
        status: result.status,
        fraudFlags: result.fraudResult?.flags || [],
      });
    }

    // Partial success — order created but blocked or had issues
    const statusCode =
      result.orderId && result.status === 'PENDING' ? 202 : 400;

    return res.status(statusCode).json({
      message: 'Order import completed with issues',
      orderId: result.orderId,
      status: result.status,
      errors: result.errors,
      fraudFlags: result.fraudResult?.flags || [],
      insufficientStock: result.stockResult?.insufficient || [],
    });
  } catch (error) {
    console.error('Order import failed:', error);
    return res.status(500).json({
      error: 'Internal server error during order import',
    });
  }
};

/**
 * POST /orders/import/bulk
 * Bulk import multiple orders with independent validation per order.
 *
 * Request body:
 * {
 *   orders: [ { sellerId, items, totalAmount, ... } ]
 * }
 */
export const importBulkOrders = async (req: any, res: any) => {
  try {
    const orders: ImportOrderInput[] = (req.body.orders || []).map(
      (o: any) => ({
        sellerId: o.sellerId,
        externalOrderId: o.externalOrderId,
        totalAmount: parseFloat(o.totalAmount) || 0,
        shippingAddress: o.shippingAddress || {},
        billingAddress: o.billingAddress || {},
        customerEmail: o.customerEmail,
        customerPhone: o.customerPhone,
        items: (o.items || []).map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity || 1,
          unitPrice: parseFloat(item.unitPrice) || 0,
        })),
        source: o.source || 'manual',
      }),
    );

    const results = await importOrdersBulk(orders);

    const summary = {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      blocked: results.filter((r) => !r.success).length,
      results,
    };

    return res.status(200).json(summary);
  } catch (error) {
    console.error('Bulk order import failed:', error);
    return res.status(500).json({
      error: 'Internal server error during bulk order import',
    });
  }
};

/**
 * Legacy handler — kept for backward compatibility.
 * Calls the new single-order importer under the hood.
 */
export const importOrders = async (req: any, res: any) => {
  const { orders, source } = req.body;

  if (!orders || orders.length === 0) {
    return res.status(400).json({ error: 'No orders provided' });
  }

  // If a single order with sellerId, use the new pipeline
  if (orders.length === 1 && orders[0].sellerId) {
    req.body = { ...orders[0], source: source || 'shopify' };
    return importSingleOrder(req, res);
  }

  // Bulk path
  req.body.orders = orders.map((o: any) => ({
    ...o,
    source: source || 'shopify',
  }));
  return importBulkOrders(req, res);
};