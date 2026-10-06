-- ============================================================
-- MapRoad — Esquema en Supabase (proyecto gk-control-operativo-entregas)
-- ============================================================
-- Todas las tablas llevan el sufijo _mpr y todas las funciones el
-- prefijo mpr_ para convivir con las tablas de las otras apps del
-- mismo proyecto sin tocarlas. Nada de este archivo modifica objetos
-- existentes. Se aplica vacío: sin datos de ejemplo.
--
-- Roles (usuarios_mpr.rol):
--   admin     ve y edita todo, crea usuarios
--   sociedad  ve y edita lo de los centros de su razón social
--   centro    ve y edita lo de su centro / CEDIS
--   chofer    solo la app móvil (acceso exclusivo por las funciones mpr_chofer_*)
--   auditor   observador: ve todo y la bitácora, no edita nada
-- ============================================================

-- ---------- Catálogos ----------
create table if not exists public.sociedades_mpr (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  razon_social text,
  rfc text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.centros_mpr (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid references public.sociedades_mpr(id) on delete set null,
  nombre text not null,
  tipo text not null default 'centro' check (tipo in ('centro','cedis')),
  razon_social text,
  direccion text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.unidades_mpr (
  id uuid primary key default gen_random_uuid(),
  placa text not null,
  modelo text,
  capacidad_kg numeric,
  capacidad_m3 numeric,
  estatus text not null default 'disponible' check (estatus in ('disponible','en_ruta','mantenimiento')),
  centro_id uuid references public.centros_mpr(id) on delete set null,
  chofer_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.choferes_mpr (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  licencia text,
  estatus text not null default 'activo' check (estatus in ('activo','inactivo')),
  unidad_id uuid references public.unidades_mpr(id) on delete set null,
  centro_id uuid references public.centros_mpr(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.unidades_mpr
    add constraint unidades_mpr_chofer_id_fkey foreign key (chofer_id) references public.choferes_mpr(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.tiendas_mpr (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  colonia text,
  cp text,
  lat double precision,
  lng double precision,
  es_origen boolean not null default false,
  centro_id uuid references public.centros_mpr(id) on delete set null,
  chofer_id uuid references public.choferes_mpr(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Enlaza un usuario de Supabase Auth con su rol y alcance en MapRoad.
-- La contraseña la maneja Supabase Auth; aquí nunca se guarda.
create table if not exists public.usuarios_mpr (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique,
  email text,
  nombre text,
  rol text not null check (rol in ('admin','sociedad','centro','chofer','auditor')),
  sociedad_id uuid references public.sociedades_mpr(id) on delete set null,
  centro_id uuid references public.centros_mpr(id) on delete set null,
  chofer_id uuid references public.choferes_mpr(id) on delete set null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Operación ----------
create table if not exists public.rutas_mpr (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  chofer_id uuid references public.choferes_mpr(id) on delete set null,
  unidad_id uuid references public.unidades_mpr(id) on delete set null,
  centro_id uuid references public.centros_mpr(id) on delete set null,
  origen_tienda_id uuid references public.tiendas_mpr(id) on delete set null,
  estatus text not null default 'pendiente' check (estatus in ('pendiente','en_curso','concluida')),
  pedido_ids uuid[] not null default '{}',
  orden_optimizado uuid[] not null default '{}',
  vehiculo_texto text,
  hora_inicio timestamptz,
  hora_fin timestamptz,
  notificacion_inicio jsonb,
  -- Última posición reportada por la app del chofer (para pintar la unidad sin leer todo el recorrido)
  ultima_lat double precision,
  ultima_lng double precision,
  ultima_ubicacion timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists rutas_mpr_fecha_idx on public.rutas_mpr (fecha);
create index if not exists rutas_mpr_chofer_fecha_idx on public.rutas_mpr (chofer_id, fecha);

create table if not exists public.pedidos_mpr (
  id uuid primary key default gen_random_uuid(),
  ruta_id uuid references public.rutas_mpr(id) on delete cascade,
  centro_id uuid references public.centros_mpr(id) on delete set null,
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
  estatus text not null default 'pendiente' check (estatus in ('pendiente','en_ruta','entregado','cliente_ausente','reprogramado','cancelado_sucursal','fallido')),
  hora_llegada timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pedidos_mpr_folio_idx on public.pedidos_mpr (lower(folio));
create index if not exists pedidos_mpr_ruta_idx on public.pedidos_mpr (ruta_id);
create index if not exists pedidos_mpr_fecha_idx on public.pedidos_mpr (fecha);

create table if not exists public.entregas_mpr (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_mpr(id) on delete cascade,
  ruta_id uuid references public.rutas_mpr(id) on delete cascade,
  centro_id uuid references public.centros_mpr(id) on delete set null,
  hora_entrega timestamptz not null default now(),
  resultado text not null check (resultado in ('entregado','cliente_ausente','reprogramado','cancelado_sucursal','fallido')),
  motivo text,
  nueva_fecha date,
  items_entregados jsonb,
  entrega_parcial boolean not null default false,
  comentarios text,
  fotos text[] not null default '{}',      -- URLs en Storage (bucket evidencias-mpr)
  firma text,                              -- URL de la firma en Storage
  documentos text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists entregas_mpr_ruta_idx on public.entregas_mpr (ruta_id);
create index if not exists entregas_mpr_pedido_idx on public.entregas_mpr (pedido_id);

-- Recorrido real de la unidad: la app del chofer reporta un punto cada 4 minutos
-- mientras la ruta está en curso.
create table if not exists public.ubicaciones_mpr (
  id bigint generated always as identity primary key,
  ruta_id uuid not null references public.rutas_mpr(id) on delete cascade,
  chofer_id uuid references public.choferes_mpr(id) on delete set null,
  unidad_id uuid references public.unidades_mpr(id) on delete set null,
  centro_id uuid references public.centros_mpr(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  precision_m real,
  velocidad_kmh real,
  rumbo real,
  registrada_en timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists ubicaciones_mpr_ruta_idx on public.ubicaciones_mpr (ruta_id, registrada_en);

-- Bitácora de auditoría: quién cambió qué y cuándo (la llenan los triggers de abajo).
create table if not exists public.bitacora_mpr (
  id bigint generated always as identity primary key,
  tabla text not null,
  operacion text not null,
  registro_id text,
  usuario_id uuid,
  usuario text,
  cambios jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bitacora_mpr_fecha_idx on public.bitacora_mpr (created_at desc);

-- ============================================================
-- Funciones de alcance por rol (base de las políticas RLS)
-- ============================================================
create or replace function public.mpr_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from usuarios_mpr where id = auth.uid() and activo;
$$;

create or replace function public.mpr_sociedad() returns uuid
language sql stable security definer set search_path = public as $$
  select sociedad_id from usuarios_mpr where id = auth.uid() and activo and rol = 'sociedad';
$$;

create or replace function public.mpr_ve_centro(p_centro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios_mpr u
    where u.id = auth.uid() and u.activo and (
      u.rol in ('admin','auditor')
      or (u.rol = 'centro' and p_centro = u.centro_id)
      or (u.rol = 'sociedad' and exists (select 1 from centros_mpr c where c.id = p_centro and c.sociedad_id = u.sociedad_id))
    ));
$$;

create or replace function public.mpr_edita_centro(p_centro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios_mpr u
    where u.id = auth.uid() and u.activo and (
      u.rol = 'admin'
      or (u.rol = 'centro' and p_centro = u.centro_id)
      or (u.rol = 'sociedad' and exists (select 1 from centros_mpr c where c.id = p_centro and c.sociedad_id = u.sociedad_id))
    ));
$$;

create or replace function public.mpr_ve_sociedad(p_sociedad uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios_mpr u
    where u.id = auth.uid() and u.activo and (
      u.rol in ('admin','auditor')
      or (u.rol = 'sociedad' and p_sociedad = u.sociedad_id)
      or (u.rol = 'centro' and exists (select 1 from centros_mpr c where c.id = u.centro_id and c.sociedad_id = p_sociedad))
    ));
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.sociedades_mpr  enable row level security;
alter table public.centros_mpr     enable row level security;
alter table public.unidades_mpr    enable row level security;
alter table public.choferes_mpr    enable row level security;
alter table public.tiendas_mpr     enable row level security;
alter table public.usuarios_mpr    enable row level security;
alter table public.rutas_mpr       enable row level security;
alter table public.pedidos_mpr     enable row level security;
alter table public.entregas_mpr    enable row level security;
alter table public.ubicaciones_mpr enable row level security;
alter table public.bitacora_mpr    enable row level security;

revoke all on public.sociedades_mpr, public.centros_mpr, public.unidades_mpr, public.choferes_mpr,
  public.tiendas_mpr, public.usuarios_mpr, public.rutas_mpr, public.pedidos_mpr, public.entregas_mpr,
  public.ubicaciones_mpr, public.bitacora_mpr from anon;

drop policy if exists sociedades_mpr_sel on public.sociedades_mpr;
drop policy if exists sociedades_mpr_adm on public.sociedades_mpr;
create policy sociedades_mpr_sel on public.sociedades_mpr for select to authenticated using (mpr_ve_sociedad(id));
create policy sociedades_mpr_adm on public.sociedades_mpr for all to authenticated
  using (mpr_rol() = 'admin') with check (mpr_rol() = 'admin');

drop policy if exists centros_mpr_sel on public.centros_mpr;
drop policy if exists centros_mpr_esc on public.centros_mpr;
create policy centros_mpr_sel on public.centros_mpr for select to authenticated using (mpr_ve_centro(id));
create policy centros_mpr_esc on public.centros_mpr for all to authenticated
  using (mpr_rol() = 'admin' or (sociedad_id is not null and sociedad_id = mpr_sociedad()))
  with check (mpr_rol() = 'admin' or (sociedad_id is not null and sociedad_id = mpr_sociedad()));

do $$
declare t text;
begin
  foreach t in array array['unidades_mpr','choferes_mpr','tiendas_mpr','rutas_mpr','pedidos_mpr'] loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_esc', t);
    execute format('create policy %I on public.%I for select to authenticated using (mpr_ve_centro(centro_id))', t||'_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (mpr_edita_centro(centro_id)) with check (mpr_edita_centro(centro_id))', t||'_esc', t);
  end loop;
  -- Entregas y ubicaciones solo las escribe la app del chofer (funciones mpr_chofer_*).
  foreach t in array array['entregas_mpr','ubicaciones_mpr'] loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (mpr_ve_centro(centro_id))', t||'_sel', t);
    execute format('create policy %I on public.%I for delete to authenticated using (mpr_edita_centro(centro_id))', t||'_del', t);
  end loop;
end $$;

-- Usuarios: cada quien ve su propio renglón; admin y auditor ven todos.
-- Altas/cambios/bajas solo por la Edge Function usuarios-mpr (service_role).
drop policy if exists usuarios_mpr_sel on public.usuarios_mpr;
create policy usuarios_mpr_sel on public.usuarios_mpr for select to authenticated
  using (id = auth.uid() or mpr_rol() in ('admin','auditor'));

drop policy if exists bitacora_mpr_sel on public.bitacora_mpr;
create policy bitacora_mpr_sel on public.bitacora_mpr for select to authenticated
  using (mpr_rol() in ('admin','auditor'));

-- ============================================================
-- Bitácora de auditoría (triggers)
-- ============================================================
create or replace function public.mpr_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cambios jsonb;
  v_id text;
  v_pesados text[] := array['fotos','firma','items','items_entregados','pedido_ids','orden_optimizado','notificacion_inicio'];
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, n.value) into v_cambios
    from jsonb_each(to_jsonb(new)) n
    where to_jsonb(old) -> n.key is distinct from n.value
      and n.key not in ('ultima_lat','ultima_lng','ultima_ubicacion');
    if v_cambios is null then return new; end if;
    v_cambios := v_cambios - v_pesados;
    v_id := new.id::text;
  elsif tg_op = 'INSERT' then
    v_cambios := to_jsonb(new) - v_pesados; v_id := new.id::text;
  else
    v_cambios := to_jsonb(old) - v_pesados; v_id := old.id::text;
  end if;
  insert into bitacora_mpr (tabla, operacion, registro_id, usuario_id, usuario, cambios)
  values (tg_table_name, tg_op, v_id, auth.uid(),
          (select usuario from usuarios_mpr where id = auth.uid()), v_cambios);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['sociedades_mpr','centros_mpr','unidades_mpr','choferes_mpr','tiendas_mpr','usuarios_mpr','rutas_mpr'] loop
    execute format('drop trigger if exists %I on public.%I', t||'_bitacora', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function mpr_bitacora()', t||'_bitacora', t);
  end loop;
  -- Pedidos: las altas masivas del Excel no se registran renglón por renglón, solo cambios y bajas.
  drop trigger if exists pedidos_mpr_bitacora on public.pedidos_mpr;
  create trigger pedidos_mpr_bitacora after update or delete on public.pedidos_mpr for each row execute function mpr_bitacora();
  drop trigger if exists entregas_mpr_bitacora on public.entregas_mpr;
  create trigger entregas_mpr_bitacora after insert or delete on public.entregas_mpr for each row execute function mpr_bitacora();
end $$;

-- ============================================================
-- App del chofer: 2 llamadas en total
--   mpr_chofer_ruta(fecha)   descarga la ruta del día completa (una sola vez)
--   mpr_chofer_sync(eventos) sube en lote lo que pasó (inicio, llegadas,
--                            entregas, fin y puntos GPS) — idempotente
-- ============================================================
create or replace function public.mpr_chofer_ruta(p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_u usuarios_mpr%rowtype;
  v_r rutas_mpr%rowtype;
begin
  select * into v_u from usuarios_mpr where id = auth.uid() and activo and rol = 'chofer';
  if not found or v_u.chofer_id is null then
    raise exception 'sin_acceso_chofer' using errcode = '42501';
  end if;
  select * into v_r from rutas_mpr
   where chofer_id = v_u.chofer_id and fecha = p_fecha
   order by (estatus = 'concluida'), created_at limit 1;

  return jsonb_build_object(
    'fecha', p_fecha,
    'servidor', now(),
    'chofer', (select jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono) from choferes_mpr c where c.id = v_u.chofer_id),
    'ruta', case when v_r.id is null then null else to_jsonb(v_r) end,
    'unidad', (select jsonb_build_object('id', u.id, 'placa', u.placa, 'modelo', u.modelo) from unidades_mpr u where u.id = v_r.unidad_id),
    'origen', (select jsonb_build_object('nombre', t.nombre, 'lat', t.lat, 'lng', t.lng) from tiendas_mpr t where t.id = v_r.origen_tienda_id),
    'pedidos', coalesce((select jsonb_agg(to_jsonb(p) order by p.orden_en_ruta nulls last, p.created_at) from pedidos_mpr p where p.ruta_id = v_r.id), '[]'::jsonb)
  );
end $$;

create or replace function public.mpr_chofer_sync(p_eventos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_chofer uuid;
  e jsonb;
  v_r rutas_mpr%rowtype;
  v_p pedidos_mpr%rowtype;
  v_hora timestamptz;
  v_ok int := 0;
  v_err int := 0;
begin
  select chofer_id into v_chofer from usuarios_mpr where id = auth.uid() and activo and rol = 'chofer';
  if v_chofer is null then
    raise exception 'sin_acceso_chofer' using errcode = '42501';
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb)) loop
    begin
      v_hora := coalesce(nullif(e->>'hora','')::timestamptz, now());
      case e->>'t'
      when 'inicio' then
        update rutas_mpr set estatus = 'en_curso', hora_inicio = coalesce(hora_inicio, v_hora)
         where id = (e->>'rutaId')::uuid and chofer_id = v_chofer and estatus = 'pendiente'
         returning * into v_r;
        if found and v_r.unidad_id is not null then
          update unidades_mpr set estatus = 'en_ruta' where id = v_r.unidad_id;
        end if;
      when 'llegada' then
        update pedidos_mpr p set hora_llegada = coalesce(p.hora_llegada, v_hora)
         where p.id = (e->>'pedidoId')::uuid
           and exists (select 1 from rutas_mpr r where r.id = p.ruta_id and r.chofer_id = v_chofer);
      when 'entrega' then
        select p.* into v_p from pedidos_mpr p join rutas_mpr r on r.id = p.ruta_id
         where p.id = (e->>'pedidoId')::uuid and r.chofer_id = v_chofer;
        if found then
          insert into entregas_mpr (id, pedido_id, ruta_id, centro_id, hora_entrega, resultado, motivo, nueva_fecha,
                                    items_entregados, entrega_parcial, comentarios, fotos, firma, documentos)
          values ((e->>'id')::uuid, v_p.id, v_p.ruta_id, v_p.centro_id, v_hora, e->>'resultado', nullif(e->>'motivo',''),
                  nullif(e->>'nuevaFecha','')::date, e->'itemsEntregados', coalesce((e->>'entregaParcial')::boolean, false),
                  nullif(e->>'comentarios',''),
                  array(select jsonb_array_elements_text(coalesce(e->'fotos','[]'::jsonb))),
                  nullif(e->>'firma',''),
                  array(select jsonb_array_elements_text(coalesce(e->'documentos','[]'::jsonb))))
          on conflict (id) do nothing;
          update pedidos_mpr set estatus = e->>'resultado' where id = v_p.id;
        end if;
      when 'fin' then
        update rutas_mpr set estatus = 'concluida', hora_fin = coalesce(hora_fin, v_hora)
         where id = (e->>'rutaId')::uuid and chofer_id = v_chofer and estatus = 'en_curso'
         returning * into v_r;
        if found and v_r.unidad_id is not null then
          update unidades_mpr set estatus = 'disponible' where id = v_r.unidad_id;
        end if;
      when 'notif' then
        update rutas_mpr set notificacion_inicio = e->'data'
         where id = (e->>'rutaId')::uuid and chofer_id = v_chofer;
      when 'ubic' then
        select * into v_r from rutas_mpr
         where id = (e->>'rutaId')::uuid and chofer_id = v_chofer and estatus in ('en_curso','concluida');
        if found then
          insert into ubicaciones_mpr (ruta_id, chofer_id, unidad_id, centro_id, lat, lng, precision_m, velocidad_kmh, rumbo, registrada_en)
          values (v_r.id, v_chofer, v_r.unidad_id, v_r.centro_id, (e->>'lat')::double precision, (e->>'lng')::double precision,
                  nullif(e->>'prec','')::real, nullif(e->>'vel','')::real, nullif(e->>'rumbo','')::real, v_hora);
          update rutas_mpr set ultima_lat = (e->>'lat')::double precision, ultima_lng = (e->>'lng')::double precision, ultima_ubicacion = v_hora
           where id = v_r.id and (ultima_ubicacion is null or ultima_ubicacion < v_hora);
        end if;
      else null;
      end case;
      v_ok := v_ok + 1;
    exception when others then
      -- Un evento corrupto no debe atorar la cola del teléfono: se cuenta y se sigue.
      v_err := v_err + 1;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'aplicados', v_ok, 'errores', v_err);
end $$;

-- ============================================================
-- Tracking público por folio (sin login). Devuelve solo lo que el cliente
-- necesita ver de UN pedido; nunca teléfono, firma ni documentos.
-- ============================================================
create or replace function public.mpr_tracking(p_folio text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_p pedidos_mpr%rowtype;
  v_r rutas_mpr%rowtype;
  v_e entregas_mpr%rowtype;
  v_orden uuid[];
  v_idx int;
  v_antes int := 0;
  v_prom numeric;
begin
  select * into v_p from pedidos_mpr where lower(folio) = lower(trim(p_folio)) order by created_at desc limit 1;
  if not found then return jsonb_build_object('encontrado', false); end if;
  select * into v_r from rutas_mpr where id = v_p.ruta_id;
  select * into v_e from entregas_mpr where pedido_id = v_p.id order by hora_entrega desc limit 1;

  if v_r.id is not null then
    v_orden := case when cardinality(v_r.orden_optimizado) > 0 then v_r.orden_optimizado else v_r.pedido_ids end;
    v_idx := array_position(v_orden, v_p.id);
    if v_idx is not null then
      select count(*) into v_antes from pedidos_mpr
       where id = any(v_orden[1:v_idx-1]) and estatus in ('entregado','cliente_ausente','reprogramado','cancelado_sucursal','fallido');
    end if;
    select avg(extract(epoch from (hora_fin - hora_inicio)) / 60 / greatest(cardinality(pedido_ids), 1)) into v_prom
      from rutas_mpr where chofer_id = v_r.chofer_id and estatus = 'concluida' and hora_inicio is not null and hora_fin is not null;
  end if;

  return jsonb_build_object(
    'encontrado', true,
    'pedido', jsonb_build_object('folio', v_p.folio, 'nombreContacto', v_p.nombre_contacto, 'direccion', v_p.direccion,
      'colonia', v_p.colonia, 'estatus', v_p.estatus, 'lat', v_p.lat, 'lng', v_p.lng,
      'horaLlegada', v_p.hora_llegada, 'createdAt', v_p.created_at),
    'ruta', case when v_r.id is null then null else jsonb_build_object('estatus', v_r.estatus, 'horaInicio', v_r.hora_inicio) end,
    'origen', (select jsonb_build_object('lat', t.lat, 'lng', t.lng) from tiendas_mpr t where t.id = v_r.origen_tienda_id and t.lat is not null),
    'chofer', (select c.nombre from choferes_mpr c where c.id = v_r.chofer_id),
    'total', coalesce(cardinality(v_orden), 0),
    'idx', coalesce(v_idx, 0) - 1,
    'entregadasAntes', v_antes,
    'promParada', coalesce(v_prom, 28),
    'entrega', case when v_e.id is null then null else jsonb_build_object('horaEntrega', v_e.hora_entrega, 'fotos', to_jsonb(v_e.fotos)) end
  );
end $$;

revoke all on function public.mpr_rol(), public.mpr_sociedad(), public.mpr_ve_centro(uuid), public.mpr_edita_centro(uuid),
  public.mpr_ve_sociedad(uuid), public.mpr_chofer_ruta(date), public.mpr_chofer_sync(jsonb), public.mpr_tracking(text),
  public.mpr_bitacora() from public, anon;
grant execute on function public.mpr_rol(), public.mpr_sociedad(), public.mpr_ve_centro(uuid), public.mpr_edita_centro(uuid),
  public.mpr_ve_sociedad(uuid), public.mpr_chofer_ruta(date), public.mpr_chofer_sync(jsonb) to authenticated;
grant execute on function public.mpr_tracking(text) to anon, authenticated;

-- ============================================================
-- Storage: evidencias de entrega (fotos y firma)
-- Bucket público de solo lectura por URL (rutas con UUID, no listables);
-- solo usuarios activos de MapRoad pueden subir.
-- ============================================================
insert into storage.buckets (id, name, public) values ('evidencias-mpr', 'evidencias-mpr', true)
on conflict (id) do nothing;

drop policy if exists evidencias_mpr_insert on storage.objects;
create policy evidencias_mpr_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidencias-mpr' and public.mpr_rol() is not null);

-- ============================================================
-- Realtime: el panel se entera de avances y posiciones sin recargar
-- ============================================================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['rutas_mpr','pedidos_mpr','entregas_mpr','ubicaciones_mpr'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ============================================================
-- Administrador inicial: el usuario de Auth fcerezo@kuroda.com
-- ============================================================
insert into public.usuarios_mpr (id, usuario, email, nombre, rol)
select id, 'fcerezo', email, coalesce(nullif(raw_user_meta_data->>'nombre',''), 'F. Cerezo'), 'admin'
from auth.users where lower(email) = 'fcerezo@kuroda.com'
on conflict (id) do update set rol = 'admin', activo = true;

-- ============================================================
-- Auxiliar de la Edge Function usuarios-mpr (solo service_role):
-- localiza una cuenta de Auth ya existente por correo para darle acceso a MapRoad.
-- ============================================================
create or replace function public.mpr_auth_id_por_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.mpr_auth_id_por_email(text) from public, anon, authenticated;
grant execute on function public.mpr_auth_id_por_email(text) to service_role;

-- La función de bitácora es solo para triggers: no se expone como RPC.
revoke all on function public.mpr_bitacora() from public, anon, authenticated;
