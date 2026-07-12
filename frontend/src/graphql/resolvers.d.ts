import { GraphQLScalarType } from 'graphql';
export declare const resolvers: {
    JSON: GraphQLScalarType<unknown, unknown>;
    Query: {
        getSellerListings: (_: any, { sellerId, limit, offset }: any) => Promise<{
            name: string;
            description: string | null;
            id: string;
            category: string | null;
            specifications: import("@prisma/client/runtime/client").JsonValue;
            certifications: import("@prisma/client/runtime/client").JsonValue;
            createdAt: Date;
            updatedAt: Date;
        }[]>;
        getListing: (_: any, { id }: any) => Promise<{
            name: string;
            description: string | null;
            id: string;
            category: string | null;
            specifications: import("@prisma/client/runtime/client").JsonValue;
            certifications: import("@prisma/client/runtime/client").JsonValue;
            createdAt: Date;
            updatedAt: Date;
        } | null>;
    };
    Mutation: {
        createListing: (_: any, { productId, sellerId, markupPercentage }: any) => Promise<null>;
    };
    SellerListing: {
        product: (parent: any) => Promise<{
            name: string;
            description: string | null;
            id: string;
            category: string | null;
            specifications: import("@prisma/client/runtime/client").JsonValue;
            certifications: import("@prisma/client/runtime/client").JsonValue;
            createdAt: Date;
            updatedAt: Date;
        } | null>;
    };
};
//# sourceMappingURL=resolvers.d.ts.map