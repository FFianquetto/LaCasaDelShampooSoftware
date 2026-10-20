import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import nodemailer from "nodemailer";
import { config, mailSettings, whatsappSettings } from "../config.js";
import { formatTicket, type TicketData } from "./print.js";

export type { TicketData };

function pdfSafe(value: string): string {
  return value.replaceAll("—", "-").replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}

export async function buildTicketPdf(data: TicketData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = 420;
  const height = 640;
  let page = doc.addPage([width, height]);
  let y = height - 40;

  const draw = (value: string, size = 11, strong = false) => {
    const text = pdfSafe(value).slice(0, 70);
    if (y < 48) {
      page = doc.addPage([width, height]);
      y = height - 40;
    }
    page.drawText(text, {
      x: 32,
      y,
      size,
      font: strong ? bold : font,
      color: rgb(0.11, 0.16, 0.14),
    });
    y -= size + 7;
  };

  const when = new Date(data.date).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  draw("La Casa del Shampoo", 16, true);
  draw(data.storeName, 11);
  draw(`Sucursal ${data.storeCode}`, 11);
  y -= 6;
  draw(`Folio ${data.folio}`, 12, true);
  draw(`Fecha: ${when}`);
  draw(`Cajero: ${data.employee}`);
  draw(`Tipo: ${data.saleType} / ${data.customerCategory}`);
  if (data.paymentMethod) draw(`Pago: ${data.paymentMethod}`);
  if (data.customer) draw(`Cliente: ${data.customer}`);
  if (data.email) draw(`Correo: ${data.email}`);
  if (data.phone) draw(`WhatsApp: ${data.phone}`);
  y -= 8;
  draw("Producto", 11, true);
  for (const item of data.lines) {
    draw(item.name, 10);
    draw(`  ${item.barcode}    $${item.price.toFixed(2)}`, 10);
  }
  y -= 8;
  draw(`Subtotal: $${data.subtotal.toFixed(2)}`);
  if (data.discountTotal > 0) {
    draw(`Descuento: -$${data.discountTotal.toFixed(2)}`);
  }
  draw(`TOTAL: $${data.total.toFixed(2)}`, 14, true);
  y -= 8;
  draw("Gracias por su compra.", 11);

  return doc.save();
}

export type DeliveryChannel = "email" | "whatsapp";

export type DeliveryResult = {
  ok: boolean;
  text: string;
  sent: boolean;
  channel: DeliveryChannel;
  destination: string;
  whatsappUrl?: string;
  error?: string;
};

export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `52${digits}`;
  return digits;
}

export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

async function sendWhatsApp(
  data: TicketData,
  phone: string,
  pdf: Uint8Array,
  text: string,
): Promise<DeliveryResult> {
  const account = whatsappSettings();
  if (!account) {
    return {
      ok: true,
      text,
      sent: false,
      channel: "whatsapp",
      destination: phone,
      whatsappUrl: whatsappLink(phone, text),
    };
  }

  const base = `https://graph.facebook.com/${account.apiVersion}/${account.phoneNumberId}`;
  const headers = { Authorization: `Bearer ${account.token}` };

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append(
      "file",
      new Blob([Buffer.from(pdf)], { type: "application/pdf" }),
      `${data.folio}.pdf`,
    );
    const uploadRes = await fetch(`${base}/media`, {
      method: "POST",
      headers,
      body: form,
    });
    const upload = (await uploadRes.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string };
    };
    if (!uploadRes.ok || !upload.id) {
      throw new Error(upload.error?.message || "WhatsApp no aceptó el PDF");
    }

    const payload: Record<string, unknown> = account.templateName
      ? {
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: account.templateName,
            language: { code: account.templateLang },
            components: [
              {
                type: "header",
                parameters: [
                  {
                    type: "document",
                    document: { id: upload.id, filename: `${data.folio}.pdf` },
                  },
                ],
              },
              {
                type: "body",
                parameters: [
                  { type: "text", text: data.folio },
                  { type: "text", text: `$${data.total.toFixed(2)}` },
                ],
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: phone,
          type: "document",
          document: {
            id: upload.id,
            filename: `${data.folio}.pdf`,
            caption: text.slice(0, 1024),
          },
        };

    const sendRes = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const sent = (await sendRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (!sendRes.ok) {
      throw new Error(sent.error?.message || "WhatsApp no envió el ticket");
    }
    return { ok: true, text, sent: true, channel: "whatsapp", destination: phone };
  } catch (err) {
    return {
      ok: false,
      text,
      sent: false,
      channel: "whatsapp",
      destination: phone,
      error:
        err instanceof Error ? err.message : "No se pudo enviar por WhatsApp",
    };
  }
}

export async function deliverTicketDelivery(
  data: TicketData,
  delivery: { channel: DeliveryChannel; email?: string; phone?: string },
): Promise<DeliveryResult> {
  const text = formatTicket(data);
  const pdf = await buildTicketPdf(data);
  const dir = path.join(config.dataDir, "tickets");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.folio}.pdf`);
  fs.writeFileSync(file, pdf);

  if (delivery.channel === "whatsapp") {
    const phone = normalizePhone(delivery.phone ?? "");
    return sendWhatsApp(data, phone, pdf, text);
  }

  const email = (delivery.email ?? "").trim();
  const subject = `Ticket ${data.folio} - La Casa del Shampoo`;
  const message = `Adjuntamos el ticket ${data.folio} en PDF.\n\n${text}`;
  const account = mailSettings();

  if (!account) {
    console.log(`[ticket] PDF guardado sin correo de envío -> ${file} para ${email}`);
    return { ok: true, text, sent: false, channel: "email", destination: email };
  }

  try {
    const transport = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.port === 465,
      requireTLS: account.port !== 465,
      auth: { user: account.user, pass: account.pass },
    });
    await transport.sendMail({
      from: account.from,
      to: email,
      subject,
      text: message,
      attachments: [{ filename: `${data.folio}.pdf`, content: Buffer.from(pdf) }],
    });
    return { ok: true, text, sent: true, channel: "email", destination: email };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "No se pudo enviar el correo";
    return {
      ok: false,
      text,
      sent: false,
      channel: "email",
      destination: email,
      error: /535|534|auth|invalid login/i.test(detail)
        ? "El correo de envío rechazó la contraseña. En Gmail, Outlook y Hotmail se usa una contraseña de aplicación."
        : detail,
    };
  }
}

export async function deliverTicket(
  data: TicketData,
  email: string,
): Promise<{ ok: boolean; text: string; emailed: boolean; error?: string }> {
  const result = await deliverTicketDelivery(data, { channel: "email", email });
  return {
    ok: result.ok,
    text: result.text,
    emailed: result.sent,
    error: result.error,
  };
}
