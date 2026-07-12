import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const orderQueue = new Queue('order-processing', { connection: connection as any });

export interface OrderQueueData {
  orderId: string;
  externalOrderId?: string;
  source?: string;
  sellerId: string;
}

export const addOrderToQueue = async (orderData: OrderQueueData) => {
  await orderQueue.add('process-order', orderData, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  });
};