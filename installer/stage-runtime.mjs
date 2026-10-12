import { builtinModules, createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps", "server", "package.json"));
const stage = path.join(root, "apps", "desktop", "src-tauri", "resources", "server");
const runtimeDeps = [
  "bcryptjs",
  "better-sqlite3",
  "cors",
  "express",
  "nodemailer",
  "pdf-lib",
  "zod",
];

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

function skipRuntimeJunk(source) {
  const base = path.basename(source);
  if (
    base === "test" ||
    base === "tests" ||
    base === "__tests__" ||
    base === ".github" ||
    base === "example" ||
    base === "examples" ||
    base === "docs"
  ) {
    return false;
  }
  return !source.endsWith(".map") && !source.endsWith(".md") && !source.endsWith(".d.ts");
}

function copyTree(from, to) {
  fs.cpSync(from, to, { recursive: true, filter: skipRuntimeJunk });
}

copyTree(path.join(root, "apps", "server", "dist"), stage);
fs.rmSync(path.join(stage, "cli"), { recursive: true, force: true });

fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify({ name: "lcds-server", private: true, type: "module" }, null, 2),
);

function installWorkspace(pkgDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const dest = path.join(stage, "node_modules", ...pkg.name.split("/"));
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        type: pkg.type,
        main: pkg.main,
        exports: pkg.exports,
      },
      null,
      2,
    ),
  );
  copyTree(path.join(pkgDir, "dist"), path.join(dest, "dist"));
}

installWorkspace(path.join(root, "packages", "db"));
installWorkspace(path.join(root, "packages", "shared"));

function packageDir(name) {
  let dir = path.dirname(require.resolve(name));
  while (true) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (pkg.name === name) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No se encontró el paquete ${name}`);
    dir = parent;
  }
}

const seen = new Set();
function copyDependency(name) {
  const bare = name.startsWith("node:") ? name.slice(5) : name;
  if (seen.has(name) || name.startsWith("@types/") || builtinModules.includes(bare)) return;
  try {
    require.resolve(name);
  } catch {
    return;
  }
  seen.add(name);
  const srcDir = packageDir(name);
  const manifest = path.join(srcDir, "package.json");
  const destDir = path.join(stage, "node_modules", name);
  copyTree(srcDir, destDir);
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  for (const dep of Object.keys({
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
  })) {
    copyDependency(dep);
  }
}

for (const name of runtimeDeps) copyDependency(name);
fs.copyFileSync(process.execPath, path.join(stage, "node.exe"));

const livePath = path.join(root, "data", "lacasadelshampoo.db");
const catalogPath = path.join(stage, "catalog.db");
const live = new Database(livePath, { fileMustExist: true });
live.pragma("wal_checkpoint(TRUNCATE)");
await live.backup(catalogPath);
live.close();

const catalog = new Database(catalogPath);
catalog.pragma("foreign_keys = OFF");
catalog.exec(`
  DELETE FROM sale_items;
  DELETE FROM sales;
  DELETE FROM customers;
  DELETE FROM promotions;
  DELETE FROM sessions;
  DELETE FROM users;
  UPDATE lots SET status = 'Disponible', sold_at = NULL
    WHERE status != 'Disponible' OR sold_at IS NOT NULL;
`);

const stores = catalog.prepare("SELECT id, code FROM stores").all();
const storeId = Object.fromEntries(stores.map((row) => [row.code, row.id]));
for (const code of ["AME", "HEN", "CHI"]) {
  if (!storeId[code]) throw new Error(`Falta la sucursal ${code} en el catálogo`);
}

const now = new Date().toISOString();
const insertUser = catalog.prepare(
  `INSERT INTO users
   (id, store_id, role, username, password_hash, full_name, phone, active, created_at)
   VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?)`,
);
const accounts = [
  ["admin", "Admin", storeId.AME, "Admin#12", "Administrador"],
  ["usuario", "Empleado", storeId.AME, "Venta#01", "Usuario Americas"],
  ["usuario1", "Empleado", storeId.HEN, "Venta#02", "Usuario Henequen"],
  ["usuario2", "Empleado", storeId.CHI, "Venta#03", "Usuario Chihuahua"],
];
for (const [username, role, store, password, fullName] of accounts) {
  insertUser.run(
    `usr_${randomUUID()}`,
    store,
    role,
    username,
    bcrypt.hashSync(password, 10),
    fullName,
    now,
  );
}
catalog.pragma("journal_mode = DELETE");
catalog.exec("VACUUM");
catalog.close();
for (const suffix of ["-wal", "-shm"]) {
  fs.rmSync(catalogPath + suffix, { force: true });
}

const forbidden = [
  "fernandocancino",
  "@gmail",
  "@hotmail",
  "@outlook",
  "@live.",
  "lcds_smtp",
  "admin#12",
  "venta#0",
];
const catalogText = fs.readFileSync(catalogPath).toString("latin1").toLowerCase();
for (const word of forbidden) {
  if (catalogText.includes(word)) {
    throw new Error(`El catálogo del instalador todavía contiene: ${word}`);
  }
}

function walk(dir, problems) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" && dir !== stage) continue;
      walk(full, problems);
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (lower === ".env" || lower.endsWith(".env")) problems.push(full);
    if (lower.endsWith(".xlsx") || lower.endsWith(".pdf") || lower.endsWith(".wal")) {
      problems.push(full);
    }
    if (lower.endsWith(".db") && entry.name !== "catalog.db") problems.push(full);
    if (dir === stage && lower.endsWith(".js")) {
      const text = fs.readFileSync(full, "utf8").toLowerCase();
      for (const word of ["fernandocancino", "admin#12", "venta#0", "lcds_smtp_pass="]) {
        if (text.includes(word)) problems.push(`${full} contiene ${word}`);
      }
    }
  }
}

const problems = [];
walk(stage, problems);
if (problems.length > 0) {
  throw new Error(`El paquete incluye archivos que no deben ir:\n${problems.join("\n")}`);
}

const check = new Database(catalogPath, { readonly: true });
const summary = {
  users: check.prepare("SELECT username, role FROM users ORDER BY username").all(),
  products: check.prepare("SELECT COUNT(*) AS c FROM products").get().c,
  sales: check.prepare("SELECT COUNT(*) AS c FROM sales").get().c,
  customers: check.prepare("SELECT COUNT(*) AS c FROM customers").get().c,
  vendidos: check.prepare("SELECT COUNT(*) AS c FROM lots WHERE status = 'Vendido'").get().c,
};
check.close();
console.log("Runtime listo en", stage);
console.log(JSON.stringify(summary, null, 2));
