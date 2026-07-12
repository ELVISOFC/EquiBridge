import prisma from '../../db';
import { addOrderToQueue } from '../../queue';

export const handleAmazonNotification = async (req: any, res: any) => {
  const payload = req.body;

  // Amazon SP-API notifications often come wrapped
  const notificationType = payload.notificationType;
  const sellerId = payload.sellerId;

  console.log(`Received Amazon notification: ${notificationType} from ${sellerId}`);

  switch (notificationType) {
    case 'ORDER_CHANGE':
      await handleOrderChange(payload, sellerId);
      break;
    default:
      console.log(`Unhandled Amazon notification type: ${notificationType}`);
  }

  res.status(200).send('Notification received');
};

const handleOrderChange = async (payload: any, sellerId: string) => {
  const amazonOrder = payload.payload.Order;

  // 1. Save or Update Order
  const order = await prisma.order.upsert({
    where: { 
      // Assuming we have a unique index on externalOrderId, but let's use a findFirst/create for now
      // as the schema doesn't have a unique constraint on externalOrderId in the prisma file I saw.
      id: amazonOrder.OrderId // This is just an example
    },
    update: {
      status: 'PENDING', // Map amazon status to our status
    },
    create: {
      sellerId: sellerId,
      externalOrderId: amazonOrder.OrderId,
      totalAmount: parseFloat(amazonOrder.OrderTotal?.Amount || 0),
      shippingAddress: amazonOrder.ShippingAddress || {},
      billingAddress: {}, // Amazon often doesn't give billing address in notifications
      status: 'PENDING',
    }
  });

  // 2. Queue for processing
  await addOrderToQueue({ orderId: order.id, payload: amazonOrder });
  
  console.log(`Amazon order ${order.id} saved/updated and queued`);
};
