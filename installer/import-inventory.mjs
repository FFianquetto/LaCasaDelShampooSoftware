import { randomUUID } from "node:crypto";
import XLSX from "xlsx";
import Database from "better-sqlite3";

const SHEETS = { HENEQUEN: "HEN", AMERICAS: "AME", CHIH: "CHI" };
const SKIP_HEADERS = new Set(["pendiente de recibir"]);

const ALIAS = {
  "acondicionador jusse": "jusse acondicionador",
  "acondicionador de nina": "acondicionador nina",
  "concentrado de alopecia": "jusse concentrado alopecia",
  "concentrado de gobernadora": "jusse concentrado gobernadora",
  "crema de sebo lata grande": "jusse sebo de res grande",
  "crema de sebo latas grandes": "jusse sebo de res grande",
  "crema de sebo tarro": "jusse tarro sebo de res",
  "crema de sebo tarros": "jusse tarro sebo de res",
  "crema de sebo": "jusse sebo de res grande",
  "jabon de gobernadora": "jusse jabon gobernadora",
  "jabon de espirulina": "jabon espirulina",
  "duos jabon nila": "duo jabon nila",
  "jabon nila duo": "duo jabon nila",
  "jabon vibora": "jabon vibora casacabel",
  "keratina shot": "jusse keratina shot",
  "serum quita verrugas": "verrugas",
  "shmpoo neutro": "shampoo neutro",
  "shampoo jusse": "jusse shampo 1 litro",
  "shampoo jusse 500 ml": "jusse shampoo 500 ml",
  "te perdida de peso": "jusse te perdida de peso",
  "shampoo batana": "jusse shampoo batana",
  "shampoo de nino": "shampoo nino",
  "shampoo dino nino": "shampoo nino",
  "shampoo bergamota y minioxidil": "jusse shampoo bergamota",
  "shampoo bergamota con minoxidil": "jusse shampoo bergamota",
  "antiox 500ml": "dconde antiox 500 ml",
  "shampoo 9 elements 500ml": "dconde shampoo 9 elements",
  "shampoo castano claro": "lichen castano claro",
  "shampoo castano medio": "lichen castano medio",
  "shampoo negro": "lichen negro",
  "shampoo camin": "lichen camin",
  "shampoo oscuro": "lichen oscuro",
  "ceragel con feromonas": "cera gel con feromonas",
  "shampoo le cuvrie": "shampoo le cuivre",
  "kit mini sedas": "kit minisedas",
  "shampoo 2x": "shampoo 2x plus",
  "gliter multicolor": "glitter multicolor",
  "peine individual": "peine con color individual",
  "shampoo keratin 500 ml": "shampoo morfose keratin 500 ml",
  "acondicionador keratin": "acondicionador morfose keratin",
  "mascarilla keratin": "mascarilla morfose keratin",
  "shampoo suave": "sos suave",
  "concentrado raiz": "sos raiz",
  "shampoo crece": "sos crece",
  "corrector liquido soleta": "corrector liquido soleta 01",
  "corrector liquido alfajor": "corrector liquido alfajor 02",
  "corrector liquido oblea": "corrector liquido oblea 03",
  "corrector liquido polvoron": "corrector liquido polvoron 04",
  "corrector liquido biscotti": "corrector liquido biscotti 05",
  "corrector liquido jengibre": "corrector liquido jengibre 06",
  "corrector lquido coyota": "corrector lquido coyota 07",
  "corrector liquido pretzel": "corrector liquido pretzel 08",
  "corrector liquido macarron": "corrector liquido macarron 09",
  "corrector liquido brownie": "corrector liquido brownie 10",
  "rimel prosa tapa gris": "rimel tapa gris",
  "rimel prosa tapa negra": "rimel tapa negra",
  "rimel prosa tapa rosa": "rimel tapa rosa",
  "saniye colageno": "saniye protector solar colageno",
  "maximan caballero minoxidil": "shampoo maximan minoxidil",
  "shampoo rizos con botox": "shampoo rizos perfectos con botox",
  "acond rizos con botox": "acondicionador rizos perfectos botox",
  "unicornio crema": "unicornio crema nina",
  "unicornio liquida": "unicornio liquida nina",
  "perfume roll on paris hilton": "perfume paris hilton",
  "perfume roll on carolina 212": "perfume carolina 212",
  "perfume roll on hugo boss mujer": "perfume hugo boss mujer",
  "perfume roll on acqua de gio": "perfume acqua de gio",
  "perfume roll on 212 vip black": "perfume 212 vip black",
  "perfume roll on 360": "perfume 360",
  "perfume roll on bad boy": "perfume bad boy",
  "perfume roll on blue italian": "perfume blue italian",
  "perfume roll onblue italian": "perfume blue italian",
  "perfume roll on lacoste white": "perfume lacoste white",
  "perfume roll on hugo boss hombre": "perfume hugo boss hombre",
  "perfume ariana grande 60ml": "perfume adriana grande 60ml",
  "perfume hugo boss 60ml mujer": "perfume hugo boss 60ml",
  "labal thirsty pout 08": "labial thirsty pout 08",
  "labial thirsty pout 16": "labila thirsty pout 16",
};

export function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pick(pool, candidate) {
  const exact = pool.filter((product) => norm(product.name) === candidate);
  if (exact.length === 1) return exact[0];
  const close = pool.filter((product) => {
    const name = norm(product.name);
    return name.endsWith(` ${candidate}`) || name.startsWith(`${candidate} `);
  });
  return close.length === 1 ? close[0] : null;
}

