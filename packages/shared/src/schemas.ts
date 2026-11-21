import { z } from "zod";
import {
  cashCutStatusSchema,
  cashMovementTypeSchema,
  customerCategorySchema,
  lotStatusSchema,
  paymentMethodSchema,
  promotionTypeSchema,
  saleTypeSchema,
  userRoleSchema,
} from "./enums.js";

export const storeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  createdAt: z.string(),
});
export type Store = z.infer<typeof storeSchema>;

export const userSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  role: userRoleSchema,
  username: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const productSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  category: z.string().nullable(),
  code: z.string().nullable(),
  barcode: z.string().nullable(),
  cost: z.number().nullable(),
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const lotSchema = z.object({
  id: z.string(),
  barcode: z.string(),
  productId: z.string(),
  storeId: z.string(),
  status: lotStatusSchema,
  createdAt: z.string(),
  soldAt: z.string().nullable(),
});
export type Lot = z.infer<typeof lotSchema>;

export const customerFrequencySchema = z.object({
  salesCount: z.number().int().nonnegative(),
  lastPurchaseAt: z.string().nullable(),
  nextPurchaseAt: z.string().nullable(),
  avgDaysBetween: z.number().nullable(),
  daysSinceAnchor: z.number().nullable(),
  daysOverdue: z.number().nullable(),
  status: z.enum(["al_dia", "proximo", "atrasado", "sin_regla"]),
});
export type CustomerFrequency = z.infer<typeof customerFrequencySchema>;

export const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: customerCategorySchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  branchName: z.string().nullable(),
  storeId: z.string().nullable(),
  clientNumber: z.string().nullable(),
  purchaseEveryDays: z.number().int().positive().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  frequency: customerFrequencySchema.nullable(),
  /** Total histórico de ventas del cliente (por id o correo del ticket). */
  totalSpent: z.number().nonnegative().optional(),
});
export type Customer = z.infer<typeof customerSchema>;

export const priceListItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  customerCategory: customerCategorySchema,
  saleType: saleTypeSchema,
  price: z.number().nonnegative(),
});
export type PriceListItem = z.infer<typeof priceListItemSchema>;

export const promotionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: promotionTypeSchema,
  active: z.boolean(),
  startsAt: z.string(),
  endsAt: z.string(),
  percentOff: z.number().nullable(),
  buyQty: z.number().nullable(),
  getQty: z.number().nullable(),
  productId: z.string().nullable(),
  createdAt: z.string(),
});
export type Promotion = z.infer<typeof promotionSchema>;

export const saleItemSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  lotId: z.string(),
  productId: z.string(),
  barcode: z.string(),
  productName: z.string(),
  unitPrice: z.number(),
  unitCost: z.number().nullable(),
  discount: z.number(),
  finalPrice: z.number(),
});
export type SaleItem = z.infer<typeof saleItemSchema>;

export const saleSchema = z.object({
  id: z.string(),
  folio: z.string(),
  storeId: z.string(),
  userId: z.string(),
  customerId: z.string().nullable(),
  saleType: saleTypeSchema,
  customerCategory: customerCategorySchema,
  paymentMethod: paymentMethodSchema.nullable(),
  subtotal: z.number(),
  discountTotal: z.number(),
  total: z.number(),
  ticketPrinted: z.boolean(),
  createdAt: z.string(),
});
export type Sale = z.infer<typeof saleSchema>;

