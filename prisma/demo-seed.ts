/**
 * Demo-seed (Phase 1, Modules 1-5) — realistic marketplace content for
 *   kanjariyaharshit@gmail.com / Harshit@1234#
 * (admin panel + seller panel; separate tables, same credentials).
 *
 * Writes through Prisma directly (works with the dev server open or closed,
 * and leaves the account's 2FA untouched). Store/roles/subscription creation
 * imports the real `createStore` service so side effects match production;
 * media rows use the shared `persistBuffer`/`checksumOf`/`publicUrlFor` so
 * uploaaded bytes are laid out identically to real uploads.
 *
 * Realistic data, idempotent every create is guarded; re-running only tops
 * up. Product photos are fetched from picsum.photos (real JPEG bytes, our
 * own chosen shots); with no network the script seeds DB rows that point at
 * stable external URLs instead. All merchant copy (descriptions, review
 * notes, justifications) is authored here — no real-brand marketing text.
 *
 * Run: `npm run db:demo:local` (Postgres + Redis up; no API needed).
 */
import 'dotenv/config';
import { getPrisma, disconnectDatabase } from '../src/config/db.js';
import { hashSecret as adminHashSecret } from '../src/modules/admin-panel/auth/crypto/password.js';
import {
  hashSecret as sellerHashSecret,
  verifySecret as sellerVerifySecret,
} from '../src/modules/seller-panel/auth/crypto/password.js';
import { createStore } from '../src/modules/seller-panel/stores/stores/stores.service.js';
import {
  checksumOf,
  classifyFile,
  persistBuffer,
  publicUrlFor,
} from '../src/shared/uploads/files.js';
import type { RequestMeta } from '../src/shared/utils/requestMeta.js';

const DEMO_EMAIL = 'kanjariyaharshit@gmail.com';
const DEMO_NAME = 'Harshit Kanjariya';
const DEMO_PASSWORD = 'Harshit@1234#';

const META: RequestMeta = {
  requestId: 'demo-seed',
  ipAddress: '127.0.0.1',
  userAgent: 'prisma/demo-seed',
};

// ── content ────────────────────────────────────────────────────────────────

const LOOKUP_COUNTRIES = [
  { key: 'india', label: 'India', value: 'New Delhi' },
  { key: 'united-states', label: 'United States', value: 'Washington, D.C.' },
  { key: 'united-kingdom', label: 'United Kingdom', value: 'London' },
  { key: 'japan', label: 'Japan', value: 'Tokyo' },
  { key: 'germany', label: 'Germany', value: 'Berlin' },
  { key: 'south-korea', label: 'South Korea', value: 'Seoul' },
  { key: 'vietnam', label: 'Vietnam', value: 'Hanoi' },
  { key: 'china', label: 'China', value: 'Beijing' },
];

const LOOKUP_CURRENCIES = [
  { key: 'inr', label: 'INR', value: 'Indian Rupee' },
  { key: 'usd', label: 'USD', value: 'US Dollar' },
  { key: 'eur', label: 'EUR', value: 'Euro' },
  { key: 'gbp', label: 'GBP', value: 'British Pound' },
  { key: 'aed', label: 'AED', value: 'UAE Dirham' },
];

interface CatAttrDef {
  name: string;
  code: string;
  type:
    | 'TEXT'
    | 'TEXTAREA'
    | 'NUMBER'
    | 'DECIMAL'
    | 'BOOLEAN'
    | 'DROPDOWN'
    | 'MULTI_SELECT'
    | 'COLOR_SWATCH'
    | 'IMAGE_SWATCH'
    | 'DATE';
  unit?: string;
  helpText?: string;
  required?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  comparable?: boolean;
  variantDefining?: boolean;
  validationMin?: number;
  validationMax?: number;
  allowedUnits?: string[];
  options?: Array<{ label: string; value: string; swatchHex?: string }>;
}

