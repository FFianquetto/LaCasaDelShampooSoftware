import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  Customer,
  CustomerCategory,
  ResolvedCartLine,
  SaleType,
} from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

type Preview = {
  lines: ResolvedCartLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
};

export function PosPage() {
  const { store, user } = useAuth();
  const scanRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [saleType, setSaleType] = useState<SaleType>("Menudeo");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Customer[]>("/customers").then(setCustomers);
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    const c = customers.find((x) => x.id === customerId);
    if (c) setCategory(c.category);
  }, [customerId, customers]);

  useEffect(() => {
    if (!store || barcodes.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void api<Preview>("/sales/preview", {
      method: "POST",
      body: JSON.stringify({
        storeId: store.id,
        customerId: customerId || null,
        customerCategory: category,
        saleType,
        barcodes,
      }),
    })
      .then((p) => {
        if (!cancelled) {
          setPreview(p);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPreview(null);
          setError(err instanceof ApiError ? err.message : "Error al cotizar");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [barcodes, category, saleType, customerId, store]);

  const lines = useMemo(() => preview?.lines ?? [], [preview]);

  function addBarcode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setSuccess(null);
    setBarcodes((prev) => [...prev, trimmed]);
    setBarcode("");
    scanRef.current?.focus();
  }

  function onScan(e: FormEvent) {
    e.preventDefault();
    addBarcode(barcode);
  }

  function removeAt(index: number) {
    setBarcodes((prev) => prev.filter((_, i) => i !== index));
  }

  async function commit() {
    if (!store || barcodes.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api<{
        sale: { folio: string; total: number };
        ticketText: string;
      }>("/sales/commit", {
        method: "POST",
        body: JSON.stringify({
          storeId: store.id,
          customerId: customerId || null,
          customerCategory: category,
          saleType,
          barcodes,
          printTicket: true,
        }),
      });
      setSuccess(
        `Venta ${result.sale.folio} cerrada. Ticket impreso. Total $${result.sale.total.toFixed(2)}`,
      );
      setBarcodes([]);
      setPreview(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo cerrar la venta",
      );
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }

  return (
    <div>
      <h1 className="page-title">Punto de venta</h1>
      <p className="page-sub">
        {store?.name} · cajero {user?.fullName}. Escanee el código de barras del
        lote (USB HID).
      </p>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="pos-layout">
        <div className="panel">
          <form className="form-inline" onSubmit={onScan}>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label>Escáner / código de barras</label>
              <input
                ref={scanRef}
                className="scan-input"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Escanee y Enter…"
                autoComplete="off"
              />
            </div>
            <button className="btn" type="submit">
              Agregar
            </button>
          </form>

          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Barcode</th>
                  <th>Precio</th>
                  <th>Desc.</th>
                  <th>Final</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={`${line.barcode}-${i}`}>
                    <td>
                      {line.productName}
                      {line.promotionName && (
                        <div>
                          <span className="badge warn">{line.promotionName}</span>
                        </div>
                      )}
                    </td>
                    <td>{line.barcode}</td>
                    <td>${line.unitPrice.toFixed(2)}</td>
                    <td>${line.discount.toFixed(2)}</td>
                    <td>${line.finalPrice.toFixed(2)}</td>
                    <td>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => removeAt(i)}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--muted)" }}>
                      Carrito vacío. Escanee lotes disponibles.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="form-row">
            <label>Cliente</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Mostrador (sin cliente)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {CUSTOMER_CATEGORY_LABELS[c.category]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Categoría precio</label>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as CustomerCategory)
              }
            >
              {(Object.keys(CUSTOMER_CATEGORY_LABELS) as CustomerCategory[]).map(
                (k) => (
                  <option key={k} value={k}>
                    {CUSTOMER_CATEGORY_LABELS[k]}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="form-row">
            <label>Tipo de venta</label>
            <select
              value={saleType}
              onChange={(e) => setSaleType(e.target.value as SaleType)}
            >
              <option value="Menudeo">Menudeo</option>
              <option value="Mayoreo">Mayoreo</option>
            </select>
          </div>

          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Subtotal: ${preview?.subtotal.toFixed(2) ?? "0.00"}
            <br />
            Descuento: ${preview?.discountTotal.toFixed(2) ?? "0.00"}
          </div>
          <div className="cart-total">
            ${preview?.total.toFixed(2) ?? "0.00"}
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            La venta solo se cierra si el ticket se imprime correctamente.
          </p>
          <button
            className="btn accent"
            style={{ width: "100%", marginTop: "0.5rem" }}
            disabled={busy || barcodes.length === 0}
            onClick={() => void commit()}
          >
            {busy ? "Imprimiendo y cerrando…" : "Cobrar e imprimir ticket"}
          </button>
          <button
            className="btn secondary"
            style={{ width: "100%", marginTop: "0.5rem" }}
            onClick={() => {
              setBarcodes([]);
              setPreview(null);
              setError(null);
            }}
          >
            Vaciar carrito
          </button>
        </div>
      </div>
    </div>
  );
}
