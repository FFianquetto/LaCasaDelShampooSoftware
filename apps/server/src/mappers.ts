import type {
  Customer,
  CustomerCategory,
  Lot,
  LotStatus,
  PriceListItem,
  Product,
  Promotion,
  PromotionType,
  Sale,
  SaleItem,
  SaleType,
  Store,
  User,
  UserRole,
} from "@lcds/shared";
import { intToBool } from "@lcds/db";

export function mapStore(row: Record<string, unknown>): Store {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    createdAt: String(row.created_at),
  };
}

export function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    role: row.role as UserRole,
    username: String(row.username),
    fullName: String(row.full_name),
    active: intToBool(row.active as number),
    createdAt: String(row.created_at),
  };
}

export function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.name),
    brand: row.brand == null ? null : String(row.brand),
    category: row.category == null ? null : String(row.category),
    code: row.code == null ? null : String(row.code),
    cost: row.cost == null ? null : Number(row.cost),
    description: row.description == null ? null : String(row.description),
    active: intToBool(row.active as number),
    createdAt: String(row.created_at),
  };
}

export function mapLot(row: Record<string, unknown>): Lot {
  return {
    id: String(row.id),
    barcode: String(row.barcode),
    productId: String(row.product_id),
    storeId: String(row.store_id),
    status: row.status as LotStatus,
    createdAt: String(row.created_at),
    soldAt: row.sold_at == null ? null : String(row.sold_at),
  };
}

export function mapCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as CustomerCategory,
    phone: row.phone == null ? null : String(row.phone),
    storeId: row.store_id == null ? null : String(row.store_id),
    active: intToBool(row.active as number),
    createdAt: String(row.created_at),
  };
}

export function mapPrice(row: Record<string, unknown>): PriceListItem {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    customerCategory: row.customer_category as CustomerCategory,
    saleType: row.sale_type as SaleType,
    price: Number(row.price),
  };
}

export function mapPromotion(row: Record<string, unknown>): Promotion {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as PromotionType,
    active: intToBool(row.active as number),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    percentOff: row.percent_off == null ? null : Number(row.percent_off),
    buyQty: row.buy_qty == null ? null : Number(row.buy_qty),
    getQty: row.get_qty == null ? null : Number(row.get_qty),
    productId: row.product_id == null ? null : String(row.product_id),
    createdAt: String(row.created_at),
  };
}

export function mapSale(row: Record<string, unknown>): Sale {
  return {
    id: String(row.id),
    folio: String(row.folio),
    storeId: String(row.store_id),
    userId: String(row.user_id),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    saleType: row.sale_type as SaleType,
    customerCategory: row.customer_category as CustomerCategory,
    paymentMethod:
      row.payment_method == null
        ? null
        : (row.payment_method as Sale["paymentMethod"]),
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discount_total),
    total: Number(row.total),
    ticketPrinted: intToBool(row.ticket_printed as number),
    createdAt: String(row.created_at),
  };
}

export function mapSaleItem(row: Record<string, unknown>): SaleItem {
  return {
    id: String(row.id),
    saleId: String(row.sale_id),
    lotId: String(row.lot_id),
    productId: String(row.product_id),
    barcode: String(row.barcode),
    productName: String(row.product_name),
    unitPrice: Number(row.unit_price),
    discount: Number(row.discount),
    finalPrice: Number(row.final_price),
  };
}
