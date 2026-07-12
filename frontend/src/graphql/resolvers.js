"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvers = void 0;
const db_1 = __importDefault(require("../db"));
const graphql_1 = require("graphql");
const JSONScalar = new graphql_1.GraphQLScalarType({
    name: 'JSON',
    description: 'JSON custom scalar type',
    serialize(value) {
        return value;
    },
    parseValue(value) {
        return value;
    },
    parseLiteral(ast) {
        if (ast.kind === graphql_1.Kind.OBJECT) {
            return ast;
        }
        return null;
    },
});
exports.resolvers = {
    JSON: JSONScalar,
    Query: {
        getSellerListings: async (_, { sellerId, limit, offset }) => {
            // In a real multi-tenant scenario, we might query curated listings
            // For now, we mock it by querying Products through SupplierSkus if needed
            // or if we had a SellerListing model (which isn't in the DB schema yet,
            // but was in my GraphQL scaffold). 
            // The DB schema from backend_eng has Product, SupplierSku, but no SellerListing.
            // I'll adjust the resolver to work with the provided DB schema.
            return db_1.default.product.findMany({
                take: limit || 10,
                skip: offset || 0,
            });
        },
        getListing: async (_, { id }) => {
            return db_1.default.product.findUnique({ where: { id } });
        },
    },
    Mutation: {
        createListing: async (_, { productId, sellerId, markupPercentage }) => {
            // This might involve creating a relation or a curated record
            return null;
        },
    },
    SellerListing: {
        product: async (parent) => {
            return db_1.default.product.findUnique({ where: { id: parent.id } });
        },
    }
};
//# sourceMappingURL=resolvers.js.map