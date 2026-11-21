import type {
  CashCut,
  CashCutStatus,
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
    phone: row.phone == null || row.phone === "" ? null : String(row.phone),
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
    barcode: row.barcode == null ? null : String(row.barcode),
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
    email: row.email == null || row.email === "" ? null : String(row.email),
    address:
      row.address == null || row.address === "" ? null : String(row.address),
    branchName:
      row.branch_name == null || row.branch_name === ""
        ? null
        : String(row.branch_name),
    storeId: row.store_id == null ? null : String(row.store_id),
    clientNumber:
      row.client_number == null || row.client_number === ""
        ? null
        : String(row.client_number),
    purchaseEveryDays:
      row.purchase_every_days == null ? null : Number(row.purchase_every_days),
    active: intToBool(row.active as number),
    createdAt: String(row.created_at),
    frequency: null,
    totalSpent:
      row.total_spent == null ? undefined : Number(row.total_spent),
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
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    discount: Number(row.discount),
    finalPrice: Number(row.final_price),
  };
}

export function mapCashCut(row: Record<string, unknown>): CashCut {
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    userId: String(row.user_id),
    openedAt: String(row.opened_at),
    closedAt: row.closed_at == null ? null : String(row.closed_at),
    openingCash: Number(row.opening_cash ?? 0),
    expectedCash: row.expected_cash == null ? null : Number(row.expected_cash),
    countedCash: row.counted_cash == null ? null : Number(row.counted_cash),
    difference: row.difference == null ? null : Number(row.difference),
    salesCash: Number(row.sales_cash ?? 0),
    salesCard: Number(row.sales_card ?? 0),
    salesTransfer: Number(row.sales_transfer ?? 0),
    salesCredit: Number(row.sales_credit ?? 0),
    salesTotal: Number(row.sales_total ?? 0),
    salesCount: Number(row.sales_count ?? 0),
    cashIn: Number(row.cash_in ?? 0),
    cashOut: Number(row.cash_out ?? 0),
    notes: row.notes == null || row.notes === "" ? null : String(row.notes),
    status: row.status as CashCutStatus,
    createdAt: String(row.created_at),
    employeeName:
      row.employee_name == null ? undefined : String(row.employee_name),
    storeName: row.store_name == null ? undefined : String(row.store_name),
    storeCode: row.store_code == null ? undefined : String(row.store_code),
  };
}
