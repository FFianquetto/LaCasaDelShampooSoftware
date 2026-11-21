import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  Customer,
  CustomerCategory,
  PaymentMethod,
  Product,
  SaleType,
  Store,
} from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } from "@lcds/shared";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { money, qs, shortStore } from "../util";

type Preview = {
  lines: {
    lotId: string;
    productId: string;
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

type Channel = "email" | "whatsapp" | "none";

type CommitResult = {
  sale: { folio: string; total: number };
  ticketText: string;
  emailed: boolean;
  email: string;
  channel: Channel;
  destination: string;
  delivered: boolean;
  whatsappUrl?: string;
  hqNotified?: boolean;
};

type RecentTicket = {
  folio: string;
  createdAt: string;
  total: number;
  email: string | null;
  emailed: boolean;
  phone: string | null;
  channel: Channel;
  delivered: boolean;
  storeName: string;
  ticketText: string;
};

type CatalogRow = Product & { disponible: number; price: number | null };

type Overrides = {
  category?: CustomerCategory;
  saleType?: SaleType;
  customerId?: string;
};

const CATEGORIES = Object.keys(CUSTOMER_CATEGORY_LABELS) as CustomerCategory[];
const PAYMENTS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

function productCode(row: Product): string | null {
  return row.code ?? row.barcode ?? null;
}

export function TicketPage() {
  const { isAdmin, store } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(store?.id ?? "");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [saleType, setSaleType] = useState<SaleType>("Menudeo");
  const [payment, setPayment] = useState<PaymentMethod>("Efectivo");
  const [barcode, setBarcode] = useState("");
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [scanSealed, setScanSealed] = useState(false);
  const fromScanner = useRef(false);
  const barcodeRef = useRef("");
  const lastKeyAt = useRef(0);
  const sealTimer = useRef<number | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerText, setCustomerText] = useState("");

  const [channel, setChannel] = useState<"email" | "whatsapp" | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notifyHq, setNotifyHq] = useState(false);
  const [hqRequested, setHqRequested] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ticket, setTicket] = useState<CommitResult | null>(null);
  const [recent, setRecent] = useState<RecentTicket[]>([]);
  const [openFolio, setOpenFolio] = useState<string | null>(null);
  const openTicketRef = useRef<HTMLPreElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"scan" | "send" | null>(null);

  // Buscador de productos
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [pickerRows, setPickerRows] = useState<CatalogRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerMsg, setPickerMsg] = useState<string | null>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneDigits = phone.replace(/\D/g, "");
  const phoneOk = phoneDigits.length >= 10 && phoneDigits.length <= 15;
  const deliveryOk =
    channel === "email" ? emailOk : channel === "whatsapp" ? phoneOk : false;

  const activeStoreId = isAdmin ? storeId : (store?.id ?? "");

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
    let cancelled = false;
    void api<Customer[]>(`/customers?${qs({ storeId: activeStoreId })}`)
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStoreId]);

  useEffect(() => {
    if (!activeStoreId) {
      setRecent([]);
      return;
    }
    void api<RecentTicket[]>(`/sales/recent?storeId=${activeStoreId}`)
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [activeStoreId, ticket?.sale.folio]);

  useEffect(() => {
    if (!openFolio) return;
    openTicketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openFolio]);

  // Búsqueda en el catálogo (modal).
  useEffect(() => {
    if (!pickerOpen || !activeStoreId) return;
    let cancelled = false;
    setPickerLoading(true);
    const timer = window.setTimeout(() => {
      void api<CatalogRow[]>(
        `/catalog?${qs({ storeId: activeStoreId, q: pickerQ.trim() })}`,
      )
        .then((rows) => {
          if (!cancelled) setPickerRows(rows);
        })
        .catch(() => {
          if (!cancelled) setPickerRows([]);
        })
        .finally(() => {
          if (!cancelled) setPickerLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pickerOpen, pickerQ, activeStoreId, ticket?.sale.folio]);

  async function quote(next: string[], overrides?: Overrides) {
    if (!activeStoreId) throw new ApiError("Elige la sucursal", 400);
    if (next.length === 0) {
      setPreview(null);
      return;
    }
    const customerId =
      overrides?.customerId !== undefined ? overrides.customerId : customer?.id;
    const data = await api<Preview>("/sales/preview", {
      method: "POST",
      body: JSON.stringify({
        storeId: activeStoreId,
        customerId: customerId || undefined,
        customerCategory: overrides?.category ?? category,
        saleType: overrides?.saleType ?? saleType,
        paymentMethod: payment,
        barcodes: next,
      }),
    });
    setPreview(data);
  }

  function releaseScan(clear: boolean) {
    fromScanner.current = false;
    if (sealTimer.current != null) window.clearTimeout(sealTimer.current);
    sealTimer.current = null;
    setScanSealed(false);
    if (clear) {
      barcodeRef.current = "";
      setBarcode("");
    }
  }

  function onScanKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((scanSealed || busy === "scan") && event.key !== "Enter") {
      event.preventDefault();
      return;
    }
    if (
      fromScanner.current &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      event.preventDefault();
      return;
    }
    const now = performance.now();
    const gap = now - lastKeyAt.current;
    lastKeyAt.current = now;
    if (event.key.length === 1 && barcodeRef.current.length > 0 && gap < 40) {
      fromScanner.current = true;
    }
    if (fromScanner.current && event.key !== "Enter") {
      if (sealTimer.current != null) window.clearTimeout(sealTimer.current);
      sealTimer.current = window.setTimeout(() => setScanSealed(true), 120);
    }
  }

  function onScanChange(value: string) {
    if (scanSealed || busy === "scan") return;
    if (
      fromScanner.current &&
      !(value.startsWith(barcodeRef.current) && value.length >= barcodeRef.current.length)
    ) {
      return;
    }
    barcodeRef.current = value;
    setBarcode(value);
  }

  async function addBarcode(event: FormEvent) {
    event.preventDefault();
    const code = barcode.trim();
    const scanned = fromScanner.current || scanSealed;
    if (!code || busy) return;
    setError(null);
    setTicket(null);
    const next = [...barcodes, code];
    setBusy("scan");
    setScanSealed(true);
    try {
      await quote(next);
      setBarcodes(next);
      releaseScan(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo escanear");
      if (scanned) releaseScan(true);
      else setScanSealed(false);
    } finally {
      setBusy(null);
    }
  }

  /** Agrega un producto elegido en el buscador (mismo flujo que escanear). */
  async function addFromPicker(row: CatalogRow) {
    const code = productCode(row);
    if (!code || busy) return;
    const inTicket = (preview?.lines ?? []).filter(
      (line) => line.productId === row.id,
    ).length;
    if (row.disponible <= 0) {
      setPickerMsg(`Sin stock de ${row.name}.`);
      return;
    }
    if (inTicket >= row.disponible) {
      setPickerMsg(
        `Ya agregaste todo el stock disponible de ${row.name} (${row.disponible}).`,
      );
      return;
    }
    setError(null);
    setTicket(null);
    setPickerMsg(null);
    const next = [...barcodes, code];
    setBusy("scan");
    try {
      await quote(next);
      setBarcodes(next);
      setPickerMsg(`Agregado: ${row.name}`);
    } catch (err) {
      setPickerMsg(err instanceof ApiError ? err.message : "No se pudo agregar");
    } finally {
      setBusy(null);
    }
  }

  async function refresh(next: string[], overrides?: Overrides) {
    setError(null);
    try {
      await quote(next, overrides);
      setBarcodes(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar");
    }
  }

  /** Cambia tipo/categoría y recalcula precios; solo aplica si el cálculo funciona. */
  async function changePricing(overrides: Overrides) {
    setError(null);
    if (barcodes.length > 0) {
      try {
        await quote(barcodes, overrides);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo actualizar precios");
        return;
      }
    }
    if (overrides.category) setCategory(overrides.category);
    if (overrides.saleType) setSaleType(overrides.saleType);
  }

  function customerLabel(item: Customer) {
    return `${item.clientNumber ?? "S/N"} — ${item.name} (${CUSTOMER_CATEGORY_LABELS[item.category]})`;
  }

  async function selectCustomer(text: string) {
    setCustomerText(text);
    const found = customers.find((item) => customerLabel(item) === text);
    if (!found) return;
    setError(null);
    if (barcodes.length > 0) {
      try {
        await quote(barcodes, { customerId: found.id, category: found.category });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo actualizar precios");
        setCustomerText(customer ? customerLabel(customer) : "");
        return;
      }
    }
    setCustomer(found);
    setCategory(found.category);
    if (found.email) setEmail(found.email);
    if (found.phone) setPhone(found.phone);
  }

  async function clearCustomer() {
    setCustomerText("");
    if (!customer) return;
    setError(null);
    if (barcodes.length > 0) {
      try {
        await quote(barcodes, { customerId: "", category: "Publico" });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo actualizar precios");
        setCustomerText(customerLabel(customer));
        return;
      }
    }
    setCustomer(null);
    setCategory("Publico");
  }

  async function closeSale(deliveryChannel: Channel) {
    if (!preview || barcodes.length === 0 || busy) return;
    if (deliveryChannel === "email" && !emailOk) return;
    if (deliveryChannel === "whatsapp" && !phoneOk) return;
    setBusy("send");
    setError(null);
    try {
      const result = await api<CommitResult>("/sales/commit", {
        method: "POST",
        body: JSON.stringify({
          storeId: activeStoreId,
          customerId: customer?.id,
          customerCategory: category,
          saleType,
          paymentMethod: payment,
          barcodes,
          deliveryChannel,
          email: deliveryChannel === "email" ? email.trim() : undefined,
          phone: deliveryChannel === "whatsapp" ? phone.trim() : undefined,
          notifyHq: notifyHq || undefined,
        }),
      });
      setTicket(result);
      setHqRequested(notifyHq);
      setBarcodes([]);
      setPreview(null);
      setChannel(null);
      setNotifyHq(false);
      setCustomer(null);
      setCustomerText("");
      setCategory("Publico");
      setEmail("");
      setPhone("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : deliveryChannel === "none"
            ? "No se pudo cerrar la venta"
            : "La venta no se cerró porque no se envió el ticket",
      );
    } finally {
      setBusy(null);
    }
  }

  async function openWhatsapp(url: string) {
    try {
      if (import.meta.env.TAURI_ENV_PLATFORM) {
        await openExternal(url);
      } else {
        window.open(url, "_blank");
      }
    } catch {
      window.open(url, "_blank");
    }
  }

  function resultMessage(result: CommitResult): string {
    const total = money(result.sale.total);
    if (result.channel === "whatsapp") {
      return result.delivered
        ? `Recibo enviado por WhatsApp a ${result.destination}. Total ${total}.`
        : `Venta cerrada. Abre WhatsApp para enviar el ticket a ${result.destination}. Total ${total}.`;
    }
    if (result.channel === "email") {
      return result.emailed
        ? `Recibo enviado a ${result.destination}. Total ${total}.`
        : `La venta quedó cerrada, pero el recibo no se envió a ${result.destination}. Total ${total}.`;
    }
    return `Venta cerrada sin enviar ticket. Total ${total}.`;
  }

  const pickerVisible = pickerRows.slice(0, 60);

  return (
    <div>
      <h1 className="page-title">Ticket</h1>
      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        {isAdmin && (
          <div className="store-buttons" style={{ marginBottom: "0.85rem", marginLeft: 0 }}>
            {stores.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === storeId ? "btn" : "btn secondary"}
                onClick={() => {
                  setStoreId(item.id);
                  setBarcodes([]);
                  setPreview(null);
                  setCustomer(null);
                  setCustomerText("");
                  setCategory("Publico");
                }}
              >
                {shortStore(item.name)}
              </button>
            ))}
          </div>
        )}
        <form className="form-inline" onSubmit={addBarcode}>
          <div className="form-row" style={{ marginBottom: 0, flex: 1.4 }}>
            <label>Escaneo</label>
            <input
              value={barcode}
              autoFocus
              readOnly={scanSealed || busy === "scan"}
              placeholder="ID del producto, ej. P0004"
              onKeyDown={onScanKeyDown}
              onChange={(event) => onScanChange(event.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text").trim();
                if (text.length < 3 || scanSealed || busy === "scan") return;
                event.preventDefault();
                fromScanner.current = true;
                barcodeRef.current = text;
                setBarcode(text);
                setScanSealed(true);
              }}
            />
          </div>
          <button className="btn" type="submit" disabled={busy !== null || !barcode.trim()}>
            {busy === "scan" ? "Buscando…" : "Agregar"}
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={!activeStoreId}
            onClick={() => {
              setPickerMsg(null);
              setPickerOpen(true);
            }}
          >
            Buscar producto
          </button>
        </form>

        <div className="form-inline" style={{ marginTop: "0.85rem" }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Tipo de venta</label>
            <div className="store-buttons" style={{ marginLeft: 0 }}>
              {(["Menudeo", "Mayoreo"] as SaleType[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={saleType === item ? "btn" : "btn secondary"}
                  onClick={() => void changePricing({ saleType: item })}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>
              Categoría de precio
              {customer ? " (según el cliente)" : ""}
            </label>
            <div className="store-buttons" style={{ marginLeft: 0 }}>
              {CATEGORIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={customer !== null}
                  className={category === item ? "btn" : "btn secondary"}
                  onClick={() => void changePricing({ category: item })}
                >
                  {CUSTOMER_CATEGORY_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Pago</label>
            <select
              value={payment}
              onChange={(event) => setPayment(event.target.value as PaymentMethod)}
            >
              {PAYMENTS.map((key) => (
                <option key={key} value={key}>
                  {PAYMENT_METHOD_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-inline" style={{ marginTop: "0.85rem" }}>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Cliente (opcional)</label>
            <input
              list="ticket-customers"
              value={customerText}
              placeholder="Público general — escribe número o nombre para elegir un cliente"
              onChange={(event) => void selectCustomer(event.target.value)}
            />
            <datalist id="ticket-customers">
              {customers.map((item) => (
                <option key={item.id} value={customerLabel(item)} />
              ))}
            </datalist>
          </div>
          <button
            className="btn secondary"
            type="button"
            disabled={!customer && !customerText}
            onClick={() => void clearCustomer()}
          >
            Quitar cliente
          </button>
        </div>
        {customer && (
          <p className="page-sub" style={{ margin: "0.6rem 0 0" }}>
            Cliente: <strong>{customer.name}</strong> ·{" "}
            {CUSTOMER_CATEGORY_LABELS[customer.category]}
          </p>
        )}
      </div>

      <div className="panel table-wrap" style={{ marginBottom: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Código</th>
              <th>Precio</th>
              <th>Descuento</th>
              <th>A cobrar</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(preview?.lines ?? []).map((line, index) => (
              <tr key={`${line.lotId}-${index}`}>
                <td>{line.productName}</td>
                <td>{line.barcode}</td>
                <td>{money(line.unitPrice)}</td>
                <td>{line.discount > 0 ? `-${money(line.discount)}` : "$0.00"}</td>
                <td>{money(line.finalPrice)}</td>
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
                <td colSpan={6}>
                  Escanea o busca un producto disponible para armar el ticket.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {preview && (
          <p className="report-total">
            Subtotal {money(preview.subtotal)} · Descuento {money(preview.discountTotal)} ·
            Total {money(preview.total)}
          </p>
        )}

        <div style={{ marginTop: "0.85rem" }}>
          <label className="check-row">
            <input
              type="checkbox"
              checked={notifyHq}
              onChange={(event) => setNotifyHq(event.target.checked)}
            />
            Avisar a La Casa del Shampoo (copia de esta venta a oficina)
          </label>
          <div className="form-inline">
            <button
              className="btn"
              type="button"
              disabled={!preview || busy !== null}
              onClick={() => void closeSale("none")}
            >
              {busy === "send" && channel === null ? "Cerrando…" : "Cerrar venta"}
            </button>
            {!channel && (
              <>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!preview || busy !== null}
                  onClick={() => setChannel("email")}
                >
                  Enviar por correo
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!preview || busy !== null}
                  onClick={() => setChannel("whatsapp")}
                >
                  Enviar por WhatsApp
                </button>
              </>
            )}
          </div>
        </div>

        {channel === "email" && (
          <>
            <div className="form-row" style={{ marginTop: "0.85rem" }}>
              <label>Correo del cliente</label>
              <input
                type="email"
                value={email}
                placeholder="correo del cliente"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="form-inline">
              <button
                className="btn"
                type="button"
                disabled={!preview || busy !== null || !deliveryOk}
                onClick={() => void closeSale("email")}
              >
                {busy === "send" ? "Enviando…" : "Enviar ticket por correo y cerrar venta"}
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy !== null}
                onClick={() => setChannel(null)}
              >
                Regresar
              </button>
            </div>
          </>
        )}
        {channel === "whatsapp" && (
          <>
            <div className="form-row" style={{ marginTop: "0.85rem" }}>
              <label>WhatsApp del cliente</label>
              <input
                type="tel"
                value={phone}
                placeholder="10 dígitos"
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="form-inline">
              <button
                className="btn"
                type="button"
                disabled={!preview || busy !== null || !deliveryOk}
                onClick={() => void closeSale("whatsapp")}
              >
                {busy === "send" ? "Enviando…" : "Enviar ticket por WhatsApp y cerrar venta"}
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy !== null}
                onClick={() => setChannel(null)}
              >
                Regresar
              </button>
            </div>
          </>
        )}
      </div>

      {ticket && (
        <div className="panel">
          <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
            Venta {ticket.sale.folio}
          </h2>
          <p className="page-sub">
            {resultMessage(ticket)}
            {ticket.hqNotified === true && " Oficina avisada."}
            {ticket.hqNotified !== true &&
              hqRequested &&
              " No se pudo avisar a oficina (la venta sí quedó cerrada)."}
          </p>
          {ticket.channel === "whatsapp" && ticket.whatsappUrl && (
            <p style={{ margin: "0 0 0.75rem" }}>
              <button
                className="btn"
                type="button"
                onClick={() => void openWhatsapp(ticket.whatsappUrl!)}
              >
                Abrir WhatsApp
              </button>
            </p>
          )}
          <pre className="ticket-preview">{ticket.ticketText}</pre>
        </div>
      )}

      <div className="panel" style={{ marginTop: "1rem" }}>
        <div className="form-inline" style={{ alignItems: "center" }}>
          <h2 className="page-title" style={{ fontSize: "1.2rem", flex: 1, margin: 0 }}>
            Últimos 5 tickets
          </h2>
          <Link className="btn secondary" to="/historial">
            Ver historial completo
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="page-sub" style={{ marginTop: "0.75rem" }}>
            Esta sucursal todavía no tiene tickets cerrados.
          </p>
        ) : (
          recent.map((item) => (
            <div key={item.folio} style={{ marginTop: "0.75rem" }}>
              <div className="form-inline">
                <div style={{ flex: 1 }}>
                  <strong>{item.folio}</strong>
                  <p className="page-sub" style={{ margin: "0.15rem 0 0" }}>
                    {new Date(item.createdAt).toLocaleString("es-MX")} · {money(item.total)} ·{" "}
                    {item.channel === "whatsapp"
                      ? `WhatsApp ${item.phone ?? ""}${item.delivered ? " · enviado" : " · pendiente en WhatsApp"}`
                      : item.channel === "none"
                        ? "Sin envío de ticket"
                        : `${item.email ?? "Sin correo"}${item.email ? (item.emailed ? " · enviado" : " · no salió por correo") : ""}`}
                  </p>
                </div>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() =>
                    setOpenFolio((current) => (current === item.folio ? null : item.folio))
                  }
                >
                  {openFolio === item.folio ? "Ocultar" : "Ver"}
                </button>
              </div>
              {openFolio === item.folio && (
                <pre ref={openTicketRef} className="ticket-preview">
                  {item.ticketText}
                </pre>
              )}
            </div>
          ))
        )}
      </div>

      {pickerOpen && (
        <div className="modal-back" onClick={() => setPickerOpen(false)}>
          <div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              Buscar producto
            </h2>
            <p className="page-sub">
              Stock de la sucursal activa. Elige un producto para agregarlo al ticket.
            </p>
            {pickerMsg && <div className="notice">{pickerMsg}</div>}
            <div className="form-row">
              <input
                autoFocus
                value={pickerQ}
                placeholder="Código, nombre o marca"
                onChange={(event) => setPickerQ(event.target.value)}
              />
            </div>
            <div className="table-wrap" style={{ maxHeight: "50vh" }}>
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Producto</th>
                    <th>Marca</th>
                    <th>Disponibles</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pickerVisible.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        {pickerLoading ? "Buscando…" : "Sin productos."}
                      </td>
                    </tr>
                  ) : (
                    pickerVisible.map((row) => {
                      const inTicket = (preview?.lines ?? []).filter(
                        (line) => line.productId === row.id,
                      ).length;
                      const left = row.disponible - inTicket;
                      return (
                        <tr key={row.id}>
                          <td>{productCode(row) ?? "—"}</td>
                          <td>{row.name}</td>
                          <td>{row.brand ?? "—"}</td>
                          <td>
                            <span className={row.disponible > 0 ? "stock-ok" : "stock-out"}>
                              {row.disponible}
                            </span>
                            {inTicket > 0 && (
                              <span className="cell-note"> · {inTicket} en ticket</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn"
                              type="button"
                              style={{ padding: "0.3rem 0.7rem" }}
                              disabled={
                                busy !== null || left <= 0 || productCode(row) == null
                              }
                              onClick={() => void addFromPicker(row)}
                            >
                              Agregar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {pickerRows.length > pickerVisible.length && (
              <p className="page-sub" style={{ margin: "0.6rem 0 0" }}>
                Mostrando {pickerVisible.length} de {pickerRows.length}. Escribe para filtrar.
              </p>
            )}
            <button
              className="btn secondary"
              type="button"
              style={{ width: "100%", marginTop: "1rem" }}
              onClick={() => setPickerOpen(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}