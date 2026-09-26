export const MIGRATION_001 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL REFERENCES stores(id),
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Empleado')),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  cost REAL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY NOT NULL,
  barcode TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES products(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL CHECK (status IN ('Disponible', 'Vendido')) DEFAULT 'Disponible',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sold_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lots_barcode ON lots(barcode);
CREATE INDEX IF NOT EXISTS idx_lots_store_status ON lots(store_id, status);
CREATE INDEX IF NOT EXISTS idx_lots_product ON lots(product_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Publico', 'Distribuidor', 'Foraneo', 'Reparto')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_list (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  customer_category TEXT NOT NULL CHECK (customer_category IN ('Publico', 'Distribuidor', 'Foraneo', 'Reparto')),
  sale_type TEXT NOT NULL CHECK (sale_type IN ('Menudeo', 'Mayoreo')),
  price REAL NOT NULL CHECK (price >= 0),
  UNIQUE (product_id, customer_category, sale_type)
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PercentOff', 'BuyXGetY')),
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  percent_off REAL,
  buy_qty INTEGER,
  get_qty INTEGER,
  product_id TEXT REFERENCES products(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY NOT NULL,
  folio TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT REFERENCES customers(id),
  sale_type TEXT NOT NULL CHECK (sale_type IN ('Menudeo', 'Mayoreo')),
  customer_category TEXT NOT NULL CHECK (customer_category IN ('Publico', 'Distribuidor', 'Foraneo', 'Reparto')),
  payment_method TEXT CHECK (payment_method IN ('Efectivo', 'Tarjeta', 'Transferencia')),
  subtotal REAL NOT NULL,
  discount_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  ticket_printed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_store_created ON sales(store_id, created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  lot_id TEXT NOT NULL UNIQUE REFERENCES lots(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  barcode TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  final_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Upgrade desde esquema v1 (categorías Local/DistribuidorLocal/…) */
export const MIGRATION_002 = `
PRAGMA foreign_keys = OFF;

ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN cost REAL;

CREATE TABLE customers_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Publico', 'Distribuidor', 'Foraneo', 'Reparto')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO customers_new (id, name, category, phone, active, created_at)
SELECT id, name,
  CASE category
    WHEN 'Local' THEN 'Publico'
    WHEN 'DistribuidorLocal' THEN 'Distribuidor'
    WHEN 'DistribuidorForaneo' THEN 'Foraneo'
    WHEN 'Publico' THEN 'Publico'
    WHEN 'Distribuidor' THEN 'Distribuidor'
    WHEN 'Foraneo' THEN 'Foraneo'
    WHEN 'Reparto' THEN 'Reparto'
    ELSE 'Publico'
  END,
  phone, active, created_at
FROM customers;

DROP TABLE customers;
ALTER TABLE customers_new RENAME TO customers;

CREATE TABLE price_list_new (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  customer_category TEXT NOT NULL CHECK (customer_category IN ('Publico', 'Distribuidor', 'Foraneo', 'Reparto')),
  sale_type TEXT NOT NULL CHECK (sale_type IN ('Menudeo', 'Mayoreo')),
  price REAL NOT NULL CHECK (price >= 0),
  UNIQUE (product_id, customer_category, sale_type)
);

INSERT OR IGNORE INTO price_list_new (id, product_id, customer_category, sale_type, price)
SELECT id, product_id,
  CASE customer_category
    WHEN 'Local' THEN 'Publico'
    WHEN 'DistribuidorLocal' THEN 'Distribuidor'
    WHEN 'DistribuidorForaneo' THEN 'Foraneo'
    ELSE customer_category
  END,
  sale_type, price
FROM price_list;

DROP TABLE price_list;
ALTER TABLE price_list_new RENAME TO price_list;

CREATE TABLE sales_new (
  id TEXT PRIMARY KEY NOT NULL,
  folio TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT REFERENCES customers(id),
  sale_type TEXT NOT NULL CHECK (sale_type IN ('Menudeo', 'Mayoreo')),
  customer_category TEXT NOT NULL CHECK (customer_category IN ('Publico', 'Distribuidor', 'Foraneo', 'Reparto')),
  payment_method TEXT CHECK (payment_method IN ('Efectivo', 'Tarjeta', 'Transferencia')),
  subtotal REAL NOT NULL,
  discount_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  ticket_printed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sales_new (
  id, folio, store_id, user_id, customer_id, sale_type, customer_category,
  payment_method, subtotal, discount_total, total, ticket_printed, created_at
)
SELECT id, folio, store_id, user_id, customer_id, sale_type,
  CASE customer_category
    WHEN 'Local' THEN 'Publico'
    WHEN 'DistribuidorLocal' THEN 'Distribuidor'
    WHEN 'DistribuidorForaneo' THEN 'Foraneo'
    ELSE customer_category
  END,
  NULL, subtotal, discount_total, total, ticket_printed, created_at
FROM sales;

DROP TABLE sales;
ALTER TABLE sales_new RENAME TO sales;
CREATE INDEX IF NOT EXISTS idx_sales_store_created ON sales(store_id, created_at);

PRAGMA foreign_keys = ON;
`;

export const MIGRATION_003 = `
ALTER TABLE products ADD COLUMN category TEXT;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
`;

export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  { id: 1, name: "001_initial_schema", sql: MIGRATION_001 },
  { id: 2, name: "002_excel_categories_brand_cost", sql: MIGRATION_002 },
  { id: 3, name: "003_product_general_category", sql: MIGRATION_003 },
];
