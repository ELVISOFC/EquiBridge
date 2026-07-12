"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const apollo_server_express_1 = require("apollo-server-express");
const schema_1 = require("@graphql-tools/schema");
const fs_1 = require("fs");
const path_1 = require("path");
const cors_1 = __importDefault(require("cors"));
const body_parser_1 = __importDefault(require("body-parser"));
const resolvers_1 = require("./graphql/resolvers");
const handler_1 = require("./integrations/shopify/handler");
const handler_2 = require("./integrations/amazon/handler");
const orderController_1 = require("./controllers/orderController");
const auth_1 = require("./middleware/auth");
async function startServer() {
    const app = (0, express_1.default)();
    const port = process.env.PORT || 3000;
    // Middleware
    app.use((0, cors_1.default)());
    app.use(body_parser_1.default.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        }
    }));
    // Webhook & Ingestion Endpoints
    app.post('/webhooks/shopify', auth_1.verifyShopifySignature, handler_1.handleShopifyWebhook);
    app.post('/webhooks/amazon', handler_2.handleAmazonNotification);
    app.post('/orders/import', auth_1.merchantAuthMiddleware, orderController_1.importOrders);
    // GraphQL Setup
    const typeDefs = (0, fs_1.readFileSync)((0, path_1.join)(__dirname, 'graphql/schema.graphql'), 'utf-8');
    const schema = (0, schema_1.makeExecutableSchema)({ typeDefs, resolvers: resolvers_1.resolvers });
    const server = new apollo_server_express_1.ApolloServer({
        schema,
        context: ({ req }) => ({
            sellerId: req.headers['x-equibridge-seller-id'],
        }),
    });
    await server.start();
    server.applyMiddleware({ app, path: '/graphql' });
    app.listen(port, () => {
        console.log(`EquiBridge Frontend & Integration Layer running at http://localhost:${port}`);
        console.log(`GraphQL endpoint: http://localhost:${port}${server.graphqlPath}`);
    });
}
startServer().catch((err) => {
    console.error('Error starting server:', err);
});
//# sourceMappingURL=server.js.map