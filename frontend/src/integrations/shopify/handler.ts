import prisma from '../../db';
import { addOrderToQueue } from '../../queue';

export const handleShopifyWebhook = async (req: any, res: any) => {
  const topic = req.headers['x-shopify-topic'] as string;
  const shop = req.headers['x-shopify-shop-domain'] as string;
  const payload = req.body;

  console.log(`Received Shopify webhook: ${topic} from ${shop}`);

  switch (topic) {
    case 'orders/create':
      await handleOrderCreate(payload, shop);
      break;
    default:
      console.log(`Unhandled Shopify topic: ${topic}`);
  }

  res.status(200).send('Webhook received');
};

const handleOrderCreate = async (payload: any, shop: string) => {
  // 1. Find seller by shop domain
  const seller = await prisma.seller.findFirst({
    where: { shopifyStoreUrl: shop }
  });

  if (!seller) {
    console.error(`Seller not found for shop: ${shop}`);
    return;
  }

  // 2. Map and save order as PENDING
  const order = await prisma.order.create({
    data: {
      sellerId: seller.id,
      externalOrderId: payload.id.toString(),
      totalAmount: parseFloat(payload.total_price),
      shippingAddress: payload.shipping_address || {},
      billingAddress: payload.billing_address || {},
      status: 'PENDING',
    }
  });

  // 3. Add to BullMQ
  await addOrderToQueue({ orderId: order.id, payload });
  
  console.log(`Order ${order.id} saved and queued for shop ${shop}`);
};

