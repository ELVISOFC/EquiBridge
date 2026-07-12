"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderWorker = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const connection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});
exports.orderWorker = new bullmq_1.Worker('order-processing', async (job) => {
    console.log(`Processing job ${job.id} for order ${job.data.id}`);
    // 1. Logic to process order
    // 2. Interact with DB via Prisma
    // 3. Trigger logistics / warranty services
    return { success: true };
}, { connection });
exports.orderWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed!`);
});
exports.orderWorker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed with error: ${err.message}`);
});
//# sourceMappingURL=worker.js.map