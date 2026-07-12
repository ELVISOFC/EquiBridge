# EquiBridge

Multi-supplier industrial product catalog normalization, blind dropshipping, LTL freight, and automated compliance platform.

## Project Structure

```
EquiBridge/
├── backend/          # Catalog ingestion engine (Type A/B API & CSV/FTP)
│   └── src/          #   - Product ingestion, transformation, unit normalization
│   └── prisma/       #   - Legacy Prisma schema (superseded by frontend)
│
├── freight/          # LTL heavy freight engine & PDF document rendering
│   └── src/          #   - LtlFreightEngine, rates, tracking
│   └── pdf/          #   - Headless Chrome blind-branded PDF generation
│                       (packing slips, warranty passports)
│
├── frontend/         # Main application — canonical active codebase
│   └── src/          #   - Order import pipeline (fraud, stock, queue)
│   └── services/     #   - EventBus, fulfillment bridge
│   └── search/       #   - Elasticsearch product index sync
│   └── ingestion/    #   - Unit normalization, attribute transformations
│   └── integrations/ #   - Shopify, Amazon SP-API webhook handlers
│   └── controllers/  #   - REST endpoints (order import API)
│   └── graphql/      #   - GraphQL catalog resolvers
│   └── middleware/    #   - Auth / webhook security
│   └── prisma/       #   - Canonical schema (Manufacturer, Product, SupplierListing,
│                       ProductAttributes, TaxonomyAttribute, Order, etc.)
│   └── test/         #   - 70+ unit tests
│
└── shared/
    └── db/           # Database migration artifacts
        ├── schema.prisma   # Canonical Prisma schema
        ├── migration.sql   # Full DDL migration
        └── backfill.ts     # Data migration script
```

## Key Features

- **Normalized Product Graph**: Products decoupled from suppliers via MPN+manufacturer matching
- **Unit Normalization**: 6-unit-family taxonomy registry (pressure, voltage, temperature, length, weight, torque)
- **Blind Dropshipping**: PDF engine generates seller-branded packing slips & warranty passports
- **LTL Freight Engine**: Multi-carrier rate quoting with lift-gate, inside delivery, and job-site accessorials
- **Fraud Gating**: 4-rule pipeline (high-ticket, velocity, first-time seller, new customer)
- **Multi-Tenant**: Per-seller storefronts with independent pricing and branding

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Database | PostgreSQL + JSONB (Prisma ORM) |
| Search | Elasticsearch (denormalized product index) |
| Backend | Node.js / TypeScript microservices |
| Queue | BullMQ with Redis |
| PDF | Headless Chrome (Playwright) |
| APIs | REST + GraphQL + Shopify / Amazon SP-API |

## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL
- Redis (for BullMQ)
- Elasticsearch (optional, app works without it)

### Installation

Each sub-project has its own `package.json`:

```bash
# Frontend (main application)
cd frontend
npm install
npx prisma generate
npm start

# Freight engine
cd freight
npm install

# Backend (ingestion engine)
cd backend
npm install
```

### Testing

```bash
cd frontend
npx vitest run    # 70+ tests covering all services
```

## Architecture

### Order Pipeline

```
Import → Validate → Fraud Check → Stock Verify → Reserve → Persist → Queue → Fulfillment Bridge → PDFs
```

### Catalog Ingestion

```
Supplier API/CSV → Raw Capture (SupplierListing.rawPayload) → MPN Matching → Canonical Product → Attribute Normalization → Elasticsearch Sync
```

## Revenue Model

- SaaS Platform Fee: Tiered subscriptions
- Transaction Commission: 1.5% - 2.5% per order
- Freight Margin: Default 8% markup on LTL carrier rates