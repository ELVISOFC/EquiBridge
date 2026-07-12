import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { readFileSync } from 'fs';
import { join } from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';

import { resolvers } from './graphql/resolvers';
import { handleShopifyWebhook } from './integrations/shopify/handler';
import { handleAmazonNotification } from './integrations/amazon/handler';
import { importOrders } from './controllers/orderController';
import { verifyShopifySignature, merchantAuthMiddleware } from './middleware/auth';

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // Middleware
  app.use(cors());
  app.use(bodyParser.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    }
  }));

  // Webhook & Ingestion Endpoints
  app.post('/webhooks/shopify', verifyShopifySignature, handleShopifyWebhook);
  app.post('/webhooks/amazon', handleAmazonNotification);
  app.post('/orders/import', merchantAuthMiddleware, importOrders);

  // GraphQL Setup
  const typeDefs = readFileSync(join(__dirname, 'graphql/schema.graphql'), 'utf-8');
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const server = new ApolloServer({
    schema,
    context: ({ req }) => ({
      sellerId: req.headers['x-equibridge-seller-id'],
    }),
  });

  await server.start();
  server.applyMiddleware({ app: app as any, path: '/graphql' });

  app.listen(port as number, '0.0.0.0', () => {
    console.log(`EquiBridge Frontend & Integration Layer running at http://localhost:${port}`);
    console.log(`GraphQL endpoint: http://localhost:${port}${server.graphqlPath}`);
  });
}

startServer().catch((err) => {
  console.error('Error starting server:', err);
});
