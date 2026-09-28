/**
 * Prueba rápida de sync multi-tienda (catálogo + consolidación de reportes).
 * Requiere API en :5100 y LCDS_DATA_DIR apuntando a ./data
 */
const base = process.env.LCDS_API || "http://127.0.0.1:5100/api";

async function json(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

const login = await json("/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
const h = { Authorization: `Bearer ${login.token}` };

const catalog = await json("/sync/export-catalog", {
  method: "POST",
  headers: h,
});
const imported = await json("/sync/import-catalog", {
  method: "POST",
  headers: h,
  body: JSON.stringify({ filePath: catalog.file }),
});

const from = new Date();
from.setDate(1);
const report = await json("/sync/export-report", {
  method: "POST",
  headers: h,
  body: JSON.stringify({
    storeId: login.store.id,
    from: from.toISOString(),
    to: new Date().toISOString(),
  }),
});

const consolidated = await json("/sync/consolidate", {
  method: "POST",
  headers: h,
  body: JSON.stringify({ filePaths: [report.file] }),
});

console.log("SYNC_OK", {
  imported,
  report: report.file,
  consolidated: consolidated.grandTotal,
});
