import { Router } from "express";
import {
  loginRequestSchema,
  createProductSchema,
  createLotSchema,
  createCustomerSchema,
  updateCustomerSchema,
  upsertPriceSchema,
  createUserSchema,
  createPromotionSchema,
  commitSaleBaseSchema,
  commitSaleSchema,
  reportQuerySchema,
  openCashCutSchema,
  cashMovementSchema,
  closeCashCutSchema,
  adjustStockSchema,
  upsertProductCostSchema,
  UserRole,
} from "@lcds/shared";
import { getDb } from "../db.js";
import { login, logout } from "../services/auth.js";
import {
  listProducts,
  listCatalog,
  listProductCategories,
  createProduct,
  updateProduct,
  productStockByStore,
  listLots,
  createLot,
  getLotByBarcode,
  listCustomers,
  createCustomer,
  updateCustomer,
  customerPurchaseAnalysis,
  listPrices,
  upsertPrice,
  upsertProductCost,
  listPriceCostHistory,
  pricesOverview,
  listUsers,
  createUser,
  deactivateUser,
  listStores,
  listPromotions,
  createPromotion,
  setPromotionActive,
} from "../services/catalog.js";import {
  previewSale,
  commitSale,
  listRecentTickets,
  listSalesHistory,
  getSaleDetail,
} from "../services/sales.js";
import {
  openCashCut,
  getOpenCashCut,
  addCashMovement,
  previewCashCut,
  closeCashCut,
  listCashCuts,
  getCashCutDetail,
  assertCashCutAccess,
} from "../services/cash.js";
import {
  adjustStock,
  listInventoryAdjustments,
} from "../services/inventory-adjust.js";
import {
  salesReport,
  productSalesReport,
  salesByProductCategoryReport,
  salesByCustomerCategoryReport,
  salesByPaymentMethodReport,
  employeeProductivityReport,
  customerSalesReport,
  profitSummary,
  inventorySummary,
  stockAlerts,
  exportCatalog,
  importCatalog,
  exportStoreReport,
  consolidateReports,
} from "../services/reports.js";
import {
  requireAuth,
  requireRole,
  type AuthedRequest,
} from "../middleware.js";
import { AppError } from "../errors.js";
import {
  config,
  hqEmailSettings,
  mailSettings,
  whatsappSettings,
} from "../config.js";
import { z } from "zod";

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "LaCasaDelShampoo",
    dataDir: config.dataDir,
    printMode: config.printMode,
  });
});

apiRouter.post("/auth/login", async (req, res, next) => {
  try {
    const body = loginRequestSchema.parse(req.body);
    const session = await login(getDb(), body.username, body.password);
    res.json(session);
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/auth/logout", requireAuth, (req: AuthedRequest, res) => {
  if (req.token) logout(getDb(), req.token);
  res.json({ ok: true });
});

apiRouter.get("/auth/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user, store: req.store });
});

apiRouter.get("/stores", requireAuth, (_req, res) => {
  res.json(listStores(getDb()));
});

apiRouter.get("/products", requireAuth, (req, res) => {
  res.json(
    listProducts(getDb(), {
      activeOnly: req.query.active === "1",
      category: req.query.category as string | undefined,
      q: req.query.q as string | undefined,
    }),
  );
});

apiRouter.get("/products/categories", requireAuth, (_req, res) => {
  res.json(listProductCategories(getDb()));
});

apiRouter.get("/catalog", requireAuth, (req: AuthedRequest, res) => {
  const requested = req.query.storeId as string | undefined;
  const storeId =
    req.user?.role === UserRole.Empleado ? req.user.storeId : requested;
  res.json(
    listCatalog(getDb(), {
      storeId,
      q: req.query.q as string | undefined,
    }),
  );
});

