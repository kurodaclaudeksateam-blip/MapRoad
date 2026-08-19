-- ============================================================
-- MapRoad — Esquema de Supabase (migración desde localStorage)
-- ============================================================
-- Refleja 1:1 las entidades que ya usa el prototipo en index.html
-- (ver el objeto DB y sus tablas maproad_*). Aplica este archivo
-- completo en el SQL Editor de Supabase, o con:
--   supabase db push  /  mcp: apply_migration
--
-- Incluye al final la pieza que pediste: una función de solo
-- lectura, consultable SOLO por número de folio, que otra web
-- puede llamar con la llave pública (anon) sin poder leer el
-- resto de las tablas (RLS cerrado por defecto).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Catálogos ----------

create table centros (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  razon_social text,
  direccion text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create table unidades (
  id uuid primary key default gen_random_uuid(),
  placa text not null,
  modelo text,
  capacidad_kg numeric,
  capacidad_m3 numeric,
  estatus text not null default 'disponible' check (estatus in ('disponible','en_ruta','mantenimiento')),
  centro_id uuid references centros(id) on delete set null,
  chofer_id uuid, -- FK se agrega abajo (referencia circular con choferes)
  created_at timestamptz not null default now()
);

create table choferes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  licencia text,
  estatus text not null default 'activo' check (estatus in ('activo','inactivo')),
  unidad_id uuid references unidades(id) on delete set null,
  centro_id uuid references centros(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table unidades
  add constraint unidades_chofer_id_fkey foreign key (chofer_id) references choferes(id) on delete set null;

create table tiendas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  colonia text,
  cp text,
  lat double precision,
  lng double precision,
  centro_id uuid references centros(id) on delete set null,
  chofer_id uuid references choferes(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Enlaza un usuario de Supabase Auth (auth.users) con su rol y, si es
-- chofer, con su registro en choferes. La contraseña NUNCA se guarda
-- aquí — la maneja Supabase Auth (a diferencia del localStorage del
-- prototipo, que la guarda en claro solo para fines de demo).
create table usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique,
  rol text not null check (rol in ('admin','trafico','chofer')),
  nombre text,
  chofer_id uuid references choferes(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Operación ----------

create table rutas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  chofer_id uuid references choferes(id) on delete set null,
  unidad_id uuid references unidades(id) on delete set null,
  centro_id uuid references centros(id) on delete set null,
  estatus text not null default 'pendiente' check (estatus in ('pendiente','en_curso','concluida')),
  orden_optimizado uuid[],
  vehiculo_texto text,
  hora_inicio timestamptz,
  hora_fin timestamptz,
  created_at timestamptz not null default now()
);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  ruta_id uuid references rutas(id) on delete set null,
  centro_id uuid references centros(id) on delete set null,
  fecha date,
  folio text not null,
  vehiculo text,
  items jsonb,
  numero_cliente text,
  nombre_contacto text,
  telefono text,
  email_contacto text,
  direccion text,
  colonia text,
  cp text,
  lat double precision,
  lng double precision,
  fecha_min date,
  fecha_max date,
  control_destino text,
  oficina_ventas text,
  sucursal_solicita text,
  nombre_vendedor text,
  comentarios text,
  folio_factura text,
  peso_kg numeric,
  volumen_m3 numeric,
  importe_total numeric,
  orden_en_ruta int,
  estatus text not null default 'pendiente' check (estatus in ('pendiente','entregado','fallido')),
  hora_llegada timestamptz,
  created_at timestamptz not null default now()
);
create index pedidos_folio_idx on pedidos (lower(folio));

create table entregas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  ruta_id uuid references rutas(id) on delete set null,
  hora_entrega timestamptz not null default now(),
  resultado text not null check (resultado in ('entregado','fallido')),
  motivo text,
  comentarios text,
  fotos text[],       -- URLs en Supabase Storage (no dataURL como en el prototipo)
  firma_url text,     -- URL de la firma en Supabase Storage
  documentos text[],
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — cerrado por defecto para todos (incl. anon)
-- ============================================================
alter table centros  enable row level security;
alter table unidades enable row level security;
alter table choferes enable row level security;
alter table tiendas  enable row level security;
alter table usuarios enable row level security;
alter table rutas    enable row level security;
alter table pedidos  enable row level security;
alter table entregas enable row level security;

-- Nota: aquí agregarías políticas para admin/trafico/chofer autenticados
-- (por ejemplo: "un chofer solo ve sus propias rutas/pedidos"). Se omiten
-- en este archivo porque dependen de cómo conectes Supabase Auth; el
-- panel admin/tráfico/chofer de MapRoad seguirá funcionando con la
-- misma llave de servicio (service_role) mientras tanto.

-- ============================================================
-- Consulta pública de solo lectura por Folio de Pedido
-- ============================================================
-- Esta es la pieza para "otra web": una función de Postgres que
-- SÍ puede leer las tablas (SECURITY DEFINER) pero solo devuelve
-- el informe de UN folio a la vez — nunca una lista completa.
-- Se le da EXECUTE a "anon", nunca SELECT directo sobre las tablas.
--
-- Decisión de producto: la consulta es SOLO por folio (sin teléfono/
-- C.P. como pide el tracking interno de MapRoad). Eso significa que
-- cualquiera que tenga o adivine el folio puede ver el informe
-- completo (dirección, teléfono, foto, firma). Si más adelante quieres
-- endurecerlo, basta con agregar un segundo parámetro (ej. p_telefono)
-- y filtrar también por él antes de devolver el resultado.
create or replace function public.get_informe_por_folio(p_folio text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido   pedidos%rowtype;
  v_ruta     rutas%rowtype;
  v_chofer   choferes%rowtype;
  v_unidad   unidades%rowtype;
  v_centro   centros%rowtype;
  v_entrega  entregas%rowtype;
begin
  select * into v_pedido from pedidos where lower(folio) = lower(trim(p_folio)) limit 1;
  if not found then
    return jsonb_build_object('encontrado', false, 'error', 'No se encontró ningún pedido con ese folio');
  end if;

  select * into v_ruta    from rutas    where id = v_pedido.ruta_id;
  select * into v_chofer  from choferes where id = v_ruta.chofer_id;
  select * into v_unidad  from unidades where id = v_ruta.unidad_id;
  select * into v_centro  from centros  where id = v_ruta.centro_id;
  select * into v_entrega from entregas where pedido_id = v_pedido.id order by hora_entrega desc limit 1;

  return jsonb_build_object(
    'encontrado', true,
    'folio', v_pedido.folio,
    'cliente', v_pedido.nombre_contacto,
    'telefono', v_pedido.telefono,
    'direccion', v_pedido.direccion,
    'colonia', v_pedido.colonia,
    'cp', v_pedido.cp,
    'estatus_pedido', v_pedido.estatus,
    'fecha_min', v_pedido.fecha_min,
    'fecha_max', v_pedido.fecha_max,
    'fecha_ruta', coalesce(v_pedido.fecha, v_ruta.fecha),
    'chofer', v_chofer.nombre,
    'unidad', v_unidad.placa,
    'centro', v_centro.nombre,
    'estatus_ruta', v_ruta.estatus,
    'orden_en_ruta', v_pedido.orden_en_ruta,
    'hora_llegada', v_pedido.hora_llegada,
    'hora_entrega', v_entrega.hora_entrega,
    'resultado', v_entrega.resultado,
    'motivo', v_entrega.motivo,
    'comentarios', v_entrega.comentarios,
    'fotos', coalesce(to_jsonb(v_entrega.fotos), '[]'::jsonb)
    -- Por seguridad, la firma y los documentos internos NUNCA se exponen en esta
    -- consulta pública — solo las fotos tomadas durante la entrega. Si se necesitan,
    -- deben consultarse desde el panel admin/tráfico autenticado, no desde aquí.
  );
end;
$$;

revoke all on function public.get_informe_por_folio(text) from public;
grant execute on function public.get_informe_por_folio(text) to anon, authenticated;
