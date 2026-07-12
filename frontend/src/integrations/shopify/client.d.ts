export declare class ShopifyClient {
    private shop;
    private accessToken;
    constructor(shop: string, accessToken: string);
    getProducts(): Promise<never[]>;
    createProduct(productData: any): Promise<{
        id: string;
    }>;
    updateInventory(inventoryItemId: string, locationId: string, available: number): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map