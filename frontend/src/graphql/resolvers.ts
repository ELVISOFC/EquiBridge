import prisma from '../db';
import { GraphQLScalarType, Kind } from 'graphql';

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  serialize(value) {
    return value;
  },
  parseValue(value) {
    return value;
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.OBJECT) {
      return ast;
    }
    return null;
  },
});

export const resolvers = {
  JSON: JSONScalar,
  Query: {
    getSellerListings: async (_: any, { sellerId, limit, offset }: any) => {
      // In a real multi-tenant scenario, we might query curated listings
      // For now, we mock it by querying Products through SupplierSkus if needed
      // or if we had a SellerListing model (which isn't in the DB schema yet,
      // but was in my GraphQL scaffold). 
      // The DB schema from backend_eng has Product, SupplierSku, but no SellerListing.
      // I'll adjust the resolver to work with the provided DB schema.
      
      return prisma.product.findMany({
        take: limit || 10,
        skip: offset || 0,
      });
    },
    getListing: async (_: any, { id }: any) => {
      return prisma.product.findUnique({ where: { id } });
    },
  },
  Mutation: {
    createListing: async (_: any, { productId, sellerId, markupPercentage }: any) => {
      // This might involve creating a relation or a curated record
      return null; 
    },
  },
  SellerListing: {
    product: async (parent: any) => {
      return prisma.product.findUnique({ where: { id: parent.id } });
    },
  }
};
