// Supabase Edge Function: notificar-inicio-ruta
//
// La llama la app del chofer (index.html) cuando presiona "Salir de la sucursal e
// iniciar ruta". Envía un correo a cada cliente de la ruta avisándole que su pedido
// ya va en camino (con hora estimada, número de parada y artículos).
//
// Proveedor de envío (EMAIL_PROVEEDOR / Vault email_proveedor): "gmail" o "resend" (default).
// Las credenciales viven SOLO aquí (secrets de la función o Supabase Vault — ver
// public.leer_secreto en schema.sql), nunca en el navegador.
//
//   Gmail  (SMTP smtp.gmail.com:465; Supabase bloquea 25 y 587)
//     GMAIL_USUARIO       cuenta@gmail.com                      (Vault: gmail_usuario)
//     GMAIL_APP_PASSWORD  contraseña de aplicación de Google    (Vault: gmail_app_password)
//     GMAIL_NOMBRE        nombre visible del remitente, opcional (Vault: gmail_nombre; default "MapRoad")
//   Resend
//     RESEND_API_KEY      re_xxx                                (Vault: resend_api_key)
//     RESEND_FROM         "MapRoad <entregas@tu-dominio.com>"   (Vault: resend_from, dominio verificado)
//
// Automáticos en Supabase (los inyecta la plataforma):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → bitácora en la tabla notificaciones_correo
// Opcionales:
//   ALLOWED_ORIGINS  lista separada por comas (ej. "https://maproad.vercel.app"); vacío = cualquiera
//   REPLY_TO         correo al que el cliente puede responder

import nodemailer from "npm:nodemailer@6.9.16";

const MAX_DESTINATARIOS = 100; // límite del endpoint /emails/batch de Resend
const MAX_ITEMS_CORREO = 25;
const VENTANA_ETA_MIN = 30; // se muestra "entre ETA-30 y ETA+30"
const TZ = "America/Mexico_City";
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

type ItemIn = { nombre?: string; cantidad?: number | string };
type PedidoIn = {
  folio?: string;
  email?: string;
  nombre?: string;
  direccion?: string;
  parada?: number;
  eta?: string; // ISO: llegada estimada (promedio histórico por parada del chofer)
  items?: ItemIn[];
};
type Payload = {
  rutaId?: string;
  fecha?: string;
  horaInicio?: string;
  origen?: string;
  chofer?: string;
  unidad?: string;
  totalParadas?: number;
  trackingBaseUrl?: string;
  pedidos?: PedidoIn[];
};

