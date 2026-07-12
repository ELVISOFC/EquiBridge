"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAmazonSignature = exports.verifyShopifyHMAC = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Verify Shopify HMAC signature.
 */
const verifyShopifyHMAC = (rawBody, hmac, secret) => {
    const hash = crypto_1.default
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');
    return hash === hmac;
};
exports.verifyShopifyHMAC = verifyShopifyHMAC;
/**
 * Verify Amazon SP-API signature (Simple version for scaffolding).
 * In a real scenario, this involves verifying the signature header against the public key
 * provided by Amazon or checking the notification wrapper if it's via SNS/SQS.
 */
const verifyAmazonSignature = (payload, signature, secret) => {
    // Mock verification for now
    console.log('Verifying Amazon signature...');
    return true;
};
exports.verifyAmazonSignature = verifyAmazonSignature;
//# sourceMappingURL=crypto.js.map