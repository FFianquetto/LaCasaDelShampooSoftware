import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import nodemailer from "nodemailer";
import { config, mailSettings } from "../config.js";
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

export async function deliverTicket(
  data: TicketData,
  email: string,
): Promise<{ ok: boolean; text: string; emailed: boolean; error?: string }> {
  const text = formatTicket(data);
  const pdf = await buildTicketPdf(data);
  const dir = path.join(config.dataDir, "tickets");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.folio}.pdf`);
  fs.writeFileSync(file, pdf);
  const subject = `Ticket ${data.folio} - La Casa del Shampoo`;
  const message = `Adjuntamos el ticket ${data.folio} en PDF.\n\n${text}`;
  const account = mailSettings();

  if (!account) {
    console.log(`[ticket] PDF guardado sin correo de envío -> ${file} para ${email}`);
    return { ok: true, text, emailed: false };
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
    return { ok: true, text, emailed: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "No se pudo enviar el correo";
    return {
      ok: false,
      text,
      emailed: false,
      error: /535|534|auth|invalid login/i.test(detail)
        ? "El correo de envío rechazó la contraseña. En Gmail, Outlook y Hotmail se usa una contraseña de aplicación."
        : detail,
    };
  }
}