function cors(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = !allowed.length ? "*" : (origin && allowed.includes(origin) ? origin : allowed[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function clip(s: unknown, n: number): string {
  return String(s ?? "").trim().slice(0, n);
}

function fecha(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtHora(iso?: string): string {
  const d = fecha(iso);
  return d ? d.toLocaleString("es-MX", { timeZone: TZ, dateStyle: "long", timeStyle: "short" }) : "";
}

function fmtHoraCorta(d: Date): string {
  return d.toLocaleTimeString("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

// Ventana de llegada estimada, ej. "entre 10:30 a.m. y 11:30 a.m.". Nunca empieza
// antes de la salida de la sucursal (las primeras paradas tienen ETA cercano a ella).
function ventanaEta(iso?: string, salidaIso?: string): { desde: string; hasta: string } | null {
  const d = fecha(iso);
  if (!d) return null;
  const ms = VENTANA_ETA_MIN * 60000;
  const salida = fecha(salidaIso);
  const desde = Math.max(d.getTime() - ms, salida ? salida.getTime() : -Infinity);
  return { desde: fmtHoraCorta(new Date(desde)), hasta: fmtHoraCorta(new Date(d.getTime() + ms)) };
}

// Solo se aceptan enlaces http(s) para el botón de rastreo (evita javascript: etc.)
function safeTrackingUrl(base: string | undefined, folio: string): string | null {
  if (!base) return null;
  try {
    const u = new URL(base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}${u.pathname}#/tracking?folio=${encodeURIComponent(folio)}`;
  } catch {
    return null;
  }
}

function limpiarItems(items: ItemIn[] | undefined): { nombre: string; cantidad: string }[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({ nombre: clip(it?.nombre, 120), cantidad: clip(it?.cantidad, 12) }))
    .filter((it) => it.nombre);
}

// Template del correo "tu pedido va en camino". Todo lo que viene del Excel/cliente
// pasa por esc() antes de entrar al HTML.
export function construirCorreo(p: Required<Pick<PedidoIn, "folio" | "email">> & PedidoIn, ctx: Payload) {
  const nombre = clip(p.nombre, 120) || "cliente";
  const folio = clip(p.folio, 60);
  const salida = fmtHora(ctx.horaInicio);
  const link = safeTrackingUrl(ctx.trackingBaseUrl, folio);
  const eta = ventanaEta(p.eta, ctx.horaInicio);
  const parada = Number(p.parada) > 0 ? Math.floor(Number(p.parada)) : null;
  const total = Number(ctx.totalParadas) > 0 ? Math.floor(Number(ctx.totalParadas)) : null;
  const antes = parada ? parada - 1 : null;
  const todos = limpiarItems(p.items);
  const items = todos.slice(0, MAX_ITEMS_CORREO);
  const itemsExtra = todos.length - items.length;

  const subject = eta
    ? `Tu pedido ${folio} va en camino · llega entre ${eta.desde} y ${eta.hasta}`
    : `Tu pedido ${folio} va en camino`;

  const filas = ([
    ["Folio de pedido", folio],
    ["Dirección de entrega", clip(p.direccion, 300)],
    ["Chofer", clip(ctx.chofer, 120)],
    ["Unidad", clip(ctx.unidad, 60)],
    ["Salió de", [clip(ctx.origen, 120), salida].filter(Boolean).join(" · ")],
  ] as [string, string][]).filter(([, v]) => v);

  const txtParada = parada
    ? (antes === 0 ? "¡Eres la primera parada de la ruta!" : `Hay ${antes} ${antes === 1 ? "entrega" : "entregas"} antes de la tuya.`)
    : "";
  const txtNumParada = parada ? `parada ${parada}${total ? ` de ${total}` : ""}` : "";

  // Barra de progreso de la ruta (máx. 12 segmentos para que quepa en móvil)
  let barra = "";
  if (parada && total && total <= 12) {
    const celdas = Array.from({ length: total }, (_, i) => {
      const actual = i + 1 === parada;
      const bg = actual ? "#5e72e4" : "#dfe3f5";
      const fg = actual ? "#ffffff" : "#8898aa";
      return `<td align="center" style="padding:0 2px"><div style="background:${bg};color:${fg};border-radius:6px;font-size:11px;font-weight:bold;line-height:22px;height:22px">${i + 1}</div></td>`;
    }).join("");
    barra = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>${celdas}</tr></table>`;
  }

  const bloqueEta = eta
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1fd;border-radius:10px;margin:0 0 18px">
<tr><td style="padding:16px 18px">
<div style="font-size:12px;color:#5e72e4;font-weight:bold;letter-spacing:.5px">LLEGADA ESTIMADA</div>
<div style="font-size:22px;font-weight:bold;color:#32325d;margin-top:4px">Entre ${esc(eta.desde)} y ${esc(eta.hasta)}</div>
${parada ? `<div style="font-size:13px;color:#525f7f;margin-top:6px">Tu entrega es la <b>${esc(txtNumParada)}</b>. ${esc(txtParada)}</div>` : ""}
${barra}
</td></tr></table>`
    : (parada ? `<p style="margin:0 0 18px;font-size:14px">Tu entrega es la <b>${esc(txtNumParada)}</b>. ${esc(txtParada)}</p>` : "");

  const bloqueItems = items.length
    ? `<div style="font-size:14px;font-weight:bold;margin:22px 0 8px">Lo que te vamos a entregar</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;border:1px solid #eef0f5">
<tr style="background:#f6f9fc"><td style="padding:8px 12px;color:#8898aa;font-size:12px">Artículo</td><td align="right" style="padding:8px 12px;color:#8898aa;font-size:12px">Cantidad</td></tr>
${items.map((it) => `<tr><td style="padding:8px 12px;border-top:1px solid #eef0f5">${esc(it.nombre)}</td><td align="right" style="padding:8px 12px;border-top:1px solid #eef0f5"><b>${esc(it.cantidad || "—")}</b></td></tr>`).join("\n")}
${itemsExtra > 0 ? `<tr><td colspan="2" style="padding:8px 12px;border-top:1px solid #eef0f5;color:#8898aa;font-size:12px">y ${itemsExtra} artículo(s) más</td></tr>` : ""}
</table>`
    : "";

  const preheader = `${eta ? `Llega entre ${eta.desde} y ${eta.hasta} · ` : ""}Tu pedido ${folio} ya salió de la sucursal.`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#32325d">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#5e72e4;background-image:linear-gradient(310deg,#5e72e4,#825ee4);color:#ffffff;padding:22px 24px">
<div style="font-size:12px;opacity:.85;letter-spacing:.5px">MAPROAD · AVISO DE ENTREGA</div>
<div style="font-size:22px;font-weight:bold;margin-top:4px">🚚 Tu pedido va en camino</div>
<div style="font-size:13px;opacity:.9;margin-top:4px">Folio ${esc(folio)}</div>
</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px">Hola <b>${esc(nombre)}</b>,</p>
<p style="margin:0 0 18px;line-height:1.5">El chofer acaba de salir de la sucursal e inició la ruta de entrega que incluye tu pedido.</p>
${bloqueEta}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${filas.map(([k, v]) => `<tr><td style="padding:8px 0;color:#8898aa;border-bottom:1px solid #eef0f5;width:40%;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eef0f5"><b>${esc(v)}</b></td></tr>`).join("\n")}
</table>
${bloqueItems}
${link ? `<p style="margin:26px 0 0;text-align:center"><a href="${esc(link)}" style="display:inline-block;background:#5e72e4;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold">Rastrear mi pedido</a></p>` : ""}
<div style="margin:24px 0 0;padding:14px 16px;background:#f6f9fc;border-radius:8px;font-size:13px;color:#525f7f;line-height:1.6">
<b>Para recibir tu pedido:</b><br>• Ten a la mano tu folio <b>${esc(folio)}</b>.<br>• Asegúrate de que alguien pueda recibir en el domicilio.<br>• El horario es estimado y puede variar por tráfico o condiciones del camino.
</div>
</td></tr>
<tr><td style="padding:14px 24px;background:#f6f9fc;font-size:12px;color:#8898aa">Este es un aviso automático de MapRoad; por favor no respondas a este correo.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Hola ${nombre},`,
    "",
    "El chofer acaba de salir de la sucursal e inició la ruta de entrega que incluye tu pedido.",
    ...(eta ? ["", `Llegada estimada: entre ${eta.desde} y ${eta.hasta}`] : []),
    ...(parada ? [`Tu entrega es la ${txtNumParada}. ${txtParada}`] : []),
    "",
    ...filas.map(([k, v]) => `${k}: ${v}`),
    ...(items.length
      ? ["", "Lo que te vamos a entregar:", ...items.map((it) => `- ${it.nombre} x ${it.cantidad || "—"}`), ...(itemsExtra > 0 ? [`- y ${itemsExtra} artículo(s) más`] : [])]
      : []),
    ...(link ? ["", `Rastrea tu pedido: ${link}`] : []),
    "",
    "El horario es estimado y puede variar por tráfico o condiciones del camino.",
    "Este es un aviso automático de MapRoad.",
  ].join("\n");

  return { subject, html, text };
}

type Bitacora = { pedido_folio: string; email: string | null; estatus: "enviado" | "fallido" | "omitido"; motivo?: string | null; resend_id?: string | null };

function supabaseRest(): { url: string; key: string } | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? { url, key } : null;
}

// Guarda un renglón por destinatario en notificaciones_correo. Si falla, solo se
// registra en logs: nunca debe impedir que el correo al cliente salga.
async function registrarBitacora(rutaRef: string | undefined, rows: Bitacora[]) {
  const sb = supabaseRest();
  if (!sb || !rows.length) return;
  try {
    const r = await fetch(`${sb.url}/rest/v1/notificaciones_correo`, {
      method: "POST",
      headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows.map((x) => ({ tipo: "inicio_ruta", ruta_ref: rutaRef ? clip(rutaRef, 200) : null, ...x }))),
    });
    if (!r.ok) console.error("bitacora", r.status, await r.text());
  } catch (e) {
    console.error("bitacora", e);
  }
}

// "folio|email" ya enviados para esta ruta: si el chofer reintenta (doble clic,
// reconexión) no se le vuelve a escribir al mismo cliente.
async function yaEnviados(rutaRef: string | undefined): Promise<Set<string>> {
  const sb = supabaseRest();
  if (!sb || !rutaRef) return new Set();
  try {
    const q = new URLSearchParams({ select: "pedido_folio,email", ruta_ref: `eq.${clip(rutaRef, 200)}`, estatus: "eq.enviado" });
    const r = await fetch(`${sb.url}/rest/v1/notificaciones_correo?${q}`, { headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}` } });
    if (!r.ok) return new Set();
    const rows = (await r.json()) as { pedido_folio: string; email: string }[];
    return new Set(rows.map((x) => `${x.pedido_folio}|${(x.email || "").toLowerCase()}`));
  } catch {
    return new Set();
  }
}

// Lee un secreto de Vault vía la RPC leer_secreto (solo service_role puede ejecutarla).
// Sin caché: así un cambio en Vault (ej. nuevo remitente) aplica en el siguiente envío.
async function secreto(envName: string, vaultName: string): Promise<string | null> {
  const env = Deno.env.get(envName);
  if (env) return env;
  const sb = supabaseRest();
  if (!sb) return null;
  const r = await fetch(`${sb.url}/rest/v1/rpc/leer_secreto`, {
    method: "POST",
    headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_nombre: vaultName }),
  });
  return r.ok ? ((await r.json()) as string | null) : null;
}

