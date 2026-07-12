import crypto from 'crypto';

/**
 * Verify Shopify HMAC signature.
 */
export const verifyShopifyHMAC = (rawBody: string, hmac: string, secret: string): boolean => {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  return hash === hmac;
};

/**
 * Verify Amazon SP-API signature (Simple version for scaffolding).
 * In a real scenario, this involves verifying the signature header against the public key
 * provided by Amazon or checking the notification wrapper if it's via SNS/SQS.
 */
export const verifyAmazonSignature = (payload: any, signature: string, secret: string): boolean => {
  // Mock verification for now
  console.log('Verifying Amazon signature...');
  return true;
};
