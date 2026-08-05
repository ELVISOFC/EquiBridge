import prisma from '../../db';
import { importOrder, ImportOrderInput } from '../../services/orderImportService';

export const handleShopifyWebhook = async (req: any, res: any) => {
  const topic = req.headers['x-shopify-topic'] as string;
  const shop = req.headers['x-shopify-shop-domain'] as string;
  const payload = req.body;

  console.log(`Received Shopify webhook: ${topic} from ${shop}`);

  switch (topic) {
    case 'orders/create':
      await handleOrderCreate(payload, shop, res);
      break;
    default:
      console.log(`Unhandled Shopify topic: ${topic}`);
      res.status(200).send('Webhook received');
  }
};

const handleOrderCreate = (payload: any, shop: string, res: any) => {
  (async () => {
    // 1. Find seller by shop domain
    const seller = await prisma.seller.findFirst({
      where: { shopifyStoreUrl: shop }
    });

    if (!seller) {
      console.error(`Seller not found for shop: ${shop}`);
      return res.status(404).json({ error: 'Seller not found' });
    }

    // 2. Map Shopify order to ImportOrderInput
    const items = (payload.line_items || []).map((item: any) => ({
      productId: item.product_id?.toString() || item.sku || '',
      quantity: item.quantity || 1,
      unitPrice: parseFloat(item.price) || 0,
    }));

    const input: ImportOrderInput = {
      sellerId: seller.id,
      externalOrderId: payload.id.toString(),
      totalAmount: parseFloat(payload.total_price) || 0,
      shippingAddress: payload.shipping_address || {},
      billingAddress: payload.billing_address || {},
      customerEmail: payload.email || payload.contact_email,
      customerPhone: payload.phone || (payload.shipping_address?.phone),
      items,
      source: 'shopify',
    };

    // 3. Run through the full order import pipeline (validation, fraud, stock, reserve, persist, queue)
    const result = await importOrder(input);

    // 4. Return appropriate HTTP status
    if (result.success && result.status === 'RESERVED') {
      return res.status(201).json({
        message: 'Order imported and stock reserved',
        orderId: result.orderId,
        status: result.status,
      });
    } else if (result.status === 'PENDING') {
      return res.status(202).json({
        message: 'Order imported — pending review',
        orderId: result.orderId,
        status: result.status,
        fraudFlags: result.fraudResult?.flags || [],
        errors: result.errors,
      });
    } else {
      return res.status(400).json({
        message: 'Order blocked',
        status: result.status,
        errors: result.errors,
      });
    }
  })().catch(err => {
    console.error('Shopify order import failed:', err);
    res.status(500).json({ error: 'Internal server error during order import' });
  });
};