type Correo = { to: string; subject: string; html: string; text: string };
type Resultado = { ok: true; id: string | null } | { ok: false; error: string };
type Enviador = (correos: Correo[], rutaRef: string | undefined) => Promise<Resultado[]>;

// Construye el enviador según el proveedor configurado, o devuelve el error de configuración.
async function crearEnviador(): Promise<Enviador | string> {
  const proveedor = ((await secreto("EMAIL_PROVEEDOR", "email_proveedor")) || "resend").trim().toLowerCase();
  const replyTo = Deno.env.get("REPLY_TO") || undefined;

  if (proveedor === "gmail") {
    const [usuario, pass, nombre] = await Promise.all([
      secreto("GMAIL_USUARIO", "gmail_usuario"),
      secreto("GMAIL_APP_PASSWORD", "gmail_app_password"),
      secreto("GMAIL_NOMBRE", "gmail_nombre"),
    ]);
    if (!usuario || !pass) return "Falta configurar gmail_usuario / gmail_app_password";
    // La contraseña de aplicación de Google se muestra con espacios; SMTP la necesita sin ellos.
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: usuario, pass: pass.replace(/\s+/g, "") },
    });
    const from = { name: (nombre || "MapRoad").replace(/["<>]/g, ""), address: usuario };
    return async (correos) => {
      // Gmail no tiene envío por lotes: uno por uno, en orden.
      const out: Resultado[] = [];
      for (const c of correos) {
        try {
          const info = await transport.sendMail({ from, to: c.to, subject: c.subject, html: c.html, text: c.text, ...(replyTo ? { replyTo } : {}) });
          out.push({ ok: true, id: info.messageId || null });
        } catch (e) {
          out.push({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) });
        }
      }
      transport.close();
      return out;
    };
  }

  if (proveedor === "resend") {
    const [apiKey, from] = await Promise.all([secreto("RESEND_API_KEY", "resend_api_key"), secreto("RESEND_FROM", "resend_from")]);
    if (!apiKey || !from) return "Falta configurar resend_api_key / resend_from";
    return async (correos, rutaRef) => {
      const resp = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(rutaRef ? { "Idempotency-Key": `inicio-ruta-${clip(rutaRef, 200)}` } : {}),
        },
        body: JSON.stringify(correos.map((c) => ({
          from,
          to: [c.to],
          subject: c.subject,
          html: c.html,
          text: c.text,
          ...(replyTo ? { reply_to: replyTo } : {}),
          tags: [{ name: "tipo", value: "inicio_ruta" }],
        }))),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = (data as { message?: string })?.message || `Resend respondió ${resp.status}`;
        return correos.map(() => ({ ok: false as const, error: msg }));
      }
      const ids: { id: string }[] = (data as { data?: { id: string }[] })?.data || [];
      return correos.map((_, i) => ({ ok: true as const, id: ids[i]?.id || null }));
    };
  }

  return `Proveedor de correo desconocido: ${proveedor}`;
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, headers);

  const enviar = await crearEnviador();
  if (typeof enviar === "string") return json({ error: enviar }, 500, headers);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400, headers);
  }

  const pedidos = Array.isArray(body.pedidos) ? body.pedidos : [];
  const previos = await yaEnviados(body.rutaId);
  const validos: (PedidoIn & { folio: string; email: string })[] = [];
  const omitidos: { folio: string; motivo: string }[] = [];
  const vistos = new Set<string>();
  for (const p of pedidos) {
    const folio = clip(p?.folio, 60);
    const email = clip(p?.email, 254).toLowerCase();
    if (!folio) continue;
    if (!email) { omitidos.push({ folio, motivo: "sin_email" }); continue; }
    if (!EMAIL_RE.test(email)) { omitidos.push({ folio, motivo: "email_invalido" }); continue; }
    const key = `${folio}|${email}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    if (previos.has(key)) { omitidos.push({ folio, motivo: "ya_enviado" }); continue; }
    validos.push({ ...p, folio, email });
  }
  if (validos.length > MAX_DESTINATARIOS) {
    return json({ error: `Máximo ${MAX_DESTINATARIOS} destinatarios por ruta` }, 400, headers);
  }
  // Los "ya_enviado" no se vuelven a registrar: su renglón "enviado" ya existe.
  const bitOmitidos: Bitacora[] = omitidos
    .filter((o) => o.motivo !== "ya_enviado")
    .map((o) => ({ pedido_folio: o.folio, email: null, estatus: "omitido", motivo: o.motivo }));

  const correos: Correo[] = validos.map((p) => ({ to: p.email, ...construirCorreo(p, body) }));
  const resultados = correos.length ? await enviar(correos, body.rutaId) : [];

  const enviados: { folio: string; email: string; id: string | null }[] = [];
  const fallidos: { folio: string; email: string; error: string }[] = [];
  resultados.forEach((r, i) => {
    const { folio, email } = validos[i];
    if (r.ok) enviados.push({ folio, email, id: r.id });
    else fallidos.push({ folio, email, error: r.error });
  });

  await registrarBitacora(body.rutaId, [
    ...enviados.map((x) => ({ pedido_folio: x.folio, email: x.email, estatus: "enviado" as const, resend_id: x.id })),
    ...fallidos.map((x) => ({ pedido_folio: x.folio, email: x.email, estatus: "fallido" as const, motivo: x.error })),
    ...bitOmitidos,
  ]);

  const status = fallidos.length && !enviados.length ? 502 : 200;
  return json({ enviados, fallidos, omitidos }, status, headers);
});
