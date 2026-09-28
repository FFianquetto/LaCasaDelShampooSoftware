import { FormEvent, useEffect, useState } from "react";
import type {
  Customer,
  CustomerCategory,
  PaymentMethod,
  SaleType,
  Store,
} from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

type Preview = {
  lines: {
    lotId: string;
    barcode: string;
    productName: string;
    unitPrice: number;
    discount: number;
    finalPrice: number;
    promotionName: string | null;
  }[];
  subtotal: number;
  discountTotal: number;
  total: number;
};

type CommitResult = {
  sale: { folio: string; total: number };
  ticketText: string;
};

export function TicketPage() {
  const { isAdmin, store } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(store?.id ?? "");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [saleType, setSaleType] = useState<SaleType>("Menudeo");
  const [payment, setPayment] = useState<PaymentMethod>("Efectivo");
  const [barcode, setBarcode] = useState("");
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ticket, setTicket] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"scan" | "print" | null>(null);

  const activeStoreId = isAdmin ? storeId : store?.id ?? "";

  useEffect(() => {
    if (isAdmin) {
      void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!activeStoreId) {
      setCustomers([]);
      return;
    }
    void api<Customer[]>(`/customers?storeId=${activeStoreId}`)
      .then((rows) => setCustomers(rows.filter((row) => row.active)))
      .catch(() => setCustomers([]));
  }, [activeStoreId]);

  async function quote(
    next: string[],
    overrides?: { category?: CustomerCategory; saleType?: SaleType },
  ) {
    if (!activeStoreId) throw new ApiError("Elige la sucursal", 400);
    if (next.length === 0) {
      setPreview(null);
      return;
    }
    const data = await api<Preview>("/sales/preview", {
      method: "POST",
      body: JSON.stringify({
        storeId: activeStoreId,
        customerId: customerId || null,
        customerCategory: overrides?.category ?? category,
        saleType: overrides?.saleType ?? saleType,
        paymentMethod: payment,
        barcodes: next,
      }),
    });
    setPreview(data);
  }

  async function addBarcode(event: FormEvent) {
    event.preventDefault();
    const code = barcode.trim();
    if (!code || busy) return;
    setError(null);
    setTicket(null);
    const next = [...barcodes, code];
    setBusy("scan");
    try {
      await quote(next);
      setBarcodes(next);
      setBarcode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo escanear");
    } finally {
      setBusy(null);
    }
  }

  async function refresh(
    next: string[],
    overrides?: { category?: CustomerCategory; saleType?: SaleType },
  ) {
    setError(null);
    try {
      await quote(next, overrides);
      setBarcodes(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar");
    }
  }

  async function closeSale() {
    if (!preview || barcodes.length === 0 || busy) return;
    setBusy("print");
    setError(null);
    try {
      const result = await api<CommitResult>("/sales/commit", {
        method: "POST",
        body: JSON.stringify({
          storeId: activeStoreId,
          customerId: customerId || null,
          customerCategory: category,
          saleType,
          paymentMethod: payment,
          barcodes,
          printTicket: true,
        }),
      });
      setTicket(result);
      setBarcodes([]);
      setPreview(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "La venta no se cerró porque no se imprimió el ticket",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="page-title">Ticket</h1>
      <p className="page-sub">
        Escanea el código, elige menudeo o mayoreo y cierra la venta. El lote pasa
        de Disponible a Vendido solo si el ticket se imprime.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        {isAdmin && (
          <div className="store-buttons" style={{ marginBottom: "0.85rem" }}>
            {stores.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === storeId ? "btn" : "btn secondary"}
                onClick={() => {
                  setStoreId(item.id);
                  setCustomerId("");
                  setBarcodes([]);
                  setPreview(null);
                }}
              >
                {item.name.replace("La Casa del Shampoo — ", "")}
              </button>
            ))}
          </div>
        )}
        <div className="form-inline">
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Categoría</label>
            <select
              value={category}
              onChange={(event) => {
                const value = event.target.value as CustomerCategory;
                setCategory(value);
                if (barcodes.length) void refresh(barcodes, { category: value });
              }}
            >
              {(Object.keys(CUSTOMER_CATEGORY_LABELS) as CustomerCategory[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {CUSTOMER_CATEGORY_LABELS[key]}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Tipo</label>
            <select
              value={saleType}
              onChange={(event) => {
                const value = event.target.value as SaleType;
                setSaleType(value);
                if (barcodes.length) void refresh(barcodes, { saleType: value });
              }}
            >
              <option value="Menudeo">Menudeo</option>
              <option value="Mayoreo">Mayoreo</option>
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Pago</label>
            <select
              value={payment}
              onChange={(event) => setPayment(event.target.value as PaymentMethod)}
            >
              <option value="Efectivo">Efectivo</option>
              <option value="Tarjeta">Tarjeta</option>
              <option value="Transferencia">Transferencia</option>
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Cliente</label>
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Público en general</option>
              {customers
                .filter((item) => item.category === category)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <form className="form-inline" style={{ marginTop: "0.85rem" }} onSubmit={addBarcode}>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Escaneo</label>
            <input
              value={barcode}
              autoFocus
              placeholder="Código de barras del lote"
              onChange={(event) => setBarcode(event.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={busy !== null || !barcode.trim()}>
            {busy === "scan" ? "Buscando…" : "Agregar"}
          </button>
        </form>
      </div>

      <div className="panel table-wrap" style={{ marginBottom: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Código</th>
              <th>Precio</th>
              <th>Promo</th>
              <th>A cobrar</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(preview?.lines ?? []).map((line, index) => (
              <tr key={`${line.lotId}-${index}`}>
                <td>{line.productName}</td>
                <td>{line.barcode}</td>
                <td>${line.unitPrice.toFixed(2)}</td>
                <td>{line.promotionName ?? "—"}</td>
                <td>${line.finalPrice.toFixed(2)}</td>
                <td>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() =>
                      void refresh(barcodes.filter((_, item) => item !== index))
                    }
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            {!preview && (
              <tr>
                <td colSpan={6}>Escanea un lote disponible para armar el ticket.</td>
              </tr>
            )}
          </tbody>
        </table>
        {preview && (
          <p className="report-total">
            Subtotal ${preview.subtotal.toFixed(2)} · Descuento $
            {preview.discountTotal.toFixed(2)} · Total ${preview.total.toFixed(2)}
          </p>
        )}
        <button
          className="btn"
          type="button"
          disabled={!preview || busy !== null}
          onClick={() => void closeSale()}
        >
          {busy === "print" ? "Imprimiendo…" : "Imprimir ticket y cerrar venta"}
        </button>
      </div>

      {ticket && (
        <div className="panel">
          <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
            Venta {ticket.sale.folio}
          </h2>
          <p className="page-sub">Ticket impreso. Total ${ticket.sale.total.toFixed(2)}.</p>
          <pre className="ticket-preview">{ticket.ticketText}</pre>
        </div>
      )}
    </div>
  );
}