const CAT_ATTRS: CatAttrDef[] = [
  {
    name: 'Brand',
    code: 'brand',
    type: 'DROPDOWN',
    required: true,
    filterable: true,
    searchable: true,
    options: [
      'Samsung',
      'Apple',
      'Xiaomi',
      'boAt',
      'Philips',
      'Prestige',
      "Levi's",
      'Allen Solly',
      'Puma',
      'Milton',
      'Lakmé',
    ].map((label) => ({ label, value: label.toLowerCase().replace(/[^a-z0-9]+/g, '-') })),
  },
  {
    name: 'Colour',
    code: 'color',
    type: 'COLOR_SWATCH',
    variantDefining: true,
    filterable: true,
    options: [
      { label: 'Midnight Black', value: 'midnight-black', swatchHex: '#1f1f1f' },
      { label: 'Cloud White', value: 'cloud-white', swatchHex: '#f5f5f5' },
      { label: 'Ocean Blue', value: 'ocean-blue', swatchHex: '#1d4ed8' },
      { label: 'Crimson Red', value: 'crimson-red', swatchHex: '#dc2626' },
      { label: 'Forest Green', value: 'forest-green', swatchHex: '#166534' },
      { label: 'Charcoal Grey', value: 'charcoal-grey', swatchHex: '#374151' },
    ],
  },
  {
    name: 'Storage capacity',
    code: 'storage_capacity',
    type: 'DROPDOWN',
    variantDefining: true,
    filterable: true,
    helpText: 'Internal storage',
    options: ['64 GB', '128 GB', '256 GB', '512 GB', '1 TB'].map((label) => ({
      label,
      value: label.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    })),
  },
  {
    name: 'RAM',
    code: 'ram',
    type: 'DROPDOWN',
    variantDefining: true,
    filterable: true,
    comparable: true,
    options: ['4 GB', '6 GB', '8 GB', '12 GB', '16 GB'].map((label) => ({
      label,
      value: label.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    })),
  },
  {
    name: 'Screen size',
    code: 'screen_size',
    type: 'DECIMAL',
    unit: 'cm',
    filterable: true,
    comparable: true,
    allowedUnits: ['cm', 'mm', 'm'],
    validationMin: 1,
    validationMax: 100,
    helpText: 'Diagonal display size',
  },
  {
    name: 'Connectivity',
    code: 'connectivity',
    type: 'MULTI_SELECT',
    filterable: true,
    searchable: true,
    options: [
      { label: '5G', value: '5g' },
      { label: '4G LTE', value: '4g-lte' },
      { label: 'Wi-Fi 6', value: 'wifi-6' },
      { label: 'Bluetooth 5.3', value: 'bt-5-3' },
      { label: 'NFC', value: 'nfc' },
      { label: 'Dual SIM', value: 'dual-sim' },
    ],
  },
  {
    name: 'Warranty (months)',
    code: 'warranty_months',
    type: 'NUMBER',
    validationMin: 0,
    validationMax: 84,
    helpText: 'Manufacturer warranty',
  },
  {
    name: 'Material',
    code: 'material',
    type: 'TEXT',
    filterable: true,
    helpText: 'Primary construction material',
  },
  {
    name: 'Size',
    code: 'size',
    type: 'DROPDOWN',
    variantDefining: true,
    required: true,
    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map((l) => ({
      label: l,
      value: l.toLowerCase(),
    })),
  },
  {
    name: 'Fabric',
    code: 'fabric',
    type: 'TEXT',
    filterable: true,
    helpText: 'e.g. 100% combed cotton',
  },
  {
    name: 'Volume',
    code: 'capacity_l',
    type: 'DECIMAL',
    unit: 'l',
    filterable: true,
    comparable: true,
    allowedUnits: ['l', 'ml'],
    validationMin: 0,
    validationMax: 50,
    helpText: 'Capacity in litres',
  },
];

const SETS: Array<{
  name: string;
  description: string;
  groups: Array<{ name: string; items: Array<{ code: string; required?: boolean }> }>;
}> = [
  {
    name: 'Electronics',
    description: 'Phones, laptops, audio and photography',
    groups: [
      {
        name: 'General',
        items: [
          { code: 'brand', required: true },
          { code: 'color' },
          { code: 'connectivity' },
          { code: 'warranty_months' },
        ],
      },
      {
        name: 'Technical',
        items: [{ code: 'screen_size' }, { code: 'storage_capacity' }, { code: 'ram' }],
      },
    ],
  },
  {
    name: 'Apparel',
    description: 'Clothing, footwear and accessories',
    groups: [
      { name: 'Sizing', items: [{ code: 'size', required: true }] },
      {
        name: 'Material & Fit',
        items: [
          { code: 'brand', required: true },
          { code: 'color' },
          { code: 'fabric' },
          { code: 'material' },
        ],
      },
    ],
  },
  {
    name: 'Home & Kitchen',
    description: 'Cookware, storage and décor',
    groups: [
      { name: 'General', items: [{ code: 'brand', required: true }, { code: 'color' }] },
      {
        name: 'Specs',
        items: [{ code: 'capacity_l' }, { code: 'material' }, { code: 'warranty_months' }],
      },
    ],
  },
];

interface CatDef {
  slug: string;
  name: string;
  parent?: string;
  icon?: string;
  tax?: string;
  set?: string;
  restricted?: boolean;
  homepage?: boolean;
  description: string;
}

