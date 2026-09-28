import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { TicketPage } from "./pages/TicketPage";
import { CustomersPage } from "./pages/CustomersPage";
import { PricesPage } from "./pages/PricesPage";
import { UsersPage } from "./pages/UsersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SyncPage } from "./pages/SyncPage";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, store, logout, isAdmin } = useAuth();
  const storeLabel = store?.name.replace("La Casa del Shampoo — ", "");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          La Casa del Shampoo
          {!isAdmin && storeLabel && <small>{storeLabel}</small>}
        </div>
        <nav className="nav">
          {isAdmin ? (
            <>
              <NavLink to="/pos">Inventario</NavLink>
              <NavLink to="/ticket">Ticket</NavLink>
              <NavLink to="/clientes">Clientes</NavLink>
              <NavLink to="/precios">Precios</NavLink>
              <NavLink to="/empleados">Empleados</NavLink>
              <NavLink to="/sync">Sync multi-tienda</NavLink>
              <NavLink to="/reportes">Reportes</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/ticket">Ticket</NavLink>
              <NavLink to="/pos">Inventario</NavLink>
              <NavLink to="/clientes">Clientes</NavLink>
            </>
          )}
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
  if (!isAdmin) return <Navigate to="/ticket" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { session, isAdmin } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={isAdmin ? "/pos" : "/ticket"} replace />;
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
            <PosPage />
          </Private>
        }
      />
      <Route
        path="/ticket"
        element={
          <Private>
            <TicketPage />
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
      <Route path="/productos" element={<Navigate to="/pos" replace />} />
      <Route path="/promociones" element={<Navigate to="/precios" replace />} />
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
            <AdminOnly>
              <ReportsPage />
            </AdminOnly>
          </Private>
        }
      />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
