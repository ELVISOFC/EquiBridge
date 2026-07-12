/**
 * Verify Shopify HMAC signature.
 */
export declare const verifyShopifyHMAC: (rawBody: string, hmac: string, secret: string) => boolean;
/**
 * Verify Amazon SP-API signature (Simple version for scaffolding).
 * In a real scenario, this involves verifying the signature header against the public key
 * provided by Amazon or checking the notification wrapper if it's via SNS/SQS.
 */
export declare const verifyAmazonSignature: (payload: any, signature: string, secret: string) => boolean;
//# sourceMappingURL=crypto.d.ts.map