const CATEGORIES: CatDef[] = [
  {
    slug: 'electronics',
    name: 'Electronics',
    icon: '📱',
    tax: 'GST 18%',
    set: 'Electronics',
    homepage: true,
    description: 'Mobiles, laptops, audio and cameras with genuine-warranty listings.',
  },
  {
    slug: 'mobiles',
    name: 'Mobiles & Tablets',
    parent: 'electronics',
    icon: '📞',
    tax: 'GST 18%',
    description: 'Smartphones and tablets across every budget band.',
  },
  {
    slug: 'laptops',
    name: 'Laptops',
    parent: 'electronics',
    icon: '💻',
    tax: 'GST 18%',
    description: 'Ultrabooks, gaming rigs and makers’ laptops.',
  },
  {
    slug: 'laptop-accessories',
    name: 'Laptop Accessories',
    parent: 'laptops',
    icon: '🖱️',
    tax: 'GST 18%',
    description: 'Docks, sleeves, mice and peripherals.',
  },
  {
    slug: 'audio',
    name: 'Audio',
    parent: 'electronics',
    icon: '🎧',
    tax: 'GST 18%',
    description: 'Headphones, earbuds and party speakers.',
  },
  {
    slug: 'cameras',
    name: 'Cameras',
    parent: 'electronics',
    icon: '📷',
    tax: 'GST 18%',
    description: 'DSLRs, mirrorless bodies and action cams.',
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    icon: '👕',
    set: 'Apparel',
    homepage: true,
    description: 'Everyday staples and festive fits for men and women.',
  },
  {
    slug: 'men',
    name: 'Men',
    parent: 'fashion',
    icon: '👔',
    description: 'T-shirts, shirts, jeans and more.',
  },
  {
    slug: 'tshirts',
    name: 'T-Shirts',
    parent: 'men',
    icon: '🎽',
    tax: 'GST 5%',
    description: 'Round necks, polos and printed tees.',
  },
  {
    slug: 'women',
    name: 'Women',
    parent: 'fashion',
    icon: '👗',
    description: 'Ethnic wear, dresses and tops.',
  },
  {
    slug: 'kurtis',
    name: 'Kurtis',
    parent: 'women',
    icon: '🥻',
    tax: 'GST 5%',
    description: 'Cotton and rayon kurtis for every occasion.',
  },
  {
    slug: 'footwear',
    name: 'Footwear',
    parent: 'fashion',
    icon: '👟',
    tax: 'GST 12%',
    set: 'Apparel',
    description: 'Sneakers, sandals and running shoes.',
  },
  {
    slug: 'home-kitchen',
    name: 'Home & Kitchen',
    icon: '🏠',
    set: 'Home & Kitchen',
    homepage: true,
    description: 'Cookware, storage, décor and everyday utilities.',
  },
  {
    slug: 'cookware',
    name: 'Cookware',
    parent: 'home-kitchen',
    icon: '🍳',
    tax: 'GST 18%',
    description: 'Pressure cookers, non-stick pans and kadhais.',
  },
  {
    slug: 'storage-containers',
    name: 'Storage & Containers',
    parent: 'home-kitchen',
    icon: '🫙',
    tax: 'GST 18%',
    description: 'Airtight jars, bottles and pantry organisers.',
  },
  {
    slug: 'home-decor',
    name: 'Home Decor',
    parent: 'home-kitchen',
    icon: '🖼️',
    tax: 'GST 12%',
    description: 'Wall art, planters and ambient lighting.',
  },
  {
    slug: 'beauty',
    name: 'Beauty & Grooming',
    icon: '💄',
    description: 'Skincare, makeup and personal care.',
  },
  {
    slug: 'cosmetics',
    name: 'Cosmetics',
    parent: 'beauty',
    icon: '💅',
    tax: 'GST 28%',
    restricted: true,
    description: 'Colour cosmetics from authorised distributors only.',
  },
  {
    slug: 'ayurveda-wellness',
    name: 'Ayurveda & Wellness',
    parent: 'beauty',
    icon: '🌿',
    tax: 'GST 12%',
    restricted: true,
    description: 'Classical formulations — licences required to sell.',
  },
  {
    slug: 'sports-fitness',
    name: 'Sports & Fitness',
    icon: '🏋️',
    description: 'Home gym gear and sporting equipment.',
  },
  {
    slug: 'fitness-equipment',
    name: 'Fitness Equipment',
    parent: 'sports-fitness',
    icon: '🚴',
    tax: 'GST 18%',
    description: 'Dumbbells, treadmills and yoga mats.',
  },
];

interface BrandDef {
  name: string;
  slug: string;
  website: string;
  country: string;
  description: string;
  restricted?: boolean;
  featured?: boolean;
}

const BRANDS: BrandDef[] = [
  {
    name: 'Samsung',
    slug: 'samsung',
    website: 'https://www.samsung.com/in',
    country: 'South Korea',
    featured: true,
    description: 'Smartphones and home electronics.',
  },
  {
    name: 'Apple',
    slug: 'apple',
    website: 'https://www.apple.com/in',
    country: 'United States',
    featured: true,
    description: 'iPhone, iPad and Mac.',
  },
  {
    name: 'Xiaomi',
    slug: 'xiaomi',
    website: 'https://www.mi.com/in',
    country: 'China',
    description: 'Value-forward smartphones and smart-home kit.',
  },
  {
    name: 'boAt',
    slug: 'boat',
    website: 'https://www.boat-lifestyle.com',
    country: 'India',
    featured: true,
    description: 'Audio and wearables made for India.',
  },
  {
    name: 'Philips',
    slug: 'philips',
    website: 'https://www.philips.co.in',
    country: 'Netherlands',
    description: 'Appliances and lighting for the home.',
  },
  {
    name: 'Prestige',
    slug: 'prestige',
    website: 'https://www.ttksmartkitchen.com',
    country: 'India',
    description: 'Pressure cookers and non-stick kitchenware.',
  },
  {
    name: 'Milton',
    slug: 'milton',
    website: 'https://www.milton.in',
    country: 'India',
    description: 'Thermosteel bottles and casseroles.',
  },
  {
    name: 'Puma',
    slug: 'puma',
    website: 'https://www.puma.com',
    country: 'Germany',
    description: 'Sneakers and athleisure.',
  },
  {
    name: "Levi's",
    slug: 'levis',
    website: 'https://www.levi.in',
    country: 'United States',
    restricted: true,
    featured: true,
    description: 'Denim and casualwear since 1853.',
  },
  {
    name: 'Allen Solly',
    slug: 'allen-solly',
    website: 'https://www.allensolly.com',
    country: 'India',
    description: 'Smart-casual office wear.',
  },
  {
    name: 'Lakmé',
    slug: 'lakme',
    website: 'https://www.lakmeindia.com',
    country: 'India',
    restricted: true,
    description: 'Colour cosmetics and skincare.',
  },
];

const PRODUCT_IMAGES = [
  { seed: 'flagship-smartphone', alt: 'Flagship smartphone on a studio backdrop' },
  { seed: 'true-wireless-earbuds', alt: 'True-wireless earbuds in charging case' },
  { seed: 'slim-laptop', alt: 'Slim aluminium laptop, lid open' },
  { seed: 'party-speaker', alt: 'Bluetooth party speaker with LED ring' },
  { seed: 'cotton-round-neck', alt: 'Combed cotton round-neck t-shirt' },
  { seed: 'printed-kurti', alt: 'Block-printed cotton kurti' },
  { seed: 'running-sneakers', alt: 'Mesh-upper running sneakers' },
  { seed: 'stainless-kadhai', alt: 'Stainless steel induction kadhai' },
  { seed: 'thermosteel-bottle', alt: 'Thermosteel vacuum bottle, 1 L' },
  { seed: 'yoga-mat', alt: 'Non-slip yoga mat rolled out' },
];

