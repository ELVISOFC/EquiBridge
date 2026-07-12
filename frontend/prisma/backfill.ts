/**
 * EquiBridge — Schema Refactor Backfill Migration Script
 *
 * Migrates existing data from the old schema (Product → SupplierSku → InventorySnapshot)
 * to the new schema (Manufacturer → Product → SupplierListing → InventorySnapshot).
 *
 * This script is designed to be run ONCE against the production database.
 * It uses the Prisma client and can be invoked via:
 *   npx ts-node prisma/backfill.ts
 *
 * Migration steps:
 * 1. Create Manufacturer records from existing product categories
 * 2. Create Category records from existing product categories
 * 3. Migrate old Product records to new canonical Product records
 * 4. Migrate SupplierSku records to SupplierListing records
 * 5. Migrate InventorySnapshot records to point to SupplierListings
 * 6. Populate ProductAttributes from existing product specifications
 * 7. Seed TaxonomyAttributes registry
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfill() {
  console.log('=== Starting Schema Refactor Backfill ===\n');

  // -----------------------------------------------------------------------
  // Step 1: Manufacturers
  // -----------------------------------------------------------------------
  console.log('[1/7] Creating Manufacturer records...');
  const existingCategories = await prisma.$queryRaw<
    Array<{ category: string }>
  >`SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''`;

  let manufacturerCount = 0;
  for (const row of existingCategories) {
    const name = row.category;
    const existing = await prisma.manufacturer.findUnique({ where: { name } });
    if (!existing) {
      await prisma.manufacturer.create({ data: { name, website: null } });
      manufacturerCount++;
    }
  }
  console.log(`  Created ${manufacturerCount} manufacturers`);

  // -----------------------------------------------------------------------
  // Step 2: Categories
  // -----------------------------------------------------------------------
  console.log('[2/7] Creating Category records...');
  let categoryCount = 0;
  for (const row of existingCategories) {
    const name = row.category;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (!existing) {
      await prisma.category.create({ data: { name, slug } });
      categoryCount++;
    }
  }
  console.log(`  Created ${categoryCount} categories`);

  // -----------------------------------------------------------------------
  // Step 3: Migrate old Product records to new Products table
  // -----------------------------------------------------------------------
  console.log('[3/7] Migrating old Product records...');

  const oldProducts = await prisma.product.findMany({
    include: { supplier: true },
  });

  let productMigrateCount = 0;
  for (const oldP of oldProducts) {
    const manufacturer = oldP.category
      ? await prisma.manufacturer.findUnique({
          where: { name: oldP.category },
        })
      : null;

    const category = oldP.category
      ? await prisma.category.findUnique({
          where: {
            slug: oldP.category
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, ''),
          },
        })
      : null;

    // Check if product already exists (by ID — it's the same table in an in-place migration)
    const existingNew = await prisma.product.findUnique({
      where: { id: oldP.id },
    });

    if (existingNew && existingNew.mpn !== '') {
      // Already migrated (has mpn set)
      productMigrateCount++;
      continue;
    }

    // Update the product record with new fields (in-place since we're reusing the table)
    await prisma.product.update({
      where: { id: oldP.id },
      data: {
        mpn: oldP.specifications
          ? (oldP.specifications as any).mpn || oldP.sku || oldP.id
          : oldP.sku || oldP.id,
        title: oldP.name,
        description: oldP.description,
        manufacturerId: manufacturer?.id || null,
        globalCategoryId: category?.id || null,
      },
    });

    productMigrateCount++;
  }
  console.log(`  Migrated ${productMigrateCount} product records`);

  // -----------------------------------------------------------------------
  // Step 4: Migrate SupplierSku → SupplierListing
  // -----------------------------------------------------------------------
  console.log('[4/7] Migrating SupplierSku → SupplierListing...');

  // The old SupplierSku model still exists in the schema — we read from it
  // but since Prisma is now regenerated with the new schema, we'll use raw SQL

  const oldSkus = await prisma.$queryRaw<
    Array<{
      id: string;
      supplier_id: string;
      product_id: string;
      sku: string;
      price: number;
      inventory_count: number;
    }>
  >`
    SELECT id, supplier_id, product_id, sku, price, inventory_count
    FROM supplier_skus
  `;

  let listingCount = 0;
  for (const sku of oldSkus) {
    // Check if listing already exists
    const existing = await prisma.$queryRaw<
      Array<{ id: string }>
    >`
      SELECT id FROM supplier_listings
      WHERE supplier_id = ${sku.supplier_id}::uuid AND supplier_sku = ${sku.sku}
    `;

    if (existing.length > 0) continue;

    await prisma.$executeRaw`
      INSERT INTO supplier_listings (id, product_id, supplier_id, supplier_sku, raw_payload, is_active)
      VALUES (
        ${sku.id}::uuid,
        ${sku.product_id}::uuid,
        ${sku.supplier_id}::uuid,
        ${sku.sku},
        ${JSON.stringify({
          original_price: sku.price,
          original_inventory: sku.inventory_count,
          migrated_from: 'SupplierSku',
          migrated_at: new Date().toISOString(),
        })},
        TRUE
      )
    `;
    listingCount++;
  }
  console.log(`  Created ${listingCount} supplier listings`);

  // -----------------------------------------------------------------------
  // Step 5: Migrate InventorySnapshot → SupplierListing
  // -----------------------------------------------------------------------
  console.log('[5/7] Migrating InventorySnapshot references...');

  const snapshots = await prisma.$queryRaw<
    Array<{
      id: string;
      supplier_listing_id: string | null;
      supplier_sku_id: string | null;
      product_id: string | null;
    }>
  >`SELECT id, supplier_listing_id, supplier_sku_id, product_id FROM inventory_snapshots`;

  let snapshotCount = 0;
  for (const snap of snapshots) {
    if (snap.supplier_listing_id) continue; // already migrated

    let listingId: string | null = null;

    if (snap.supplier_sku_id) {
      const result = await prisma.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM supplier_listings WHERE id = ${snap.supplier_sku_id}::uuid`;
      if (result.length > 0) listingId = result[0].id;
    }

    if (!listingId && snap.product_id) {
      const result = await prisma.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM supplier_listings WHERE product_id = ${snap.product_id}::uuid LIMIT 1`;
      if (result.length > 0) listingId = result[0].id;
    }

    if (listingId) {
      await prisma.$executeRaw`
        UPDATE inventory_snapshots
        SET supplier_listing_id = ${listingId}::uuid
        WHERE id = ${snap.id}::uuid
      `;
      snapshotCount++;
    }
  }
  console.log(`  Updated ${snapshotCount} inventory snapshots`);

  // -----------------------------------------------------------------------
  // Step 6: Populate product_attributes from specifications
  // -----------------------------------------------------------------------
  console.log('[6/7] Populating product_attributes...');

  const allProducts = await prisma.$queryRaw<
    Array<{ id: string; specifications: any }>
  >`SELECT id, specifications FROM products`;

  let attrCount = 0;
  for (const p of allProducts) {
    if (!p.specifications || Object.keys(p.specifications).length === 0) continue;

    const existing = await prisma.$queryRaw<
      Array<{ product_id: string }>
    >`SELECT product_id FROM product_attributes WHERE product_id = ${p.id}::uuid`;

    if (existing.length > 0) continue;

    await prisma.$executeRaw`
      INSERT INTO product_attributes (product_id, normalized_attributes, attribute_units)
      VALUES (${p.id}::uuid, ${JSON.stringify(p.specifications)}::jsonb, '{}'::jsonb)
    `;
    attrCount++;
  }
  console.log(`  Created ${attrCount} product attribute records`);

  // -----------------------------------------------------------------------
  // Step 7: Seed taxonomy attributes
  // -----------------------------------------------------------------------
  console.log('[7/7] Seeding taxonomy_attributes...');

  const taxonomyEntries = [
    { key: 'operating_pressure', type: 'NUMERIC', units: ['psi', 'bar', 'kPa'], base: 'psi' },
    { key: 'max_pressure', type: 'NUMERIC', units: ['psi', 'bar', 'kPa'], base: 'psi' },
    { key: 'burst_pressure', type: 'NUMERIC', units: ['psi', 'bar', 'kPa'], base: 'psi' },
    { key: 'voltage', type: 'NUMERIC', units: ['V', 'kV'], base: 'V' },
    { key: 'power', type: 'NUMERIC', units: ['W', 'kW', 'HP'], base: 'W' },
    { key: 'temperature_min', type: 'NUMERIC', units: ['°F', '°C', 'F', 'C'], base: '°F' },
    { key: 'temperature_max', type: 'NUMERIC', units: ['°F', '°C', 'F', 'C'], base: '°F' },
    { key: 'length', type: 'NUMERIC', units: ['in', 'ft', 'mm', 'cm', 'm'], base: 'in' },
    { key: 'width', type: 'NUMERIC', units: ['in', 'ft', 'mm', 'cm', 'm'], base: 'in' },
    { key: 'height', type: 'NUMERIC', units: ['in', 'ft', 'mm', 'cm', 'm'], base: 'in' },
    { key: 'weight', type: 'NUMERIC', units: ['lbs', 'kg', 'oz'], base: 'lbs' },
    { key: 'torque', type: 'NUMERIC', units: ['ft-lb', 'Nm'], base: 'ft-lb' },
    { key: 'flow_rate', type: 'NUMERIC', units: ['GPM', 'LPM'], base: 'GPM' },
    { key: 'material', type: 'STRING', units: null, base: null },
    { key: 'connection_type', type: 'STRING', units: null, base: null },
    { key: 'body_material', type: 'STRING', units: null, base: null },
    { key: 'seat_material', type: 'STRING', units: null, base: null },
    { key: 'certification', type: 'STRING', units: null, base: null },
  ];

  let taxCount = 0;
  for (const entry of taxonomyEntries) {
    const existing = await prisma.taxonomyAttribute.findUnique({
      where: { attributeKey: entry.key },
    });
    if (existing) continue;

    await prisma.taxonomyAttribute.create({
      data: {
        attributeKey: entry.key,
        expectedDataType: entry.type as any,
        allowedUnits: entry.units,
        baseUnit: entry.base,
      },
    });
    taxCount++;
  }
  console.log(`  Seeded ${taxCount} taxonomy attribute definitions`);

  // -----------------------------------------------------------------------
  // Done
  // -----------------------------------------------------------------------
  console.log('\n=== Schema Refactor Backfill Complete ===');
  console.log(`Summary:
    Manufacturers: ${manufacturerCount}
    Categories: ${categoryCount}
    Products migrated: ${productMigrateCount}
    Supplier listings: ${listingCount}
    Inventory snapshots updated: ${snapshotCount}
    Product attribute records: ${attrCount}
    Taxonomy definitions: ${taxCount}
  `);
}

backfill()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());