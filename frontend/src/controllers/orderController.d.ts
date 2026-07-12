import { Request, Response } from 'express';
/**
 * Endpoint to manually trigger or receive bulk order imports.
 * Used for both Shopify and Amazon incoming order webhooks.
 */
export declare const importOrders: (req: Request, res: Response) => Promise<void>;
//# sourceMappingURL=orderController.d.ts.map