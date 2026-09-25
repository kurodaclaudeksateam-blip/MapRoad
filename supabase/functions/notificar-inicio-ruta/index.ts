// Supabase Edge Function: notificar-inicio-ruta
//
// La llama la app del chofer (index.html) cuando presiona "Salir de la sucursal e
// iniciar ruta". Envía, vía Resend, un correo a cada cliente de la ruta avisándole
// que su pedido ya va en camino.
//
// La API key de Resend vive SOLO aquí (secret del proyecto), nunca en el navegador.
//
// Configuración requerida — como secrets de la función (supabase secrets set ...)
// o, si no hay CLI, en Supabase Vault (ver public.leer_secreto en schema.sql):
//   RESEND_API_KEY   re_xxx                                  (Vault: resend_api_key)
//   RESEND_FROM      "MapRoad <entregas@tu-dominio.com>"     (Vault: resend_from)
// Automáticos en Supabase (los inyecta la plataforma):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → bitácora en la tabla notificaciones_correo
// Opcionales:
//   ALLOWED_ORIGINS  lista separada por comas (ej. "https://maproad.vercel.app"); vacío = cualquiera
//   RESEND_REPLY_TO  correo al que el cliente puede responder

const MAX_DESTINATARIOS = 100; // límite del endpoint /emails/batch de Resend
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

