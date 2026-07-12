"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAmazonNotification = void 0;
const express_1 = require("express");
const handleAmazonNotification = async (req, res) => {
    const payload = req.body;
    // Amazon SP-API notifications often come wrapped
    const notificationType = payload.notificationType;
    const sellerId = payload.sellerId;
    console.log(`Received Amazon notification: ${notificationType} from ${sellerId}`);
    switch (notificationType) {
        case 'ORDER_CHANGE':
            await handleOrderChange(payload);
            break;
        case 'LISTINGS_ITEM_STATUS_CHANGE':
            await handleListingChange(payload);
            break;
        default:
            console.log(`Unhandled Amazon notification type: ${notificationType}`);
    }
    res.status(200).send('Notification received');
};
exports.handleAmazonNotification = handleAmazonNotification;
const handleOrderChange = async (payload) => {
    // 1. Verify notification signature (if applicable/configured)
    // 2. Fetch full order details using SP-API if necessary
    // 3. Map to EquiBridge Order model
    // 4. Trigger BullMQ job
    console.log(`Processing Amazon order change for ${payload.payload?.OrderId}`);
};
const handleListingChange = async (payload) => {
    console.log(`Processing Amazon listing change for ${payload.sellerId}`);
};
//# sourceMappingURL=handler.js.map