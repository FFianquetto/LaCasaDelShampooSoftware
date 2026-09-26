import { z } from "zod";
import {
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

export const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: customerCategorySchema,
  phone: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
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

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  category: customerCategorySchema,
  phone: z.string().optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const upsertPriceSchema = z.object({
  productId: z.string().min(1),
  customerCategory: customerCategorySchema,
  saleType: saleTypeSchema,
  price: z.number().nonnegative(),
});
export type UpsertPriceInput = z.infer<typeof upsertPriceSchema>;

export const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(4),
  fullName: z.string().min(1),
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
export const commitSaleSchema = z.object({
  storeId: z.string().min(1),
  customerId: z.string().nullable().optional(),
  customerCategory: customerCategorySchema,
  saleType: saleTypeSchema,
  paymentMethod: paymentMethodSchema.optional(),
  barcodes: z.array(z.string().min(1)).min(1),
  printTicket: z.boolean().default(true),
});
export type CommitSaleInput = z.infer<typeof commitSaleSchema>;

export const reportQuerySchema = z.object({
  storeId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

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
  discount: z.number(),
  finalPrice: z.number(),
  promotionName: z.string().nullable(),
});
export type ResolvedCartLine = z.infer<typeof resolvedCartLineSchema>;
