import { FormEvent, useEffect, useState } from "react";
import type { Store, User, UserRole } from "@lcds/shared";
import { api, ApiError } from "../api";

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("Empleado");
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [u, s] = await Promise.all([
      api<User[]>("/users"),
      api<Store[]>("/stores"),
    ]);
    setUsers(u);
    setStores(s);
    if (!storeId && s[0]) setStoreId(s[0].id);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          fullName,
          role,
          storeId,
        }),
      });
      setUsername("");
      setPassword("");
      setFullName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  const storeCode = (id: string) =>
    stores.find((s) => s.id === id)?.code ?? id;

  return (
    <div>
      <h1 className="page-title">Empleados</h1>
      <p className="page-sub">Altas de Admin / Empleado por sucursal.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <form className="form-inline" onSubmit={onCreate}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Usuario</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Nombre</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="Empleado">Empleado</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Sucursal</label>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">
            Crear
          </button>
        </form>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Sucursal</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.fullName}</td>
                <td>{u.role}</td>
                <td>{storeCode(u.storeId)}</td>
                <td>{u.active ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
