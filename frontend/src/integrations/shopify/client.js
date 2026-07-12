"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyClient = void 0;
class ShopifyClient {
    shop;
    accessToken;
    constructor(shop, accessToken) {
        this.shop = shop;
        this.accessToken = accessToken;
    }
    async getProducts() {
        // Call Shopify GET /admin/api/2023-04/products.json
        return [];
    }
    async createProduct(productData) {
        // Call Shopify POST /admin/api/2023-04/products.json
        return { id: 'shopify-product-id' };
    }
    async updateInventory(inventoryItemId, locationId, available) {
        // Call Shopify POST /admin/api/2023-04/inventory_levels/set.json
    }
}
exports.ShopifyClient = ShopifyClient;
//# sourceMappingURL=client.js.map