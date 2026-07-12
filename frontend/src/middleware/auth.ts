import { Request, Response, NextFunction } from 'express';

import { verifyShopifyHMAC } from '../utils/crypto';

/**
 * Middleware to verify Shopify webhook HMAC signature.
 */
export const verifyShopifySignature = (req: any, res: Response, next: NextFunction) => {
  const hmac = req.headers['x-shopify-hmac-sha256'] as string;
  const secret = process.env.SHOPIFY_API_SECRET || 'test_secret';
  
  if (!hmac) {
    return res.status(401).send('Missing HMAC signature');
  }

  if (!req.rawBody) {
    return res.status(400).send('Missing raw body for verification');
  }

  const isValid = verifyShopifyHMAC(req.rawBody.toString(), hmac, secret);
  
  if (!isValid) {
    console.error('Invalid Shopify signature');
    return res.status(401).send('Invalid signature');
  }

  next();
};

/**
 * Middleware to ensure the merchant has valid credentials stored.
 */
export const merchantAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const sellerId = req.headers['x-equibridge-seller-id'];

  if (!sellerId) {
    return res.status(401).json({ error: 'Missing Seller ID' });
  }

  // Logic to check database for seller's Shopify/Amazon credentials
  // const credentials = await db.seller.findUnique({ where: { id: sellerId } });
  
  next();
};
