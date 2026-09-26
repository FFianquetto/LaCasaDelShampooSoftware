import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { InventoryPage } from "./pages/InventoryPage";
import { ProductsPage } from "./pages/ProductsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { PricesPage } from "./pages/PricesPage";
import { UsersPage } from "./pages/UsersPage";
import { PromotionsPage } from "./pages/PromotionsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SyncPage } from "./pages/SyncPage";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, store, logout, isAdmin } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          La Casa del Shampoo
          <small>POS · {store?.code}</small>
        </div>
        <nav className="nav">
          <NavLink to="/pos">Punto de venta</NavLink>
          <NavLink to="/inventario">Inventario</NavLink>
          <NavLink to="/clientes">Clientes</NavLink>
          {isAdmin && (
            <>
              <NavLink to="/productos">Productos</NavLink>
              <NavLink to="/precios">Precios</NavLink>
              <NavLink to="/promociones">Promociones</NavLink>
              <NavLink to="/empleados">Empleados</NavLink>
              <NavLink to="/sync">Sync multi-tienda</NavLink>
            </>
          )}
          <NavLink to="/reportes">Reportes</NavLink>
        </nav>
        <div className="sidebar-footer">
          <div>
            {user?.fullName}
            <br />
            <span style={{ opacity: 0.75 }}>{user?.role}</span>
          </div>
          <button
            className="btn secondary"
            style={{ marginTop: "0.75rem", width: "100%", color: "#fff", borderColor: "rgba(255,255,255,.25)" }}
            onClick={() => void logout()}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function Private({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/pos" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/pos"
        element={
          <Private>
            <PosPage />
          </Private>
        }
      />
      <Route
        path="/inventario"
        element={
          <Private>
            <InventoryPage />
          </Private>
        }
      />
      <Route
        path="/clientes"
        element={
          <Private>
            <CustomersPage />
          </Private>
        }
      />
      <Route
        path="/productos"
        element={
          <Private>
            <AdminOnly>
              <ProductsPage />
            </AdminOnly>
          </Private>
        }
      />
      <Route
        path="/precios"
        element={
          <Private>
            <AdminOnly>
              <PricesPage />
            </AdminOnly>
          </Private>
        }
      />
      <Route
        path="/promociones"
        element={
          <Private>
            <AdminOnly>
              <PromotionsPage />
            </AdminOnly>
          </Private>
        }
      />
      <Route
        path="/empleados"
        element={
          <Private>
            <AdminOnly>
              <UsersPage />
            </AdminOnly>
          </Private>
        }
      />
      <Route
        path="/sync"
        element={
          <Private>
            <AdminOnly>
              <SyncPage />
            </AdminOnly>
          </Private>
        }
      />
      <Route
        path="/reportes"
        element={
          <Private>
            <ReportsPage />
          </Private>
        }
      />
      <Route path="*" element={<Navigate to="/pos" replace />} />
    </Routes>
  );
}
