import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { handleOrderFulfillment } from './services/fulfillmentBridge';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const orderWorker = new Worker(
  'order-processing',
  async (job: Job<{ orderId: string }>) => {
    const { orderId } = job.data;

    if (!orderId) {
      throw new Error('Job data missing required field: orderId');
    }

    console.log(`[Worker] Processing job ${job.id} for order ${orderId}`);

    // Delegate to the fulfillment bridge
    await handleOrderFulfillment(orderId);

    return { success: true, orderId };
  },
  { connection: connection as any }
);

orderWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed for order ${job.data.orderId}`);
});

orderWorker.on('failed', (job, err) => {
  console.error(
    `[Worker] Job ${job?.id} failed for order ${job?.data?.orderId}: ${err.message}`,
  );
});