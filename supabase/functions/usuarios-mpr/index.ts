// MapRoad — alta, cambio y baja de usuarios (solo administradores).
// El navegador nunca tiene la service_role: esta función valida que quien
// llama sea un admin activo de usuarios_mpr y entonces opera sobre Supabase Auth.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ROLES = ["admin", "sociedad", "centro", "chofer", "auditor"];
// Los usuarios sin correo real reciben uno interno bajo este dominio (nunca se les escribe).
const DOMINIO_INTERNO = "mpr.kuroda.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function alcance(rol: string, b: Record<string, unknown>) {
  const sociedad_id = rol === "sociedad" ? (b.sociedadId || null) : null;
  const centro_id = rol === "centro" ? (b.centroId || null) : null;
  const chofer_id = rol === "chofer" ? (b.choferId || null) : null;
  if (rol === "sociedad" && !sociedad_id) return { error: "Selecciona la sociedad del usuario" };
  if (rol === "centro" && !centro_id) return { error: "Selecciona el centro del usuario" };
  if (rol === "chofer" && !chofer_id) return { error: "Selecciona el chofer vinculado" };
  return { sociedad_id, centro_id, chofer_id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quien } = await admin.auth.getUser(token);
  if (!quien?.user) return json({ error: "Sesión inválida" }, 401);
  const { data: yo } = await admin.from("usuarios_mpr").select("id, rol, activo").eq("id", quien.user.id).maybeSingle();
  if (!yo || !yo.activo || yo.rol !== "admin") return json({ error: "Solo un administrador puede gestionar usuarios" }, 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Cuerpo inválido" }, 400); }
  const accion = String(b.accion || "");

  if (accion === "crear") {
    const usuario = String(b.usuario || "").trim().toLowerCase();
    const password = String(b.password || "");
    const rol = String(b.rol || "");
    const nombre = String(b.nombre || "").trim();
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) return json({ error: "Usuario inválido: 3 a 40 caracteres (letras, números, punto, guion)" }, 400);
    if (!ROLES.includes(rol)) return json({ error: "Rol inválido" }, 400);
    const alc = alcance(rol, b);
    if ("error" in alc) return json({ error: alc.error }, 400);

    const { data: repetido } = await admin.from("usuarios_mpr").select("id").eq("usuario", usuario).maybeSingle();
    if (repetido) return json({ error: "Ese nombre de usuario ya existe" }, 409);

    const emailReal = String(b.email || "").trim().toLowerCase();
    const email = emailReal || `${usuario}@${DOMINIO_INTERNO}`;
    let authId: string | null = null;
    let creadoAqui = false;

    // Si el correo ya tiene cuenta en este proyecto (otra app), se le da acceso a MapRoad
    // sin tocarle la contraseña.
    const { data: existente } = await admin.rpc("mpr_auth_id_por_email", { p_email: email });
    if (existente) {
      authId = existente as string;
    } else {
      if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
      const { data: nuevo, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { nombre, origen: "maproad" },
      });
      if (error || !nuevo?.user) return json({ error: error?.message || "No se pudo crear la cuenta" }, 400);
      authId = nuevo.user.id;
      creadoAqui = true;
      // El proyecto es compartido: el alta en Auth genera un perfil en la app de Control
      // Operativo. Se deja inactivo para que un usuario de MapRoad no entre ahí por accidente.
      await admin.from("profiles").update({ activo: false }).eq("id", authId);
    }

    const { error: errFila } = await admin.from("usuarios_mpr").insert({
      id: authId, usuario, email, nombre, rol, ...alc, activo: true,
    });
    if (errFila) {
      if (creadoAqui && authId) await admin.auth.admin.deleteUser(authId);
      return json({ error: errFila.message }, 400);
    }
    return json({ ok: true, id: authId, vinculado: !creadoAqui });
  }

  if (accion === "actualizar") {
    const id = String(b.id || "");
    const { data: actual } = await admin.from("usuarios_mpr").select("*").eq("id", id).maybeSingle();
    if (!actual) return json({ error: "Usuario no encontrado" }, 404);
    const rol = String(b.rol || actual.rol);
    if (!ROLES.includes(rol)) return json({ error: "Rol inválido" }, 400);
    const activo = b.activo === undefined ? actual.activo : !!b.activo;
    if (id === yo.id && (rol !== "admin" || !activo)) return json({ error: "No puedes quitarte a ti mismo el rol de administrador" }, 400);
    const alc = alcance(rol, b);
    if ("error" in alc) return json({ error: alc.error }, 400);

    const password = String(b.password || "");
    if (password) {
      if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
    }
    const { error } = await admin.from("usuarios_mpr")
      .update({ nombre: String(b.nombre ?? actual.nombre ?? "").trim(), rol, ...alc, activo }).eq("id", id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (accion === "eliminar") {
    const id = String(b.id || "");
    if (id === yo.id) return json({ error: "No puedes eliminar tu propio usuario" }, 400);
    const { data: actual } = await admin.from("usuarios_mpr").select("id, email").eq("id", id).maybeSingle();
    if (!actual) return json({ error: "Usuario no encontrado" }, 404);
    // Solo se borra la cuenta de Auth si es interna de MapRoad; una cuenta con correo real
    // puede pertenecer también a otra app del proyecto: a esa solo se le retira el acceso.
    if ((actual.email || "").endsWith("@" + DOMINIO_INTERNO)) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
    } else {
      const { error } = await admin.from("usuarios_mpr").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida" }, 400);
});