const avatarFor = (name: string) =>
  `https://ui-avatars.com/api/?background=0d8abc&color=fff&size=256&format=png&bold=true&name=${encodeURIComponent(name)}`;
const shotFor = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

function minimalPdf(storeName: string, title: string): Buffer {
  const text = `${storeName} - ${title}`;
  const lines = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj',
    '4 0 obj<</Length 92>>stream',
    `BT /F1 14 Tf 72 770 Td (${text}) Tj ET`,
    'endstream endobj',
    'trailer<</Size 5/Root 1 0 R>>',
    '%%EOF',
  ];
  return Buffer.from(lines.join('\n'), 'binary');
}

// ── phases ─────────────────────────────────────────────────────────────────

async function bootstrapAdmin(): Promise<{ id: string }> {
  const prisma = getPrisma();
  const emailNormalized = DEMO_EMAIL.trim().toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { emailNormalized } });
  if (existing) return existing;
  console.log(`• admin bootstrap: creating ${DEMO_EMAIL}`);
  const passwordHash = await adminHashSecret(DEMO_PASSWORD);
  const role = await prisma.adminRole.findUnique({ where: { key: 'super_admin' } });
  if (!role) throw new Error('super_admin role missing — run `npm run db:seed:local` first');
  const admin = await prisma.$transaction(async (tx) => {
    const created = await tx.adminUser.create({
      data: {
        email: DEMO_EMAIL,
        emailNormalized,
        name: DEMO_NAME,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    await tx.adminPasswordHistory.create({ data: { adminId: created.id, passwordHash } });
    await tx.adminRoleAssignment.create({ data: { adminId: created.id, roleId: role.id } });
    await tx.adminAuditLog.create({
      data: {
        adminId: created.id,
        action: 'admin.bootstrap',
        resourceType: 'admin_user',
        resourceId: created.id,
      },
    });
    return created;
  });
  return admin;
}

async function seedLookupAttributes(): Promise<number> {
  const prisma = getPrisma();
  console.log('• lookup attributes (countries, currencies)');
  let n = 0;
  const existing = await prisma.attribute.findMany({ select: { type: true, key: true } });
  const have = new Set(existing.map((a) => `${a.type}:${a.key}`));
  for (const c of LOOKUP_COUNTRIES) {
    if (have.has(`country:${c.key}`)) continue;
    await prisma.attribute.create({
      data: {
        type: 'country',
        key: c.key,
        label: c.label,
        value: c.value,
        description: 'Currency/region demo lookup',
        sortOrder: n++,
      },
    });
  }
  for (const c of LOOKUP_CURRENCIES) {
    if (have.has(`currency:${c.key}`)) continue;
    await prisma.attribute.create({
      data: {
        type: 'currency',
        key: c.key,
        label: c.label,
        value: c.value,
        description: 'Payment currency map',
        sortOrder: n++,
      },
    });
  }
  return n;
}

async function seedCatalogAttributes(adminId: string): Promise<Map<string, string>> {
  const prisma = getPrisma();
  console.log('• product attributes + option catalogs (11 attributes)');
  const ids = new Map<string, string>();
  for (const def of CAT_ATTRS) {
    const existing = await prisma.productAttribute.findUnique({ where: { code: def.code } });
    let id: string;
    if (existing) {
      id = existing.id;
    } else {
      const created = await prisma.productAttribute.create({
        data: {
          name: def.name,
          code: def.code,
          type: def.type,
          unit: def.unit ?? null,
          helpText: def.helpText ?? null,
          required: def.required ?? false,
          filterable: def.filterable ?? false,
          searchable: def.searchable ?? false,
          comparable: def.comparable ?? false,
          variantDefining: def.variantDefining ?? false,
          validationMin: def.validationMin ?? null,
          validationMax: def.validationMax ?? null,
          allowedUnits: def.allowedUnits ?? [],
          options: {
            create: (def.options ?? []).map((o, i) => ({
              label: o.label,
              value: o.value,
              swatchHex: o.swatchHex ?? null,
              displayOrder: i,
            })),
          },
        },
      });
      id = created.id;
    }
    ids.set(def.code, id);
  }
  await prisma.adminAuditLog.create({
    data: {
      actor: { connect: { id: adminId } },
      action: 'demo.catalog_attributes.seeded',
      resourceType: 'product_attribute',
      after: { count: CAT_ATTRS.length },
    },
  });
  return ids;
}

async function seedAttributeSets(attrs: Map<string, string>): Promise<Map<string, string>> {
  const prisma = getPrisma();
  console.log('• attribute sets (Electronics, Apparel, Home & Kitchen)');
  const byName = new Map<string, string>();
  const attachItems = async (
    set: { id: string },
    def: (typeof SETS)[number],
    groups: Map<string, string>,
    attached: Set<string>,
  ): Promise<void> => {
    for (const g of def.groups) {
      let gid = groups.get(g.name);
      if (!gid) {
        const group = await prisma.productAttributeGroup.create({
          data: {
            attributeSetId: set.id,
            name: g.name,
            displayOrder: def.groups.findIndex((x) => x.name === g.name),
          },
        });
        gid = group.id;
        groups.set(g.name, gid);
      }
      for (const item of g.items) {
        const attributeId = attrs.get(item.code);
        if (!attributeId) throw new Error(`attribute ${item.code} missing`);
        if (attached.has(attributeId)) continue;
        await prisma.productAttributeSetItem.create({
          data: {
            attributeSetId: set.id,
            attributeId,
            groupId: gid,
            required: item.required ?? null,
            displayOrder: attached.size,
          },
        });
        attached.add(attributeId);
      }
    }
  };
  for (const def of SETS) {
    const slug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let set = await prisma.productAttributeSet.findFirst({
      where: { OR: [{ slug }, { name: def.name }], deletedAt: null },
      include: { groups: true, items: true },
    });
    if (set) {
      const groups = new Map(set.groups.map((g) => [g.name, g.id] as const));
      const attached = new Set(set.items.map((i) => i.attributeId));
      await attachItems(set, def, groups, attached);
      byName.set(def.name, set.id);
      continue;
    }
    const created = await prisma.productAttributeSet.create({
      data: {
        name: def.name,
        slug,
        description: def.description,
        groups: {
          create: def.groups.map((g, i) => ({ name: g.name, displayOrder: i })),
        },
      },
      include: { groups: true, items: true },
    });
    await attachItems(
      created,
      def,
      new Map(created.groups.map((g) => [g.name, g.id] as const)),
      new Set(created.items.map((i) => i.attributeId)),
    );
    byName.set(def.name, created.id);
  }
  return byName;
}

async function seedCategories(setIds: Map<string, string>): Promise<void> {
  const prisma = getPrisma();
  console.log(`• category tree (${CATEGORIES.length} nodes)`);
  const tax = await prisma.taxClass.findMany({ select: { id: true, name: true } });
  for (const c of CATEGORIES) {
    const slug = c.parent ? `${c.slug}` : c.slug;
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing) continue;
    const parent = c.parent
      ? await prisma.category.findUnique({ where: { slug: c.parent } })
      : null;
    await prisma.category.create({
      data: {
        name: c.name,
        slug,
        parentId: parent?.id ?? null,
        description: c.description,
        imageUrl: shotFor(slug, 800, 600),
        bannerUrl: shotFor(`${slug}-banner`, 1600, 600),
        icon: c.icon ?? null,
        displayOrder: CATEGORIES.findIndex((x) => x.slug === c.slug),
        status: 'ACTIVE',
        showInNav: true,
        showOnHomepage: c.homepage ?? false,
        restricted: c.restricted ?? false,
        metaTitle: `${c.name} - Buy ${c.name.toLowerCase()} online | Aurora`,
        metaDescription: `Shop ${c.name.toLowerCase()} online at Aurora. Best prices, genuine products, GST invoices.`,
        attributeSetId: c.set ? (setIds.get(c.set) ?? null) : null,
        taxClassId: c.tax ? (tax.find((t) => t.name === c.tax)?.id ?? null) : null,
      },
    });
  }
}

async function seedBrands(): Promise<void> {
  const prisma = getPrisma();
  console.log(`• brand master (${BRANDS.length} brands)`);
  for (const b of BRANDS) {
    const existing = await prisma.brand.findUnique({ where: { slug: b.slug } });
    if (existing) continue;
    await prisma.brand.create({
      data: {
        name: b.name,
        slug: b.slug,
        website: b.website,
        country: b.country,
        description: b.description,
        restricted: b.restricted ?? false,
        featured: b.featured ?? false,
        logoUrl: avatarFor(b.name),
        bannerUrl: shotFor(`${b.slug}-brand-banner`, 1600, 500),
        status: 'ACTIVE',
      },
    });
  }
}

async function bootstrapSeller(): Promise<{ id: string; email: string }> {
  const prisma = getPrisma();
  const emailNormalized = DEMO_EMAIL.trim().toLowerCase();
  const existing = await prisma.sellerUser.findUnique({ where: { emailNormalized } });
  if (existing) {
    // The demo requires the same credentials on both panels. If this account
    // exists (e.g. from an earlier manual registration) with a different
    // password, rehash it with the seller crypto so `Harshit@1234#` works.
    if (!(await sellerVerifySecret(existing.passwordHash, DEMO_PASSWORD))) {
      console.log(`↻ seller bootstrap: resetting password for existing ${DEMO_EMAIL}`);
      await prisma.sellerUser.update({
        where: { id: existing.id },
        data: { passwordHash: await sellerHashSecret(DEMO_PASSWORD) },
      });
    }
    return existing;
  }
  console.log(`✚ seller bootstrap: registering ${DEMO_EMAIL}`);
  return prisma.sellerUser.create({
    data: {
      email: DEMO_EMAIL,
      emailNormalized,
      name: DEMO_NAME,
      passwordHash: await sellerHashSecret(DEMO_PASSWORD),
      status: 'ACTIVE',
    },
  });
}

async function ensureStore(
  seller: { id: string; email: string },
  adminId: string,
): Promise<{ id: string; slug: string; name: string }> {
  const prisma = getPrisma();
  const owned = await prisma.store.findFirst({ where: { ownerId: seller.id, deletedAt: null } });
  if (owned) {
    const patch: Partial<{
      logo: string;
      description: string;
      contactPhone: string;
      category: string;
      onboardingCompletedAt: Date;
    }> = {};
    if (!owned.logo) patch.logo = avatarFor(owned.name);
    if (!owned.description) {
      patch.description =
        'One-stop marketplace for gadgets, everyday fashion and kitchen essentials. GST invoices, 7-day returns, pan-India shipping from Bengaluru.';
    }
    if (!owned.contactPhone) patch.contactPhone = '+91 98765 43210';
    if (!owned.category) patch.category = 'Electronics • Fashion • Home & Kitchen';
    if (!owned.onboardingCompletedAt) patch.onboardingCompletedAt = new Date();
    if (Object.keys(patch).length > 0) {
      await prisma.store.update({ where: { id: owned.id }, data: patch });
    }
    return owned;
  }
  console.log('• seller: creating the demo store `Aurum Bazaar`');
  const storeInput = {
    name: 'Aurum Bazaar',
    description:
      'One-stop marketplace for gadgets, everyday fashion and kitchen essentials. GST invoices, 7-day returns, pan-India shipping from Bengaluru.',
    category: 'Electronics • Fashion • Home & Kitchen',
    country: 'India',
    currency: 'INR',
    contactEmail: DEMO_EMAIL,
    contactPhone: '+91 98765 43210',
  } as Parameters<typeof createStore>[1];
  const store = await createStore(seller.id, storeInput, META);
  await prisma.store.update({
    where: { id: store.id },
    data: {
      logo: avatarFor('Aurum Bazaar'),
      onboardingCompletedAt: new Date(),
    },
  });
  await prisma.storeAuditLog.create({
    data: {
      storeId: store.id,
      actorId: adminId,
      action: 'store.branding.seeded',
      resourceType: 'store',
      resourceId: store.id,
      metadata: { by: 'demo-seed' },
      ipAddress: '127.0.0.1',
      userAgent: 'prisma/demo-seed',
    },
  });
  return store;
}

async function fetchImage(seed: string, w = 900, h = 900): Promise<Buffer | null> {
  try {
    const res = await fetch(shotFor(seed, w, h), { redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 190 || buf.length > 10 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}

async function seedSellerMedia(
  sellerId: string,
  store: { id: string; name: string },
): Promise<Record<string, string>> {
  const prisma = getPrisma();
  console.log('• seller media (10 product shots + 3 documents)');
  const ids: Record<string, string> = {};
  const existing = await prisma.storeMediaAsset.findMany({
    where: { storeId: store.id },
    select: { originalName: true, id: true },
  });
  const have = new Set(existing.map((m) => m.originalName.toLowerCase()));

  for (const img of PRODUCT_IMAGES) {
    const fname = `${img.seed}.jpg`;
    if (have.has(fname)) continue;
    const buf = await fetchImage(img.seed);
    if (buf) {
      const checksum = checksumOf(buf);
      const dedup = await prisma.storeMediaAsset.findUnique({
        where: { storeId_checksum: { storeId: store.id, checksum } },
      });
      if (dedup) {
        ids[img.seed] = dedup.id;
        continue;
      }
      const { storageKey } = await persistBuffer(['public', 'stores', store.id], fname, buf);
      ids[img.seed] = (
        await prisma.storeMediaAsset.create({
          data: {
            storeId: store.id,
            fileName: fname,
            originalName: fname,
            mime: 'image/jpeg',
            sizeBytes: buf.length,
            checksum,
            kind: classifyFile('image/jpeg', buf.length),
            visibility: 'PUBLIC',
            status: 'READY',
            storageKey,
            url: publicUrlFor(storageKey),
            altText: img.alt,
            caption: 'Demo product shot',
            folder: 'products',
            tags: ['demo', 'product'],
            uploadedBy: sellerId,
          },
        })
      ).id;
      console.log(`    + ${fname} (${buf.length} bytes)`);
    } else {
      const row = await prisma.storeMediaAsset.create({
        data: {
          storeId: store.id,
          fileName: fname,
          originalName: fname,
          mime: 'image/jpeg',
          sizeBytes: 12_345,
          checksum: `demo-${img.seed}`,
          kind: 'IMAGE',
          visibility: 'PUBLIC',
          status: 'READY',
          storageKey: `public/stores/${store.id}/demo-${fname}`,
          url: shotFor(img.seed, 900, 900),
          altText: img.alt,
          caption: 'Demo product shot (network fallback)',
          folder: 'products',
          tags: ['demo', 'product'],
          uploadedBy: sellerId,
        },
      });
      ids[img.seed] = row.id;
    }
  }

  const docs: Array<{ key: string; title: string; folder: string }> = [
    { key: 'brand-authorisation-letter', title: 'Brand Authorisation Letter', folder: 'documents' },
    {
      key: 'gst-registration-certificate',
      title: 'GST Registration Certificate',
      folder: 'documents',
    },
    { key: 'trade-licence', title: 'Trade Licence', folder: 'documents' },
  ];
  for (const d of docs) {
    const fname = `${d.key}.pdf`;
    if (have.has(fname)) continue;
    const buf = minimalPdf(store.name, d.title);
    const checksum = checksumOf(buf);
    const dedup = await prisma.storeMediaAsset.findUnique({
      where: { storeId_checksum: { storeId: store.id, checksum } },
    });
    if (dedup) {
      ids[d.key] = dedup.id;
      continue;
    }
    // PRIVATE scope mirrors the seller media service for documents.
    const { storageKey } = await persistBuffer(['private', 'stores', store.id], fname, buf);
    ids[d.key] = (
      await prisma.storeMediaAsset.create({
        data: {
          storeId: store.id,
          fileName: fname,
          originalName: fname,
          mime: 'application/pdf',
          sizeBytes: buf.length,
          checksum,
          kind: 'DOCUMENT',
          visibility: 'PRIVATE',
          status: 'READY',
          storageKey,
          url: null,
          altText: d.title,
          caption: 'Demo proof document',
          folder: d.folder,
          tags: ['demo', 'proof'],
          uploadedBy: sellerId,
        },
      })
    ).id;
  }
  return ids;
}

const D = () => new Date();
const mins = (n: number) => new Date(Date.now() + n * 60_000);

async function seedSellerRequests(
  seller: { id: string; email: string },
  admin: { id: string },
  store: { id: string },
  adminTokenHolder: Record<string, string>, // docId only
): Promise<void> {
  const prisma = getPrisma();
  console.log('• brand authorisations, brand/category requests, access grants');
  const bySlug = async (model: 'brand' | 'category', slug: string) =>
    model === 'brand'
      ? (await prisma.brand.findUnique({ where: { slug } }))?.id
      : (await prisma.category.findUnique({ where: { slug } }))?.id;

  const levisId = await bySlug('brand', 'levis');
  const lakmeId = await bySlug('brand', 'lakme');
  const letters = [
    adminTokenHolder['brand-authorisation-letter'],
    adminTokenHolder['gst-registration-certificate'],
  ].filter(Boolean) as string[];
  const allDocs = [...letters, adminTokenHolder['trade-licence']].filter(Boolean) as string[];
  const singleton = (arr: string[], i: number) =>
    arr.length > i ? [arr[i]]! : arr[0] ? [arr[0]]! : [];

  const now = D();
  // Levi's → APPROVED by the demo admin
  const levisPending = letters.length
    ? await prisma.brandAuthorization.findFirst({
        where: { storeId: store.id, brandId: levisId, status: { in: ['PENDING', 'APPROVED'] } },
      })
    : null;
  if (letters.length && levisId && !levisPending) {
    await prisma.brandAuthorization.create({
      data: {
        storeId: store.id,
        brandId: levisId,
        documentAssetIds: singleton(letters, 0),
        status: 'APPROVED',
        reviewNote: 'Distributor agreement verified with the brand. Cleared to retail.',
        reviewedById: admin.id,
        decidedAt: mins(2),
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  // Lakmé → left PENDING for the admin queue
  const lakmePending = await prisma.brandAuthorization.findFirst({
    where: { storeId: store.id, brandId: lakmeId, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (letters.length && lakmeId && !lakmePending) {
    await prisma.brandAuthorization.create({
      data: {
        storeId: store.id,
        brandId: lakmeId,
        documentAssetIds: singleton(letters, 1),
        status: 'PENDING',
        createdAt: mins(1),
        updatedAt: mins(1),
      },
    });
  }

  // Brand requests: Zevio resolves into a real brand; Lumora stays PENDING.
  const haveBrandRequest = await prisma.brandRequest.findFirst({
    where: { storeId: store.id, name: { in: ['Zevio', 'Lumora'] } },
    select: { name: true, id: true, status: true },
  });
  if (!haveBrandRequest) {
    if (allDocs.length) {
      await prisma.brandRequest.create({
        data: {
          storeId: store.id,
          sellerId: seller.id,
          name: 'Zevio',
          website: 'https://zevio.example',
          justification:
            'Exclusive distributor for the new Zevio GaN charging line; distributor letter attached. Requesting a brand to list the range.',
          proofAssetIds: singleton(allDocs, 0),
          status: 'PENDING',
          createdAt: mins(3),
          updatedAt: mins(3),
        },
      });
      let zevio = await prisma.brand.findUnique({ where: { slug: 'zevio' } });
      if (!zevio) {
        zevio = await prisma.brand.create({
          data: {
            name: 'Zevio',
            slug: 'zevio',
            website: 'https://zevio.example',
            country: 'India',
            description: 'GaN fast-charging and travel-charging peripherals.',
            restricted: true,
            logoUrl:
              'https://ui-avatars.com/api/?background=7c3aed&color=fff&size=256&format=png&bold=true&name=Zevio',
            bannerUrl: shotFor('zevio-brand-banner', 1600, 500),
            status: 'ACTIVE',
          },
        });
      }
      const zreq = await prisma.brandRequest.findFirst({
        where: { storeId: store.id, name: 'Zevio', status: 'PENDING' },
      });
      if (zreq) {
        await prisma.brandRequest.update({
          where: { id: zreq.id },
          data: {
            status: 'APPROVED',
            resolvedBrandId: zevio.id,
            reviewNote: 'Distributor letter verified with the brand. Approved.',
            reviewedById: admin.id,
            decidedAt: mins(4),
            updatedAt: mins(4),
          },
        });
      }
      await prisma.brandRequest.create({
        data: {
          storeId: store.id,
          sellerId: seller.id,
          name: 'Lumora',
          website: 'https://lumora.example',
          justification:
            'Import documents are under bank verification; requesting provisional status for Lumora LED ambience lamps.',
          proofAssetIds: singleton(allDocs, 1),
          status: 'PENDING',
          createdAt: mins(5),
          updatedAt: mins(5),
        },
      });
    }
  }

  // Category access requests on the two restricted leaves.
  const cosmeticsId = await bySlug('category', 'cosmetics');
  const ayurvedaId = await bySlug('category', 'ayurveda-wellness');
  for (const [cid, i, shouldApprove] of [
    [cosmeticsId, 0, true],
    [ayurvedaId, 1, false],
  ] as Array<[string | null, number, boolean]>) {
    if (!cid || !allDocs.length) continue;
    const held = await prisma.categoryAccessGrant.findFirst({
      where: { storeId: store.id, categoryId: cid, status: { in: ['PENDING', 'APPROVED'] } },
    });
    if (held) continue;
    const grant = await prisma.categoryAccessGrant.create({
      data: {
        storeId: store.id,
        categoryId: cid,
        documentAssetIds: singleton(allDocs, i),
        status: 'PENDING',
        createdAt: mins(i + 1),
        updatedAt: mins(i + 1),
      },
    });
    if (shouldApprove) {
      await prisma.categoryAccessGrant.update({
        where: { id: grant.id },
        data: {
          status: 'APPROVED',
          reviewNote: 'GST certificate + reseller chain verified. Cleared to retail.',
          reviewedById: admin.id,
          decidedAt: mins(i + 2),
          updatedAt: mins(i + 2),
        },
      });
    }
  }

  // New-category requests: Smart Home Devices resolved; one left PENDING.
  const catReqs = await prisma.categoryRequest.findMany({
    where: { storeId: store.id, name: { in: ['Smart Home Devices', 'Camping & Trekking'] } },
  });
  const have = (n: string) => catReqs.some((r) => r.name === n);
  if (!have('Smart Home Devices')) {
    const electronicsId = await bySlug('category', 'electronics');
    const smartHomeId = await bySlug('category', 'smart-home-devices');
    const req = await prisma.categoryRequest.create({
      data: {
        storeId: store.id,
        sellerId: seller.id,
        name: 'Smart Home Devices',
        proposedParentId: electronicsId,
        justification:
          'We carry a 40-SKU range of smart plugs, bulbs and cameras ahead of the festive season — the catalog has no leaf for them today.',
        status: 'PENDING',
        createdAt: mins(6),
        updatedAt: mins(6),
      },
    });
    let leaf = smartHomeId
      ? await prisma.category.findUnique({ where: { id: smartHomeId } })
      : null;
    if (!leaf) {
      const tax = await prisma.taxClass.findMany({ select: { id: true, name: true } });
      leaf = await prisma.category.create({
        data: {
          name: 'Smart Home Devices',
          slug: 'smart-home-devices',
          parentId: electronicsId,
          taxClassId: tax.find((t) => t.name === 'GST 18%')?.id,
          attributeSetId: (
            await prisma.productAttributeSet.findFirst({
              where: { name: 'Electronics', deletedAt: null },
            })
          )?.id,
          description: 'Smart plugs, bulbs and DIY security cameras on Wi-Fi.',
          imageUrl: shotFor('smart-home-devices', 800, 600),
          displayOrder: 6,
          showInNav: true,
          metaTitle: 'Smart Home Devices - Buy smart home devices online | Aurora',
          metaDescription:
            'Shop smart plugs, bulbs, cameras on Wi-Fi at Aurora. Best prices, genuine products, GST invoices.',
        },
      });
    }
    await prisma.categoryRequest.update({
      where: { id: req.id },
      data: {
        status: 'APPROVED',
        resolvedCategoryId: leaf.id,
        reviewNote: 'Range profile fits the Electronics tree — leaf created.',
        reviewedById: admin.id,
        decidedAt: mins(7),
        updatedAt: mins(7),
      },
    });
  }
  if (!have('Camping & Trekking')) {
    const sportsId = await bySlug('category', 'sports-fitness');
    await prisma.categoryRequest.create({
      data: {
        storeId: store.id,
        sellerId: seller.id,
        name: 'Camping & Trekking',
        proposedParentId: sportsId,
        justification: 'Rucksacks, tents and headlamps planned for next quarter — 25 outdoor SKUs.',
        status: 'PENDING',
        createdAt: mins(8),
        updatedAt: mins(8),
      },
    });
  }

  // Store audit trail for the demo actions.
  await prisma.storeAuditLog.createMany({
    data: [
      {
        storeId: store.id,
        actorId: seller.id,
        actorEmail: seller.email,
        action: 'brand.requested',
        resourceType: 'brand_request',
        resourceId: store.id,
        createdAt: mins(3),
      },
      {
        storeId: store.id,
        actorId: seller.id,
        actorEmail: seller.email,
        action: 'category.requested',
        resourceType: 'category_request',
        resourceId: store.id,
        createdAt: mins(6),
      },
    ],
    skipDuplicates: true,
  });
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('▶ demo-seed (prisma-direct; brand/category copy is original demo content)');

  const admin = await bootstrapAdmin();
  await seedLookupAttributes();
  const attrs = await seedCatalogAttributes(admin.id);
  const setIds = await seedAttributeSets(attrs);
  await seedCategories(setIds);
  await seedBrands();

  const seller = await bootstrapSeller();
  const store = await ensureStore(seller, admin.id);
  const subsPlan = await getPrisma().storeSubscription.findFirst({ where: { storeId: store.id } });
  const mediaIds = await seedSellerMedia(seller.id, store);
  await seedSellerRequests(seller, admin, store, mediaIds);

  const prisma = getPrisma();
  const counts = await Promise.all([
    prisma.adminUser.count(),
    prisma.attribute.count(),
    prisma.productAttribute.count(),
    prisma.productAttributeOption.count(),
    prisma.productAttributeSet.count(),
    prisma.category.count({ where: { deletedAt: null } }),
    prisma.brand.count({ where: { deletedAt: null } }),
    prisma.taxClass.count(),
    prisma.hsnCode.count(),
    prisma.unitOfMeasure.count(),
    prisma.sellerUser.count(),
    prisma.store.count({ where: { deletedAt: null } }),
    prisma.storeMediaAsset.count(),
    prisma.brandAuthorization.count(),
    prisma.brandRequest.count(),
    prisma.categoryRequest.count(),
    prisma.categoryAccessGrant.count(),
  ]);
  console.log('');
  console.log('════════ demo data ════════');
  console.log(`admin / seller : kanjariyaharshit@gmail.com / Harshit@1234#`);
  console.log(
    `store          : ${store.name} (${store.slug})  [trial: ${subsPlan ? subsPlan.status : 'none'}]`,
  );
  console.log(
    `admins ${counts[0]} · lookup attrs ${counts[1]} · product attrs ${counts[2]} (${counts[3]} options) · sets ${counts[4]}`,
  );
  console.log(
    `categories ${counts[5]} · brands ${counts[6]} · tax classes ${counts[7]} · HSN/SAC ${counts[8]} · units ${counts[9]}`,
  );
  console.log(`sellers ${counts[10]} · stores ${counts[11]} · media ${counts[12]}`);
  console.log(
    `brand authorisations ${counts[13]} · brand requests ${counts[14]} · category requests ${counts[15]} · access grants ${counts[16]}`,
  );
  console.log('Products land with Module 6 — attach them to the sets/categories seeded here.');
  console.log('══════════════════════════');
}

main().finally(() => disconnectDatabase());
