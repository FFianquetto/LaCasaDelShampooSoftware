import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const db = new Database("data/lacasadelshampoo.db");
const now = new Date().toISOString();

const adminHash = bcrypt.hashSync("Admin#12", 10);
const userHash = bcrypt.hashSync("Venta#01", 10);

const store = db.prepare("SELECT id FROM stores WHERE code = 'AME'").get();
if (!store) throw new Error("No existe la sucursal Americas");

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (admin) {
  db.prepare(
    "UPDATE users SET password_hash = ?, role = 'Admin', active = 1, full_name = 'Administrador' WHERE username = 'admin'",
  ).run(adminHash);
} else {
  db.prepare(
    `INSERT INTO users (id, store_id, role, username, password_hash, full_name, active, created_at)
     VALUES (?, ?, 'Admin', 'admin', ?, 'Administrador', 1, ?)`,
  ).run(`usr_${randomUUID()}`, store.id, adminHash, now);
}

const empleado = db
  .prepare("SELECT id FROM users WHERE username = 'usuario'")
  .get();
if (empleado) {
  db.prepare(
    "UPDATE users SET password_hash = ?, role = 'Empleado', store_id = ?, active = 1, full_name = 'Usuario mostrador' WHERE username = 'usuario'",
  ).run(userHash, store.id);
} else {
  db.prepare(
    `INSERT INTO users (id, store_id, role, username, password_hash, full_name, active, created_at)
     VALUES (?, ?, 'Empleado', 'usuario', ?, 'Usuario mostrador', 1, ?)`,
  ).run(`usr_${randomUUID()}`, store.id, userHash, now);
}

const staff = [
  { username: "usuario", password: "Venta#01", code: "AME", name: "Usuario Americas" },
  { username: "usuario1", password: "Venta#02", code: "HEN", name: "Usuario Henequen" },
  { username: "usuario2", password: "Venta#03", code: "CHI", name: "Usuario Chihuahua" },
];

for (const person of staff) {
  const branch = db.prepare("SELECT id FROM stores WHERE code = ?").get(person.code);
  if (!branch) throw new Error(`No existe la sucursal ${person.code}`);
  const hash = bcrypt.hashSync(person.password, 10);
  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(person.username);
  if (existing) {
    db.prepare(
      "UPDATE users SET password_hash = ?, role = 'Empleado', store_id = ?, active = 1, full_name = ? WHERE username = ?",
    ).run(hash, branch.id, person.name, person.username);
  } else {
    db.prepare(
      `INSERT INTO users (id, store_id, role, username, password_hash, full_name, active, created_at)
       VALUES (?, ?, 'Empleado', ?, ?, ?, 1, ?)`,
    ).run(`usr_${randomUUID()}`, branch.id, person.username, hash, person.name, now);
  }
}

db.prepare(
  "UPDATE users SET active = 0 WHERE username NOT IN ('admin', 'usuario', 'usuario1', 'usuario2')",
).run();

const rows = db
  .prepare(
    `SELECT u.username, u.role, u.active, s.code AS store
     FROM users u JOIN stores s ON s.id = u.store_id
     ORDER BY u.username`,
  )
  .all();
console.table(rows);

const okAdmin = bcrypt.compareSync(
  "Admin#12",
  db.prepare("SELECT password_hash AS h FROM users WHERE username = 'admin'").get().h,
);
const okUser = bcrypt.compareSync(
  "Venta#01",
  db.prepare("SELECT password_hash AS h FROM users WHERE username = 'usuario'").get().h,
);
console.log({ okAdmin, okUser });
db.close();
