import { newId, nowIso } from "@lcds/db";
import { STORE_SEED } from "@lcds/shared";
import { getDb, closeDb } from "../db.js";
import { hashPassword } from "../services/auth.js";

/**
 * Seed mínimo: 3 tiendas reales + usuarios.
 * El catálogo viene de: npm run import:excel -w @lcds/server
 */
async function seed() {
  const db = getDb();

  const existing = db.prepare("SELECT COUNT(*) AS c FROM stores").get() as {
    c: number;
  };
  if (existing.c > 0) {
    console.log("BD ya tiene sucursales. Seed omitido (usa import:excel para catálogo).");
    closeDb();
    return;
  }

  const stores = STORE_SEED.map((s) => ({
    id: newId("str"),
    name: s.name,
    code: s.code,
  }));

  const insertStore = db.prepare(
    `INSERT INTO stores (id, name, code, created_at) VALUES (?, ?, ?, ?)`,
  );
  for (const s of stores) {
    insertStore.run(s.id, s.name, s.code, nowIso());
  }

  const adminHash = await hashPassword("admin123");
  const empHash = await hashPassword("emp123");

  db.prepare(
    `INSERT INTO users (id, store_id, role, username, password_hash, full_name, active, created_at)
     VALUES (?, ?, 'Admin', 'admin', ?, 'Administrador', 1, ?)`,
  ).run(newId("usr"), stores[0].id, adminHash, nowIso());

  for (const store of stores) {
    db.prepare(
      `INSERT INTO users (id, store_id, role, username, password_hash, full_name, active, created_at)
       VALUES (?, ?, 'Empleado', ?, ?, ?, 1, ?)`,
    ).run(
      newId("usr"),
      store.id,
      `emp${store.code.toLowerCase()}`,
      empHash,
      `Empleado ${store.code}`,
      nowIso(),
    );
  }

  db.prepare(
    `INSERT INTO customers (id, name, category, phone, active, created_at)
     VALUES (?, 'Cliente Mostrador', 'Publico', NULL, 1, ?)`,
  ).run(newId("cus"), nowIso());

  db.prepare(
    `INSERT INTO customers (id, name, category, phone, active, created_at)
     VALUES (?, 'Distribuidora Norte', 'Distribuidor', '8110000000', 1, ?)`,
  ).run(newId("cus"), nowIso());

  console.log("Seed OK — tiendas:", stores.map((s) => s.code).join(", "));
  console.log("  admin / admin123");
  console.log("  empame / emp123  |  emphen / emp123  |  empchi / emp123");
  console.log("Siguiente: npm run import:excel -w @lcds/server");
  closeDb();
}

seed().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
