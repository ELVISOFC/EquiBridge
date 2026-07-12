export declare class AmazonSPAPIClient {
    private sellerId;
    private credentials;
    constructor(sellerId: string, credentials: any);
    getOrders(): Promise<never[]>;
    updateListingsItem(sku: string, payload: any): Promise<void>;
    createNotificationSubscription(notificationType: string, destinationId: string): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map