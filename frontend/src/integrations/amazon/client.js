"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmazonSPAPIClient = void 0;
class AmazonSPAPIClient {
    sellerId;
    credentials;
    constructor(sellerId, credentials) {
        this.sellerId = sellerId;
        this.credentials = credentials;
    }
    async getOrders() {
        // Call Amazon SP-API GET /orders/v0/orders
        return [];
    }
    async updateListingsItem(sku, payload) {
        // Call Amazon SP-API PATCH /listings/2021-08-01/items/{sellerId}/{sku}
    }
    async createNotificationSubscription(notificationType, destinationId) {
        // Call Amazon SP-API POST /notifications/v1/subscriptions
    }
}
exports.AmazonSPAPIClient = AmazonSPAPIClient;
//# sourceMappingURL=client.js.map