const BRAND = {
  jusse: "jusse",
  "d conde": "dconde",
  lichen: "lichen",
  asthar: "asthar",
  morfose: "morfose",
  sos: "sos",
  bissu: "bissu",
  "sana sano": "sana sano",
  naturime: "naturime",
  "arctic fox": "artic fox",
  igora: "igora royal",
};

export function createResolver(productRows) {
  const byName = new Map(productRows.map((product) => [norm(product.name), product]));
  const byBrand = new Map();
  for (const product of productRows) {
    const brand = norm(product.brand);
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(product);
  }

  return function resolveName(raw, brandHeader) {
    const key = norm(raw);
    if (!key || key.startsWith("total inventario")) return null;
    const candidates = [ALIAS[key], key].filter(Boolean);
    const brand = BRAND[norm(brandHeader)] ?? "";
    const pool = brand ? byBrand.get(brand) ?? [] : [];
    for (const candidate of candidates) {
      const found = pick(pool, candidate);
      if (found) return found;
    }
    for (const candidate of candidates) {
      if (byName.has(candidate)) return byName.get(candidate);
    }
    return undefined;
  };
}

function main() {
const db = new Database("data/lacasadelshampoo.db");
db.pragma("busy_timeout = 8000");
const products = db
  .prepare("SELECT id, code, name, brand FROM products WHERE active = 1")
  .all();
const resolveName = createResolver(products);
const wb = XLSX.readFile("INVENTARIO.xlsx");
const now = new Date().toISOString();

const insertLot = db.prepare(
  `INSERT INTO lots (id, barcode, product_id, store_id, status, created_at)
   VALUES (?, ?, ?, ?, 'Disponible', ?)`,
);
const disponibleLots = db.prepare(
  `SELECT id FROM lots
   WHERE product_id = ? AND store_id = ? AND status = 'Disponible'
   ORDER BY barcode`,
);
const deleteLot = db.prepare(
  "DELETE FROM lots WHERE id = ? AND status = 'Disponible'",
);

const summary = [];
const missing = [];
const absent = [];

const apply = db.transaction(() => {
  for (const [sheetName, storeCode] of Object.entries(SHEETS)) {
    const store = db.prepare("SELECT id FROM stores WHERE code = ?").get(storeCode);
    if (!store) throw new Error(`Sucursal ${storeCode} no existe`);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: null,
    });
    const header = rows[0] ?? [];
    const qtyByProduct = new Map();
    for (let col = 0; col < header.length; col += 2) {
      if (header[col] == null || SKIP_HEADERS.has(norm(header[col]))) continue;
      for (let row = 1; row < rows.length; row++) {
        const rawName = rows[row][col];
        if (rawName == null || String(rawName).trim() === "") continue;
        const product = resolveName(rawName, header[col]);
        if (product === null) continue;
        if (!product) {
          missing.push(`${storeCode}\t${rawName}\t${rows[row][col + 1]}`);
          continue;
        }
        const qty = Math.max(0, Math.round(Number(rows[row][col + 1]) || 0));
        const current = qtyByProduct.get(product.id) ?? { qty: 0, names: [] };
        current.qty += qty;
        current.names.push(String(rawName).trim());
        qtyByProduct.set(product.id, current);
      }
    }

    let units = 0;
    for (const product of products) {
      if (!qtyByProduct.has(product.id)) {
        absent.push({ storeId: store.id, productId: product.id });
      }
      const target = qtyByProduct.get(product.id)?.qty ?? 0;
      units += target;
      const lots = disponibleLots.all(product.id, store.id);
      if (lots.length > target) {
        for (const lot of lots.slice(target)) deleteLot.run(lot.id);
      }
      for (let i = lots.length; i < target; i++) {
        const barcode = `${storeCode}-${product.code}-${String(i + 1).padStart(4, "0")}`;
        insertLot.run(`lot_${randomUUID()}`, barcode, product.id, store.id, now);
      }
    }
    const collisions = [...qtyByProduct.values()].filter((item) => item.names.length > 1);
    summary.push({ store: storeCode, products: qtyByProduct.size, units, collisions });
  }
});

apply();

db.exec(`DROP TABLE IF EXISTS inventory_marks`);
db.exec(`
  CREATE TABLE inventory_marks (
    id TEXT PRIMARY KEY NOT NULL,
    store_id TEXT NOT NULL REFERENCES stores(id),
    product_id TEXT NOT NULL REFERENCES products(id)
  );
  CREATE UNIQUE INDEX idx_inventory_marks_store_product
    ON inventory_marks(store_id, product_id);
`);
const insertMark = db.prepare(
  `INSERT INTO inventory_marks (id, store_id, product_id) VALUES (?, ?, ?)`,
);
const saveMarks = db.transaction(() => {
  for (const mark of absent) {
    insertMark.run(`mark_${randomUUID()}`, mark.storeId, mark.productId);
  }
});
saveMarks();

console.log(JSON.stringify(summary, null, 2));
console.log("sin producto en catalogo", missing.length);
for (const line of missing) console.log(line);

const check = db
  .prepare(
    `SELECT st.code, p.name, COUNT(*) AS qty
     FROM lots l
     JOIN stores st ON st.id = l.store_id
     JOIN products p ON p.id = l.product_id
     WHERE l.status = 'Disponible'
       AND p.name IN (
         'aceite anti celulitis',
         'Jusse ACONDICIONADOR',
         'Acondicionador biopearl',
         'DCONDE Shampoo Le Black'
       )
     GROUP BY st.code, p.name
     ORDER BY p.name, st.code`,
  )
  .all();
console.log(check);
db.close();
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("import-inventory.mjs")) main();
