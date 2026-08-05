import { importOrder, ImportOrderInput } from '../../services/orderImportService';

export const handleAmazonNotification = async (req: any, res: any) => {
  const payload = req.body;

  const notificationType = payload.notificationType;
  const sellerId = payload.sellerId;

  console.log(`Received Amazon notification: ${notificationType} from ${sellerId}`);

  switch (notificationType) {
    case 'ORDER_CHANGE':
      await handleOrderChange(payload, sellerId, res);
      break;
    default:
      console.log(`Unhandled Amazon notification type: ${notificationType}`);
      res.status(200).send('Notification received');
  }
};

const handleOrderChange = (payload: any, sellerId: string, res: any) => {
  (async () => {
    const amazonOrder = payload.payload?.Order;
    if (!amazonOrder) {
      return res.status(400).json({ error: 'Missing order data' });
    }

    // Map Amazon order items
    const items = (amazonOrder.OrderItems?.OrderItem || []).map((item: any) => ({
      productId: item.ASIN || item.SellerSKU || '',
      quantity: parseInt(item.QuantityOrdered) || 1,
      unitPrice: parseFloat(item.ItemPrice?.Amount || item.ItemTax?.Amount || '0'),
    }));

    if (items.length === 0) {
      // Fallback: single item from order total
      items.push({
        productId: amazonOrder.OrderId,
        quantity: 1,
        unitPrice: parseFloat(amazonOrder.OrderTotal?.Amount || '0'),
      });
    }

    const input: ImportOrderInput = {
      sellerId,
      externalOrderId: amazonOrder.OrderId,
      totalAmount: parseFloat(amazonOrder.OrderTotal?.Amount || '0'),
      shippingAddress: amazonOrder.ShippingAddress || {},
      billingAddress: {},
      customerEmail: amazonOrder.BuyerInfo?.BuyerEmail,
      items,
      source: 'amazon',
    };

    const result = await importOrder(input);

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
    console.error('Amazon order import failed:', err);
    res.status(500).json({ error: 'Internal server error during order import' });
  });
};