/** Al menos 8 caracteres, un número y un carácter especial. */
export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .regex(/\d/, "Debe incluir al menos un número")
  .regex(/[^A-Za-z0-9]/, "Debe incluir al menos un carácter especial");

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionSchema = z.object({
  token: z.string(),
  user: userSchema,
  store: storeSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export const createProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().optional(),
  category: z.string().optional(),
  cost: z.number().nonnegative().optional(),
  description: z.string().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const createLotSchema = z.object({
  barcode: z.string().min(1),
  productId: z.string().min(1),
  storeId: z.string().min(1),
});
export type CreateLotInput = z.infer<typeof createLotSchema>;

const clientNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(
    /^[A-Za-z0-9-]+$/,
    "El número solo puede tener letras, números y guiones",
  );

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  category: customerCategorySchema,
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  address: z.string().trim().optional(),
  branchName: z.string().trim().optional(),
  storeId: z.string().min(1),
  clientNumber: clientNumberSchema.optional(),
  purchaseEveryDays: z.number().int().min(1).max(365).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerRuleSchema = z.object({
  clientNumber: clientNumberSchema,
  purchaseEveryDays: z.number().int().min(1).max(365),
});
export type UpdateCustomerRuleInput = z.infer<typeof updateCustomerRuleSchema>;

export const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  category: customerCategorySchema.optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  branchName: z.string().trim().nullable().optional(),
  storeId: z.string().min(1).nullable().optional(),
  clientNumber: clientNumberSchema.optional(),
  purchaseEveryDays: z.number().int().min(1).max(365).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const upsertPriceSchema = z.object({
  productId: z.string().min(1),
  customerCategory: customerCategorySchema,
  saleType: saleTypeSchema,
  price: z.number().nonnegative(),
  /** Día de vigencia (YYYY-MM-DD). Por defecto hoy. */
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa fecha AAAA-MM-DD")
    .optional(),
  note: z.string().trim().max(300).optional(),
});
export type UpsertPriceInput = z.infer<typeof upsertPriceSchema>;

export const upsertProductCostSchema = z.object({
  productId: z.string().min(1),
  cost: z.number().nonnegative(),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa fecha AAAA-MM-DD")
    .optional(),
  note: z.string().trim().max(300).optional(),
});
export type UpsertProductCostInput = z.infer<typeof upsertProductCostSchema>;

export const priceCostHistorySchema = z.object({
  id: z.string(),
  productId: z.string(),
  productCode: z.string().nullable(),
  productName: z.string(),
  brand: z.string().nullable(),
  kind: z.enum(["cost", "price"]),
  customerCategory: customerCategorySchema.nullable(),
  saleType: saleTypeSchema.nullable(),
  previousValue: z.number().nullable(),
  newValue: z.number(),
  effectiveDate: z.string(),
  note: z.string().nullable(),
  employeeName: z.string().nullable(),
  createdAt: z.string(),
});
export type PriceCostHistory = z.infer<typeof priceCostHistorySchema>;

export const createUserSchema = z.object({
  username: z.string().min(3),
  password: passwordSchema,
  fullName: z.string().min(1),
  phone: z.string().trim().min(1, "Escribe el teléfono"),
  role: userRoleSchema,
  storeId: z.string().min(1),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const createPromotionSchema = z.object({
  name: z.string().min(1),
  type: promotionTypeSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  percentOff: z.number().min(0).max(100).optional(),
  buyQty: z.number().int().positive().optional(),
  getQty: z.number().int().positive().optional(),
  productId: z.string().optional(),
  active: z.boolean().default(true),
});
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

export const cartItemSchema = z.object({
  barcode: z.string().min(1),
});
export const commitSaleBaseSchema = z.object({
  storeId: z.string().min(1),
  customerId: z.string().nullable().optional(),
  customerCategory: customerCategorySchema,
  saleType: saleTypeSchema,
  paymentMethod: paymentMethodSchema.optional(),
  barcodes: z.array(z.string().min(1)).min(1),
  deliveryChannel: z.enum(["email", "whatsapp", "none"]).default("none"),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  printTicket: z.boolean().default(true),
  notifyHq: z.boolean().optional(),
});

export const commitSaleSchema = commitSaleBaseSchema.superRefine(
  (value, ctx) => {
    if (value.deliveryChannel === "email") {
      if (!value.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["email"],
          message: "Escribe un correo válido",
        });
      }
    } else if (value.deliveryChannel === "whatsapp") {
      const digits = (value.phone ?? "").replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["phone"],
          message: "Escribe un WhatsApp válido (10 dígitos)",
        });
      }
    }
  },
);
export type CommitSaleInput = z.infer<typeof commitSaleBaseSchema>;

export const reportQuerySchema = z.object({
  storeId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional(),
  customerId: z.string().optional(),
  productId: z.string().optional(),
  category: z.string().optional(),
  customerCategory: customerCategorySchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  saleType: saleTypeSchema.optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const openCashCutSchema = z.object({
  storeId: z.string().min(1),
  openingCash: z.number().nonnegative(),
  notes: z.string().trim().optional(),
});
export type OpenCashCutInput = z.infer<typeof openCashCutSchema>;

export const cashMovementSchema = z.object({
  type: cashMovementTypeSchema,
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(200),
});
export type CashMovementInput = z.infer<typeof cashMovementSchema>;

export const closeCashCutSchema = z.object({
  countedCash: z.number().nonnegative(),
  notes: z.string().trim().optional(),
});
export type CloseCashCutInput = z.infer<typeof closeCashCutSchema>;

export const cashCutSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  userId: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  openingCash: z.number(),
  expectedCash: z.number().nullable(),
  countedCash: z.number().nullable(),
  difference: z.number().nullable(),
  salesCash: z.number(),
  salesCard: z.number(),
  salesTransfer: z.number(),
  salesCredit: z.number(),
  salesTotal: z.number(),
  salesCount: z.number(),
  cashIn: z.number(),
  cashOut: z.number(),
  notes: z.string().nullable(),
  status: cashCutStatusSchema,
  createdAt: z.string(),
  employeeName: z.string().optional(),
  storeName: z.string().optional(),
  storeCode: z.string().optional(),
});
export type CashCut = z.infer<typeof cashCutSchema>;

export const adjustStockSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  mode: z.enum(["set", "increase", "decrease"]),
  quantity: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(300),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const catalogSyncPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("catalog"),
  exportedAt: z.string(),
  sourceStoreId: z.string().optional(),
  products: z.array(productSchema),
  prices: z.array(priceListItemSchema),
  promotions: z.array(promotionSchema),
});
export type CatalogSyncPayload = z.infer<typeof catalogSyncPayloadSchema>;

export const storeReportPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("store_report"),
  exportedAt: z.string(),
  store: storeSchema,
  from: z.string(),
  to: z.string(),
  sales: z.array(
    saleSchema.extend({
      items: z.array(saleItemSchema),
      employeeName: z.string().optional(),
      customerName: z.string().nullable().optional(),
    }),
  ),
  totals: z.object({
    salesCount: z.number(),
    lotsSold: z.number(),
    revenue: z.number(),
  }),
});
export type StoreReportPayload = z.infer<typeof storeReportPayloadSchema>;

export const resolvedCartLineSchema = z.object({
  lotId: z.string(),
  barcode: z.string(),
  productId: z.string(),
  productName: z.string(),
  unitPrice: z.number(),
  unitCost: z.number().nullable().optional(),
  discount: z.number(),
  finalPrice: z.number(),
  promotionName: z.string().nullable(),
});
export type ResolvedCartLine = z.infer<typeof resolvedCartLineSchema>;
