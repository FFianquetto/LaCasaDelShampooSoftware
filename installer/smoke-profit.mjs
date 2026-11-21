import path from "node:path";
import Database from "better-sqlite3";

const ITEM_COST = "COALESCE(si.unit_cost, p.cost, 0)";
const db = new Database(
  path.resolve("data/lacasadelshampoo.db"),
  { readonly: true },
);

function money(v) {
  return Math.round(Number(v) * 100) / 100;
}

function snap(from, to) {
  const clauses = ["s.ticket_printed = 1"];
  const params = [];
  if (from) {
    clauses.push("s.created_at >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("s.created_at <= ?");
    params.push(to);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS tickets,
              COUNT(si.id) AS units,
              COALESCE(SUM(si.final_price), 0) AS revenue,
              COALESCE(SUM(${ITEM_COST}), 0) AS cost
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       ${where}`,
    )
    .get(...params);
  return {
    tickets: row.tickets,
    units: row.units,
    revenue: money(row.revenue),
    cost: money(row.cost),
    profit: money(row.revenue - row.cost),
  };
}

const now = new Date();
const end = new Date(now);
end.setHours(23, 59, 59, 999);
const dayStart = new Date(now);
dayStart.setHours(0, 0, 0, 0);
const monthStart = new Date(now);
monthStart.setHours(0, 0, 0, 0);
monthStart.setDate(1);

console.log(
  JSON.stringify(
    {
      day: snap(dayStart.toISOString(), end.toISOString()),
      month: snap(monthStart.toISOString(), end.toISOString()),
      all: snap(null, null),
      sale_items: db.prepare("SELECT COUNT(*) c FROM sale_items").get().c,
      with_cost: db
        .prepare("SELECT COUNT(*) c FROM sale_items WHERE unit_cost IS NOT NULL")
        .get().c,
    },
    null,
    2,
  ),
);
db.close();
