"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.merchantAuthMiddleware = exports.verifyShopifySignature = void 0;
const express_1 = require("express");
const crypto_1 = require("../utils/crypto");
/**
 * Middleware to verify Shopify webhook HMAC signature.
 */
const verifyShopifySignature = (req, res, next) => {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const secret = process.env.SHOPIFY_API_SECRET || 'test_secret';
    if (!hmac) {
        return res.status(401).send('Missing HMAC signature');
    }
    if (!req.rawBody) {
        return res.status(400).send('Missing raw body for verification');
    }
    const isValid = (0, crypto_1.verifyShopifyHMAC)(req.rawBody.toString(), hmac, secret);
    if (!isValid) {
        console.error('Invalid Shopify signature');
        return res.status(401).send('Invalid signature');
    }
    next();
};
exports.verifyShopifySignature = verifyShopifySignature;
/**
 * Middleware to ensure the merchant has valid credentials stored.
 */
const merchantAuthMiddleware = async (req, res, next) => {
    const sellerId = req.headers['x-equibridge-seller-id'];
    if (!sellerId) {
        return res.status(401).json({ error: 'Missing Seller ID' });
    }
    // Logic to check database for seller's Shopify/Amazon credentials
    // const credentials = await db.seller.findUnique({ where: { id: sellerId } });
    next();
};
exports.merchantAuthMiddleware = merchantAuthMiddleware;
//# sourceMappingURL=auth.js.map