"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addOrderToQueue = exports.orderQueue = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const connection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});
exports.orderQueue = new bullmq_1.Queue('order-processing', { connection });
const addOrderToQueue = async (orderData) => {
    await exports.orderQueue.add('process-order', orderData, {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
    });
};
exports.addOrderToQueue = addOrderToQueue;
//# sourceMappingURL=queue.js.map