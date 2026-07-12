"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleShopifyWebhook = void 0;
const db_1 = __importDefault(require("../../db"));
const queue_1 = require("../../queue");
const handleShopifyWebhook = async (req, res) => {
    const topic = req.headers['x-shopify-topic'];
    const shop = req.headers['x-shopify-shop-domain'];
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
exports.handleShopifyWebhook = handleShopifyWebhook;
const handleOrderCreate = async (payload, shop) => {
    // 1. Find seller by shop domain
    const seller = await db_1.default.seller.findFirst({
        where: { shopifyStoreUrl: shop }
    });
    if (!seller) {
        console.error(`Seller not found for shop: ${shop}`);
        return;
    }
    // 2. Map and save order as PENDING
    const order = await db_1.default.order.create({
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
    await (0, queue_1.addOrderToQueue)({ orderId: order.id, payload });
    console.log(`Order ${order.id} saved and queued for shop ${shop}`);
};
//# sourceMappingURL=handler.js.map