apiRouter.post(
  "/products",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = createProductSchema.parse(req.body);
      res.status(201).json(createProduct(getDb(), body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.patch(
  "/products/:id",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = createProductSchema.partial().extend({
        active: z.boolean().optional(),
      }).parse(req.body);
      res.json(updateProduct(getDb(), param(req.params.id), body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get("/products/:id/stock", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const storeId =
      req.user.role === UserRole.Empleado ? req.user.storeId : undefined;
    res.json(productStockByStore(getDb(), param(req.params.id), storeId));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/lots", requireAuth, (req: AuthedRequest, res) => {
  const storeId =
    req.user?.role === UserRole.Empleado
      ? req.user.storeId
      : (req.query.storeId as string | undefined);
  res.json(
    listLots(getDb(), {
      storeId,
      status: req.query.status as string | undefined,
      q: req.query.q as string | undefined,
    }),
  );
});

apiRouter.get("/lots/by-barcode/:barcode", requireAuth, (req, res, next) => {
  try {
    res.json(getLotByBarcode(getDb(), param(req.params.barcode)));
  } catch (err) {
    next(err);
  }
});

apiRouter.post(
  "/lots",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = createLotSchema.parse(req.body);
      res.status(201).json(createLot(getDb(), body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get("/customers", requireAuth, (req: AuthedRequest, res) => {
  const isAdmin = req.user?.role === UserRole.Admin;
  const requested = req.query.storeId as string | undefined;
  const storeId =
    req.user?.role === UserRole.Empleado ? req.user.storeId : requested || undefined;
  res.json(listCustomers(getDb(), storeId, isAdmin));
});

apiRouter.post("/customers", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const body = createCustomerSchema.parse(req.body);
    if (req.user?.role === UserRole.Empleado) {
      body.storeId = req.user.storeId;
      delete body.clientNumber;
      delete body.purchaseEveryDays;
    }
    res.status(201).json(createCustomer(getDb(), body));
  } catch (err) {
    next(err);
  }
});

apiRouter.patch(
  "/customers/:id",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = updateCustomerSchema.parse(req.body);
      res.json(updateCustomer(getDb(), param(req.params.id), body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/customers/:id/analysis",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = z
        .object({
          storeId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        })
        .parse(req.query);
      res.json(customerPurchaseAnalysis(getDb(), param(req.params.id), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/prices",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res) => {
    res.json(listPrices(getDb(), req.query.productId as string | undefined));
  },
);

apiRouter.get(
  "/prices/overview",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res) => {
    res.json(
      pricesOverview(getDb(), {
        brand: (req.query.brand as string | undefined) || undefined,
        q: (req.query.q as string | undefined) || undefined,
      }),
    );
  },
);

apiRouter.get(
  "/prices/history",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = z
        .object({
          productId: z.string().optional(),
          brand: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          kind: z.enum(["cost", "price"]).optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        })
        .parse(req.query);
      res.json(listPriceCostHistory(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.put(
  "/prices",
  requireAuth,
  requireRole(UserRole.Admin),
  (req: AuthedRequest, res, next) => {
    try {
      if (!req.user) throw new AppError("No autenticado", 401);
      const body = upsertPriceSchema.parse(req.body);
      res.json(upsertPrice(getDb(), body, req.user.id));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.put(
  "/prices/cost",
  requireAuth,
  requireRole(UserRole.Admin),
  (req: AuthedRequest, res, next) => {
    try {
      if (!req.user) throw new AppError("No autenticado", 401);
      const body = upsertProductCostSchema.parse(req.body);
      res.json(upsertProductCost(getDb(), req.user.id, body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/users",
  requireAuth,
  requireRole(UserRole.Admin),
  (_req, res) => {
    res.json(listUsers(getDb()));
  },
);

apiRouter.post(
  "/users",
  requireAuth,
  requireRole(UserRole.Admin),
  async (req, res, next) => {
    try {
      const body = createUserSchema.parse(req.body);
      res.status(201).json(await createUser(getDb(), body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.delete(
  "/users/:id",
  requireAuth,
  requireRole(UserRole.Admin),
  (req: AuthedRequest, res, next) => {
    try {
      if (!req.user) throw new AppError("No autenticado", 401);
      res.json(deactivateUser(getDb(), param(req.params.id), req.user.id));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get("/promotions", requireAuth, (_req, res) => {
  res.json(listPromotions(getDb()));
});

apiRouter.post(
  "/promotions",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = createPromotionSchema.parse(req.body);
      res.status(201).json(createPromotion(getDb(), body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.patch(
  "/promotions/:id/active",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const active = z.object({ active: z.boolean() }).parse(req.body).active;
      res.json(setPromotionActive(getDb(), param(req.params.id), active));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get("/sales/recent", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const storeId =
      req.user.role === UserRole.Empleado
        ? req.user.storeId
        : String(req.query.storeId ?? "");
    if (!storeId) {
      res.json([]);
      return;
    }
    res.json(listRecentTickets(getDb(), storeId, 5));
  } catch (err) {
    next(err);
  }
});

const salesHistoryQuerySchema = reportQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

apiRouter.get("/sales/history", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const { limit, offset, ...filters } = salesHistoryQuerySchema.parse(req.query);
    // Por cuenta: el empleado solo ve sus ventas en su sucursal.
    if (req.user.role === UserRole.Empleado) {
      filters.userId = req.user.id;
      filters.storeId = req.user.storeId;
    }
    res.json(
      listSalesHistory(getDb(), filters, {
        limit,
        offset,
        viewer: { id: req.user.id, role: req.user.role },
      }),
    );
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/sales/:id", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    res.json(
      getSaleDetail(getDb(), param(req.params.id), {
        id: req.user.id,
        role: req.user.role,
      }),
    );
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/sales/preview", requireAuth, (req, res, next) => {
  try {
    const body = commitSaleBaseSchema
      .omit({ printTicket: true, email: true, phone: true, deliveryChannel: true })
      .parse(req.body);
    const session = req as AuthedRequest;
    if (session.user?.role === UserRole.Empleado) {
      body.storeId = session.user.storeId;
    }
    res.json(previewSale(getDb(), body));
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/sales/commit", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const body = commitSaleSchema.parse(req.body);
    if (req.user.role === UserRole.Empleado && body.storeId !== req.user.storeId) {
      throw new AppError("Solo puede vender en su sucursal", 403);
    }
    const result = await commitSale(getDb(), req.user.id, body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/reports/sales", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const query = reportQuerySchema.parse(req.query);
    const isAdmin = req.user.role === UserRole.Admin;
    // Empleado: solo sus ventas en su sucursal. Admin: por cuenta y/o sucursal.
    const storeId = isAdmin ? query.storeId : req.user.storeId;
    const userId = isAdmin ? query.userId : req.user.id;
    res.json(
      salesReport(
        getDb(),
        { ...query, storeId, userId },
        { cashCut: isAdmin },
      ),
    );
  } catch (err) {
    next(err);
  }
});

apiRouter.get(
  "/reports/products",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = reportQuerySchema.parse(req.query);
      res.json(productSalesReport(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/reports/by-product-category",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = reportQuerySchema.parse(req.query);
      res.json(salesByProductCategoryReport(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/reports/by-customer-category",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = reportQuerySchema.parse(req.query);
      res.json(salesByCustomerCategoryReport(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

/** Resumen del día (o rango) del empleado autenticado; admin puede pedir otro userId. */
apiRouter.get("/reports/my-day", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const query = reportQuerySchema.parse(req.query);
    const userId =
      req.user.role === UserRole.Admin && query.userId
        ? query.userId
        : req.user.id;
    const report = employeeProductivityReport(getDb(), { ...query, userId });
    const employee = report.employees[0] ?? null;
    const hideCost = req.user.role !== UserRole.Admin;
    const strip = (m: {
      tickets: number;
      units: number;
      revenue: number;
      cost: number;
      profit: number;
      avgTicket: number;
    }) =>
      hideCost
        ? {
            tickets: m.tickets,
            units: m.units,
            revenue: m.revenue,
            avgTicket: m.avgTicket,
          }
        : m;
    res.json({
      userId,
      employee: employee
        ? {
            userId: employee.userId,
            employeeName: employee.employeeName,
            ...strip(employee),
            bySaleType: employee.bySaleType.map((row) => ({
              key: row.key,
              ...strip(row),
            })),
            byCustomerCategory: employee.byCustomerCategory.map((row) => ({
              key: row.key,
              ...strip(row),
            })),
            byProductCategory: employee.byProductCategory.map((row) => ({
              key: row.key,
              ...strip(row),
            })),
            byPaymentMethod: employee.byPaymentMethod.map((row) => ({
              key: row.key,
              ...strip(row),
            })),
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.get(
  "/reports/by-payment",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = reportQuerySchema.parse(req.query);
      res.json(salesByPaymentMethodReport(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/reports/employees",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = reportQuerySchema.parse(req.query);
      res.json(employeeProductivityReport(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/reports/customers",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = reportQuerySchema.parse(req.query);
      res.json(customerSalesReport(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.post("/cash-cuts/open", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const body = openCashCutSchema.parse(req.body);
    if (req.user.role === UserRole.Empleado) body.storeId = req.user.storeId;
    res.status(201).json(openCashCut(getDb(), req.user.id, body));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/cash-cuts/current", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const requestedUser = req.query.userId as string | undefined;
    const requestedStore = req.query.storeId as string | undefined;
    // Por cuenta: empleado siempre ve el suyo; admin puede pedir otro userId.
    const userId =
      req.user.role === UserRole.Admin && requestedUser
        ? requestedUser
        : req.user.id;
    // Sucursal: empleado anclado a la suya; admin filtra solo si la pide.
    const storeId =
      req.user.role === UserRole.Empleado
        ? req.user.storeId
        : requestedStore || undefined;
    const db = getDb();
    const cut = getOpenCashCut(db, storeId, userId);
    res.json(cut ? previewCashCut(db, cut.id) : { cut: null });
  } catch (err) {
    next(err);
  }
});

apiRouter.post(
  "/cash-cuts/:id/movements",
  requireAuth,
  (req: AuthedRequest, res, next) => {
    try {
      if (!req.user) throw new AppError("No autenticado", 401);
      const body = cashMovementSchema.parse(req.body);
      res
        .status(201)
        .json(
          addCashMovement(
            getDb(),
            param(req.params.id),
            req.user.id,
            body,
            req.user.role,
          ),
        );
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/cash-cuts/:id/preview",
  requireAuth,
  (req: AuthedRequest, res, next) => {
    try {
      if (!req.user) throw new AppError("No autenticado", 401);
      const db = getDb();
      assertCashCutAccess(db, param(req.params.id), req.user);
      res.json(previewCashCut(db, param(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.post(
  "/cash-cuts/:id/close",
  requireAuth,
  (req: AuthedRequest, res, next) => {
    try {
      if (!req.user) throw new AppError("No autenticado", 401);
      const body = closeCashCutSchema.parse(req.body);
      res.json(
        closeCashCut(
          getDb(),
          param(req.params.id),
          req.user.id,
          body,
          req.user.role,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get("/cash-cuts", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const query = z
      .object({
        storeId: z.string().optional(),
        userId: z.string().optional(),
        status: z.enum(["Abierto", "Cerrado"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    res.json(listCashCuts(getDb(), query, req.user));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/cash-cuts/:id", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const db = getDb();
    assertCashCutAccess(db, param(req.params.id), req.user);
    res.json(getCashCutDetail(db, param(req.params.id)));
  } catch (err) {
    next(err);
  }
});

apiRouter.post(
  "/inventory/adjust",
  requireAuth,
  requireRole(UserRole.Admin),
  (req: AuthedRequest, res, next) => {
    try {
      if (!req.user) throw new AppError("No autenticado", 401);
      const body = adjustStockSchema.parse(req.body);
      res.status(201).json(adjustStock(getDb(), req.user.id, body));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/inventory/adjustments",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const query = z
        .object({
          productId: z.string().optional(),
          storeId: z.string().optional(),
          userId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(1000).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        })
        .parse(req.query);
      res.json(listInventoryAdjustments(getDb(), query));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get("/reports/inventory", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.user) throw new AppError("No autenticado", 401);
    const requested = (req.query.storeId as string | undefined) || undefined;
    if (req.user.role === UserRole.Empleado) {
      res.json(inventorySummary(getDb(), req.user.storeId));
      return;
    }
    // Admin: sin storeId = todas las sucursales; con storeId = solo esa.
    res.json(inventorySummary(getDb(), requested));
  } catch (err) {
    next(err);
  }
});

apiRouter.get(
  "/reports/stock-alerts",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const storeId = (req.query.storeId as string | undefined) || undefined;
      res.json(stockAlerts(getDb(), storeId));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get(
  "/reports/profit",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      res.json(
        profitSummary(getDb(), {
          storeId: (req.query.storeId as string | undefined) || undefined,
          userId: (req.query.userId as string | undefined) || undefined,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.post(
  "/sync/export-catalog",
  requireAuth,
  requireRole(UserRole.Admin),
  (req: AuthedRequest, res) => {
    const file = exportCatalog(getDb(), req.user?.storeId);
    res.json({ file });
  },
);

apiRouter.post(
  "/sync/import-catalog",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const { filePath } = z.object({ filePath: z.string().min(1) }).parse(req.body);
      res.json(importCatalog(getDb(), filePath));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.post(
  "/sync/export-report",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = z
        .object({
          storeId: z.string(),
          from: z.string(),
          to: z.string(),
        })
        .parse(req.body);
      const file = exportStoreReport(getDb(), body.storeId, body.from, body.to);
      res.json({ file });
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.post(
  "/sync/consolidate",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = z
        .object({ filePaths: z.array(z.string()).min(1).max(3) })
        .parse(req.body);
      res.json(consolidateReports(body.filePaths));
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.get("/config", requireAuth, (_req, res) => {
  res.json({
    dataDir: config.dataDir,
    exportsDir: config.exportsDir,
    printMode: config.printMode,
    dbPath: config.dbPath,
    hqEmail: hqEmailSettings().to,
    mailConfigured: mailSettings() !== null,
    whatsappConfigured: whatsappSettings() !== null,
  });
});
