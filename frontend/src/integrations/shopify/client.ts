export class ShopifyClient {
  constructor(private shop: string, private accessToken: string) {}

  async getProducts() {
    // Call Shopify GET /admin/api/2023-04/products.json
    return [];
  }

  async createProduct(productData: any) {
    // Call Shopify POST /admin/api/2023-04/products.json
    return { id: 'shopify-product-id' };
  }

  async updateInventory(inventoryItemId: string, locationId: string, available: number) {
    // Call Shopify POST /admin/api/2023-04/inventory_levels/set.json
  }
}
