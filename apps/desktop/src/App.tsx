import { useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { ConfirmModal } from "./components/ConfirmModal";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { TicketPage } from "./pages/TicketPage";
import { CustomersPage } from "./pages/CustomersPage";
import { PricesPage } from "./pages/PricesPage";
import { UsersPage } from "./pages/UsersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { CashCutPage } from "./pages/CashCutPage";
import { SalesHistoryPage } from "./pages/SalesHistoryPage";
import { StockAlertModal } from "./StockAlertModal";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, store, logout, isAdmin } = useAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const storeLabel = store?.name.replace("La Casa del Shampoo — ", "");

  async function confirmLogout() {
    setLogoutBusy(true);
    try {
      await logout();
    } finally {
      setLogoutBusy(false);
      setLogoutOpen(false);
    }
  }

  return (
    <div className="app-shell">
      {isAdmin && <StockAlertModal />}
      <aside className="sidebar">
        <div className="brand">
          La Casa del Shampoo
          {!isAdmin && storeLabel && (
            <small>{storeLabel}</small>
          )}
        </div>
        <nav className="nav">
          {isAdmin ? (
            <>
              <NavLink to="/pos">Inventario</NavLink>
              <NavLink to="/precios">Precios</NavLink>
              <NavLink to="/clientes">Clientes</NavLink>
              <NavLink to="/historial">Historial</NavLink>
              <NavLink to="/reportes">Reportes</NavLink>
              <NavLink to="/ticket">Ticket</NavLink>
              <NavLink to="/empleados">Cuentas / empleados</NavLink>
              <span className="nav-disabled" title="Inhabilitado por ahora">
                Sync multi-tienda
              </span>
            </>
          ) : (
            <>
              <NavLink to="/corte">Corte de caja</NavLink>
              <NavLink to="/ticket">Ticket</NavLink>
              <NavLink to="/pos">Inventario</NavLink>
              <NavLink to="/clientes">Clientes</NavLink>
              <NavLink to="/historial">Historial</NavLink>
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
            onClick={() => setLogoutOpen(true)}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
      <ConfirmModal
        open={logoutOpen}
        title="Cerrar sesión"
        message="¿Seguro que quieres salir? Tendrás que volver a iniciar sesión para continuar."
        confirmLabel="Salir"
        cancelLabel="Seguir aquí"
        busy={logoutBusy}
        danger
        onConfirm={() => void confirmLogout()}
        onCancel={() => {
          if (logoutBusy) return;
          setLogoutOpen(false);
        }}
      />
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
  if (!isAdmin) return <Navigate to="/corte" replace />;
  return <>{children}</>;
}

/** Corte de caja es solo para empleados; el admin usa Historial / Reportes. */
function EmployeeOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (isAdmin) return <Navigate to="/historial" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { session, isAdmin } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={isAdmin ? "/pos" : "/corte"} replace />;
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
      <Route
        path="/corte"
        element={
          <Private>
            <EmployeeOnly>
              <CashCutPage />
            </EmployeeOnly>
          </Private>
        }
      />
      <Route
        path="/historial"
        element={
          <Private>
            <SalesHistoryPage />
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
              <div>
                <h1 className="page-title">Sync multi-tienda</h1>
                <p className="page-sub">Esta sección está inhabilitada por ahora.</p>
              </div>
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
