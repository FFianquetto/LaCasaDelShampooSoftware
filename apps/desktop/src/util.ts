import { ApiError } from "./api";

export type Period = "dia" | "semana" | "mes";

export const PERIOD_LABEL: Record<Period, string> = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
};

export function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

export function periodRange(period: Period, today: Date) {
  const to = endOfDay(today);
  const from = startOfDay(today);
  if (period === "semana") {
    const weekday = from.getDay();
    const offset = weekday === 0 ? 6 : weekday - 1;
    from.setDate(from.getDate() - offset);
  }
  if (period === "mes") from.setDate(1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Convierte el valor de un <input type="date"> (YYYY-MM-DD, local) a ISO. */
export function dateToIso(value: string, end = false): string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = end
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
  return date.toISOString();
}

/** Fecha local en formato de <input type="date">. */
export function toInputDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function defaultDateFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toInputDate(date);
}

export function defaultDateTo(): string {
  return toInputDate(new Date());
}

/** Normaliza teléfono MX para wa.me (52 + 10 dígitos). */
export function normalizePhoneMx(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `52${digits}`;
  return digits;
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${normalizePhoneMx(phone)}?text=${encodeURIComponent(text)}`;
}

export function money(value: number | null | undefined): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export function shortStore(name: string): string {
  return name.replace("La Casa del Shampoo — ", "");
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("es-MX") : "—";
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("es-MX") : "—";
}

export function errMsg(err: unknown, fallback = "Error"): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** Arma una query string omitiendo valores vacíos. */
export function qs(values: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}
