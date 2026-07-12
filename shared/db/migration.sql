-- =============================================================================
-- EquiBridge — Schema Refactor Migration
-- Decouples canonical products from supplier listings and adds:
--   manufacturers, categories, product_attributes, taxonomy_attributes
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New tables
-- ---------------------------------------------------------------------------

-- 1a. Manufacturers
CREATE TABLE IF NOT EXISTS manufacturers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    website TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 1b. Categories (hierarchical)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    parent_id UUID REFERENCES categories(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- 1c. Re-engineered Products (canonical, decoupled from supplier)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mpn VARCHAR(100) NOT NULL,
    gtin VARCHAR(50),
    manufacturer_id UUID REFERENCES manufacturers(id),
    global_category_id UUID REFERENCES categories(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpn_manufacturer ON products(mpn, manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_products_mpn ON products(mpn);
CREATE INDEX IF NOT EXISTS idx_products_gtin ON products(gtin);

-- 1d. Supplier Listings (replaces direct Product→Supplier link)
CREATE TABLE IF NOT EXISTS supplier_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    supplier_sku VARCHAR(100) NOT NULL,
    raw_payload JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_sku ON supplier_listings(supplier_id, supplier_sku);
CREATE INDEX IF NOT EXISTS idx_supplier_listings_product ON supplier_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_listings_supplier ON supplier_listings(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_listings_active ON supplier_listings(is_active);

-- 1e. Product Attributes (normalized typed attributes in JSONB)
CREATE TABLE IF NOT EXISTS product_attributes (
    product_id UUID PRIMARY KEY REFERENCES products(id),
    normalized_attributes JSONB NOT NULL DEFAULT '{}',
    attribute_units JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_normalized_attrs_gin ON product_attributes USING gin (normalized_attributes);

-- 1f. Taxonomy Attributes (global unit normalization registry)
CREATE TABLE IF NOT EXISTS taxonomy_attributes (
    attribute_key VARCHAR(255) PRIMARY KEY,
    expected_data_type VARCHAR(10) NOT NULL CHECK (expected_data_type IN ('NUMERIC', 'STRING')),
    allowed_units JSONB,
    base_unit TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Migrate existing Product data into new tables
--    (name-based matching for Manufacturer, slug-based for Category)
-- ---------------------------------------------------------------------------

-- 2a. Populate manufacturers from existing product categories (best-effort mapping)
INSERT INTO manufacturers (id, name)
SELECT gen_random_uuid(), COALESCE(NULLIF(p.category, ''), 'Unknown Manufacturer')
FROM (SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '') p
ON CONFLICT (name) DO NOTHING;

-- 2b. Populate categories
INSERT INTO categories (id, name, slug)
SELECT gen_random_uuid(), c.name, lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g'))
FROM (SELECT DISTINCT category AS name FROM products WHERE category IS NOT NULL AND category != '') c
ON CONFLICT (slug) DO NOTHING;

-- 2c. Insert into new products table from old products
INSERT INTO products (id, mpn, title, description, manufacturer_id, global_category_id)
SELECT
    p.id,
    COALESCE(p.sku, p.id) AS mpn,
    p.name AS title,
    p.description,
    m.id AS manufacturer_id,
    cat.id AS global_category_id
FROM products_old p
LEFT JOIN manufacturers m ON m.name = COALESCE(NULLIF(p.category, ''), 'Unknown Manufacturer')
LEFT JOIN categories cat ON cat.name = p.category;

-- ---------------------------------------------------------------------------
-- 3. Migrate SupplierSku → SupplierListing
-- ---------------------------------------------------------------------------

INSERT INTO supplier_listings (id, product_id, supplier_id, supplier_sku, raw_payload, is_active)
SELECT
    ss.id,
    ss.product_id,
    ss.supplier_id,
    ss.sku AS supplier_sku,
    jsonb_build_object(
        'original_price', ss.price,
        'original_inventory', ss.inventoryCount,
        'migrated_from', 'SupplierSku',
        'migrated_at', NOW()
    ) AS raw_payload,
    TRUE AS is_active
FROM supplier_skus ss;

-- ---------------------------------------------------------------------------
-- 4. Migrate InventorySnapshot → point to supplier_listings
-- ---------------------------------------------------------------------------

-- First add the FK column if it doesn't exist
ALTER TABLE inventory_snapshots ADD COLUMN IF NOT EXISTS supplier_listing_id UUID REFERENCES supplier_listings(id);

-- Backfill supplier_listing_id
UPDATE inventory_snapshots inv
SET supplier_listing_id = sl.id
FROM supplier_listings sl
WHERE inv.supplier_sku_id IS NOT NULL
  AND sl.id = inv.supplier_sku_id;

-- For snapshots that still reference old product_id directly
UPDATE inventory_snapshots inv
SET supplier_listing_id = sl.id
FROM supplier_listings sl
WHERE inv.supplier_listing_id IS NULL
  AND inv.product_id IS NOT NULL
  AND sl.product_id = inv.product_id;

-- ---------------------------------------------------------------------------
-- 5. Populate product_attributes from existing product specifications
-- ---------------------------------------------------------------------------

INSERT INTO product_attributes (product_id, normalized_attributes, attribute_units)
SELECT
    p.id,
    COALESCE(p.specifications, '{}'::jsonb),
    '{}'::jsonb
FROM products p
ON CONFLICT (product_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Seed taxonomy_attributes with common industrial attribute definitions
-- ---------------------------------------------------------------------------

INSERT INTO taxonomy_attributes (attribute_key, expected_data_type, allowed_units, base_unit) VALUES
    ('operating_pressure', 'NUMERIC', '["psi", "bar", "kPa"]', 'psi'),
    ('max_pressure', 'NUMERIC', '["psi", "bar", "kPa"]', 'psi'),
    ('burst_pressure', 'NUMERIC', '["psi", "bar", "kPa"]', 'psi'),
    ('voltage', 'NUMERIC', '["V", "kV"]', 'V'),
    ('power', 'NUMERIC', '["W", "kW", "HP"]', 'W'),
    ('temperature_min', 'NUMERIC', '["°F", "°C", "F", "C"]', '°F'),
    ('temperature_max', 'NUMERIC', '["°F", "°C", "F", "C"]', '°F'),
    ('length', 'NUMERIC', '["in", "ft", "mm", "cm", "m"]', 'in'),
    ('width', 'NUMERIC', '["in", "ft", "mm", "cm", "m"]', 'in'),
    ('height', 'NUMERIC', '["in", "ft", "mm", "cm", "m"]', 'in'),
    ('weight', 'NUMERIC', '["lbs", "kg", "oz"]', 'lbs'),
    ('torque', 'NUMERIC', '["ft-lb", "Nm"]', 'ft-lb'),
    ('flow_rate', 'NUMERIC', '["GPM", "LPM"]', 'GPM'),
    ('material', 'STRING', NULL, NULL),
    ('connection_type', 'STRING', NULL, NULL),
    ('body_material', 'STRING', NULL, NULL),
    ('seat_material', 'STRING', NULL, NULL),
    ('certification', 'STRING', NULL, NULL)
ON CONFLICT (attribute_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Drop old tables (after data migration is verified)
--    Tables are kept temporarily for rollback safety.
--    Run this separately once migration is validated.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS inventory_snapshots_old;
-- DROP TABLE IF EXISTS supplier_skus;
-- DROP TABLE IF EXISTS products_old;