type PedidoIn = { folio?: string; email?: string; nombre?: string; direccion?: string; parada?: number };
type Payload = {
  rutaId?: string;
  fecha?: string;
  horaInicio?: string;
  origen?: string;
  chofer?: string;
  unidad?: string;
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

function fmtHora(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
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

export function construirCorreo(p: Required<Pick<PedidoIn, "folio" | "email">> & PedidoIn, ctx: Payload) {
  const nombre = clip(p.nombre, 120) || "cliente";
  const folio = clip(p.folio, 60);
  const hora = fmtHora(ctx.horaInicio);
  const link = safeTrackingUrl(ctx.trackingBaseUrl, folio);
  const subject = `Tu pedido ${folio} va en camino`;

  const filas: [string, string][] = [
    ["Folio de pedido", folio],
    ["Dirección de entrega", clip(p.direccion, 300)],
    ["Chofer", clip(ctx.chofer, 120)],
    ["Unidad", clip(ctx.unidad, 60)],
    ["Salida", [clip(ctx.origen, 120), hora].filter(Boolean).join(" · ")],
  ].filter(([, v]) => v) as [string, string][];

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#32325d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#5e72e4;color:#fff;padding:20px 24px;font-size:20px;font-weight:bold">🚚 Tu pedido va en camino</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px">Hola ${esc(nombre)},</p>
<p style="margin:0 0 18px">El chofer acaba de salir de la sucursal e inició la ruta de entrega que incluye tu pedido.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${filas.map(([k, v]) => `<tr><td style="padding:8px 0;color:#8898aa;border-bottom:1px solid #eef0f5;width:40%">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eef0f5"><b>${esc(v)}</b></td></tr>`).join("\n")}
</table>
${link ? `<p style="margin:24px 0 0;text-align:center"><a href="${esc(link)}" style="display:inline-block;background:#5e72e4;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Rastrear mi pedido</a></p>` : ""}
<p style="margin:24px 0 0;font-size:13px;color:#8898aa">Te recomendamos tener a la mano tu folio y que alguien pueda recibir el pedido en el domicilio.</p>
</td></tr>
<tr><td style="padding:14px 24px;background:#f6f9fc;font-size:12px;color:#8898aa">Este es un aviso automático de MapRoad.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Hola ${nombre},`,
    "",
    "El chofer acaba de salir de la sucursal e inició la ruta de entrega que incluye tu pedido.",
    "",
    ...filas.map(([k, v]) => `${k}: ${v}`),
    ...(link ? ["", `Rastrea tu pedido: ${link}`] : []),
    "",
    "Este es un aviso automático de MapRoad.",
  ].join("\n");

  return { subject, html, text };
}

type Bitacora = { pedido_folio: string; email: string | null; estatus: "enviado" | "fallido" | "omitido"; motivo?: string | null; resend_id?: string | null };

// Guarda un renglón por destinatario en notificaciones_correo. Si falla, solo se
// registra en logs: nunca debe impedir que el correo al cliente salga.
async function registrarBitacora(rutaRef: string | undefined, rows: Bitacora[]) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !rows.length) return;
  try {
    const r = await fetch(`${url}/rest/v1/notificaciones_correo`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows.map((x) => ({ tipo: "inicio_ruta", ruta_ref: rutaRef ? clip(rutaRef, 200) : null, ...x }))),
    });
    if (!r.ok) console.error("bitacora", r.status, await r.text());
  } catch (e) {
    console.error("bitacora", e);
  }
}

// Lee un secreto de Vault vía la RPC leer_secreto (solo service_role puede ejecutarla).
const cacheSecretos = new Map<string, string | null>();
async function secreto(envName: string, vaultName: string): Promise<string | null> {
  const env = Deno.env.get(envName);
  if (env) return env;
  if (cacheSecretos.has(vaultName)) return cacheSecretos.get(vaultName)!;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/rpc/leer_secreto`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_nombre: vaultName }),
  });
  const val = r.ok ? ((await r.json()) as string | null) : null;
  if (val) cacheSecretos.set(vaultName, val);
  return val;
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, headers);

  const [apiKey, from] = await Promise.all([
    secreto("RESEND_API_KEY", "resend_api_key"),
    secreto("RESEND_FROM", "resend_from"),
  ]);
  if (!apiKey || !from) return json({ error: "Falta configurar RESEND_API_KEY / RESEND_FROM" }, 500, headers);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400, headers);
  }

  const pedidos = Array.isArray(body.pedidos) ? body.pedidos : [];
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
    validos.push({ ...p, folio, email });
  }
  if (validos.length > MAX_DESTINATARIOS) {
    return json({ error: `Máximo ${MAX_DESTINATARIOS} destinatarios por ruta` }, 400, headers);
  }
  const bitOmitidos: Bitacora[] = omitidos.map((o) => ({ pedido_folio: o.folio, email: null, estatus: "omitido", motivo: o.motivo }));
  if (!validos.length) {
    await registrarBitacora(body.rutaId, bitOmitidos);
    return json({ enviados: [], fallidos: [], omitidos }, 200, headers);
  }

  const replyTo = Deno.env.get("RESEND_REPLY_TO");
  const emails = validos.map((p) => {
    const { subject, html, text } = construirCorreo(p, body);
    return {
      from,
      to: [p.email],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      tags: [{ name: "tipo", value: "inicio_ruta" }],
    };
  });

  const resp = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Si el chofer reintenta (doble clic, reconexión), Resend no duplica los correos
      ...(body.rutaId ? { "Idempotency-Key": `inicio-ruta-${clip(body.rutaId, 200)}` } : {}),
    },
    body: JSON.stringify(emails),
  });
  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg = (data as { message?: string })?.message || `Resend respondió ${resp.status}`;
    await registrarBitacora(body.rutaId, [
      ...validos.map((p) => ({ pedido_folio: p.folio, email: p.email, estatus: "fallido" as const, motivo: msg })),
      ...bitOmitidos,
    ]);
    return json({
      enviados: [],
      fallidos: validos.map((p) => ({ folio: p.folio, email: p.email, error: msg })),
      omitidos,
    }, 502, headers);
  }

  const ids: { id: string }[] = (data as { data?: { id: string }[] })?.data || [];
  await registrarBitacora(body.rutaId, [
    ...validos.map((p, i) => ({ pedido_folio: p.folio, email: p.email, estatus: "enviado" as const, resend_id: ids[i]?.id || null })),
    ...bitOmitidos,
  ]);
  return json({
    enviados: validos.map((p, i) => ({ folio: p.folio, email: p.email, id: ids[i]?.id || null })),
    fallidos: [],
    omitidos,
  }, 200, headers);
});
