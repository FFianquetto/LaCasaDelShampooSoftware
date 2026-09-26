import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export type TicketData = {
  storeName: string;
  storeCode: string;
  folio: string;
  date: string;
  employee: string;
  customer: string | null;
  saleType: string;
  customerCategory: string;
  lines: { name: string; barcode: string; price: number }[];
  subtotal: number;
  discountTotal: number;
  total: number;
};

export function formatTicket(data: TicketData): string {
  const w = 42;
  const line = "=".repeat(w);
  const dash = "-".repeat(w);
  const rows: string[] = [
    center(data.storeName, w),
    center(`Sucursal ${data.storeCode}`, w),
    line,
    `Folio: ${data.folio}`,
    `Fecha: ${data.date}`,
    `Cajero: ${data.employee}`,
    `Tipo: ${data.saleType} / ${data.customerCategory}`,
  ];
  if (data.customer) rows.push(`Cliente: ${data.customer}`);
  rows.push(dash);
  for (const item of data.lines) {
    rows.push(item.name.slice(0, w));
    rows.push(
      `  ${item.barcode}`.padEnd(w - 10) +
        `$${item.price.toFixed(2)}`.padStart(10),
    );
  }
  rows.push(dash);
  rows.push(moneyLine("Subtotal", data.subtotal, w));
  if (data.discountTotal > 0) {
    rows.push(moneyLine("Descuento", -data.discountTotal, w));
  }
  rows.push(moneyLine("TOTAL", data.total, w));
  rows.push(line);
  rows.push(center("¡Gracias por su compra!", w));
  rows.push(center("La Casa del Shampoo", w));
  rows.push("\n\n\n");
  return rows.join("\n");
}

function center(text: string, width: number): string {
  const t = text.slice(0, width);
  const pad = Math.max(0, Math.floor((width - t.length) / 2));
  return " ".repeat(pad) + t;
}

function moneyLine(label: string, amount: number, width: number): string {
  const right = `$${Math.abs(amount).toFixed(2)}`;
  const left = amount < 0 ? `${label}: -` : `${label}:`;
  return left.padEnd(width - right.length) + right;
}

export async function printTicket(
  data: TicketData,
): Promise<{ ok: boolean; text: string; error?: string }> {
  const text = formatTicket(data);

  if (config.printMode === "simulate") {
    const dir = path.join(config.dataDir, "tickets");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${data.folio}.txt`);
    fs.writeFileSync(file, text, "utf8");
    console.log(`[ticket] simulated -> ${file}`);
    return { ok: true, text };
  }

  try {
    const dir = path.join(config.dataDir, "tickets");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${data.folio}.txt`);
    fs.writeFileSync(file, text, "utf8");

    // Windows: send plain text to default printer via PowerShell Out-Printer
    if (process.platform === "win32") {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-Content -LiteralPath '${file.replace(/'/g, "''")}' | Out-Printer`,
        ],
        { timeout: 15000 },
      );
    } else {
      await execFileAsync("lp", [file], { timeout: 15000 });
    }
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      text,
      error: err instanceof Error ? err.message : "Error de impresión",
    };
  }
}
