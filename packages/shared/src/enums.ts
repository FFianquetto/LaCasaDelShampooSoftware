import { z } from "zod";

export const UserRole = {
  Admin: "Admin",
  Empleado: "Empleado",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const LotStatus = {
  Disponible: "Disponible",
  Vendido: "Vendido",
} as const;
export type LotStatus = (typeof LotStatus)[keyof typeof LotStatus];

/** Alineado al Excel: Público, Distribuidor, Foráneo, Reparto */
export const CustomerCategory = {
  Publico: "Publico",
  Distribuidor: "Distribuidor",
  Foraneo: "Foraneo",
  Reparto: "Reparto",
} as const;
export type CustomerCategory =
  (typeof CustomerCategory)[keyof typeof CustomerCategory];

export const SaleType = {
  Menudeo: "Menudeo",
  Mayoreo: "Mayoreo",
} as const;
export type SaleType = (typeof SaleType)[keyof typeof SaleType];

export const PaymentMethod = {
  Efectivo: "Efectivo",
  Tarjeta: "Tarjeta",
  Transferencia: "Transferencia",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PromotionType = {
  PercentOff: "PercentOff",
  BuyXGetY: "BuyXGetY",
} as const;
export type PromotionType = (typeof PromotionType)[keyof typeof PromotionType];

export const userRoleSchema = z.enum(["Admin", "Empleado"]);
export const lotStatusSchema = z.enum(["Disponible", "Vendido"]);
export const customerCategorySchema = z.enum([
  "Publico",
  "Distribuidor",
  "Foraneo",
  "Reparto",
]);
export const saleTypeSchema = z.enum(["Menudeo", "Mayoreo"]);
export const paymentMethodSchema = z.enum([
  "Efectivo",
  "Tarjeta",
  "Transferencia",
]);
export const promotionTypeSchema = z.enum(["PercentOff", "BuyXGetY"]);

export const CUSTOMER_CATEGORY_LABELS: Record<CustomerCategory, string> = {
  Publico: "Local (Público)",
  Distribuidor: "Distribuidor Local",
  Foraneo: "Distribuidor Foráneo",
  Reparto: "Reparto",
};

export const STORE_CODES = ["AME", "HEN", "CHI"] as const;
export type StoreCode = (typeof STORE_CODES)[number];

export const STORE_SEED = [
  { code: "AME", name: "La Casa del Shampoo — Americas" },
  { code: "HEN", name: "La Casa del Shampoo — Henequen" },
  { code: "CHI", name: "La Casa del Shampoo — Chihuahua" },
] as const;
