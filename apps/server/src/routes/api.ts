import { Router } from "express";
import {
  loginRequestSchema,
  createProductSchema,
  createLotSchema,
  createCustomerSchema,
  upsertPriceSchema,
  createUserSchema,
  createPromotionSchema,
  commitSaleSchema,
  reportQuerySchema,
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
  listLots,
  createLot,
  getLotByBarcode,
  listCustomers,
  createCustomer,
  listPrices,
  upsertPrice,
  listUsers,
  createUser,
  deactivateUser,
  listStores,
  listPromotions,
  createPromotion,
  setPromotionActive,
} from "../services/catalog.js";
import { previewSale, commitSale } from "../services/sales.js";
import {
  salesReport,
  inventorySummary,
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
import { config } from "../config.js";
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
  const requested = req.query.storeId as string | undefined;
  const storeId =
    req.user?.role === UserRole.Empleado ? req.user.storeId : requested || undefined;
  res.json(listCustomers(getDb(), storeId));
});

apiRouter.post("/customers", requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const body = createCustomerSchema.parse(req.body);
    if (req.user?.role === UserRole.Empleado) body.storeId = req.user.storeId;
    res.status(201).json(createCustomer(getDb(), body));
  } catch (err) {
    next(err);
  }
});

apiRouter.get(
  "/prices",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res) => {
    res.json(listPrices(getDb(), req.query.productId as string | undefined));
  },
);

apiRouter.put(
  "/prices",
  requireAuth,
  requireRole(UserRole.Admin),
  (req, res, next) => {
    try {
      const body = upsertPriceSchema.parse(req.body);
      res.json(upsertPrice(getDb(), body));
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

apiRouter.post("/sales/preview", requireAuth, (req, res, next) => {
  try {
    const body = commitSaleSchema.omit({ printTicket: true }).parse(req.body);
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
    const query = reportQuerySchema.parse(req.query);
    const storeId =
      req.user?.role === UserRole.Empleado
        ? req.user.storeId
        : query.storeId;
    res.json(salesReport(getDb(), { ...query, storeId }));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/reports/inventory", requireAuth, (req: AuthedRequest, res) => {
  const storeId =
    (req.query.storeId as string | undefined) ||
    req.user!.storeId;
  if (req.user?.role === UserRole.Empleado && storeId !== req.user.storeId) {
    throw new AppError("Solo su sucursal", 403);
  }
  res.json(inventorySummary(getDb(), storeId));
});

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
  });
});
