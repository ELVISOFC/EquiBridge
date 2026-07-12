import { Request, Response, NextFunction } from 'express';
/**
 * Middleware to verify Shopify webhook HMAC signature.
 */
export declare const verifyShopifySignature: (req: any, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
/**
 * Middleware to ensure the merchant has valid credentials stored.
 */
export declare const merchantAuthMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=auth.d.ts.map