-- ============================================================
-- MapRoad — Ampliación v2 (se aplica DESPUÉS de schema_mpr.sql)
-- ============================================================
-- Solo agrega: columnas nuevas (todas opcionales), la tabla
-- incidencias_mpr y nuevas versiones de mpr_chofer_ruta / mpr_chofer_sync.
-- No borra ni cambia nada existente y se puede volver a aplicar.
-- La versión anterior de la app del chofer sigue funcionando con esta base
-- (los campos nuevos de cada evento son opcionales).
-- ============================================================

-- ---------- Catálogos: campos que faltaban ----------
alter table public.centros_mpr
  add column if not exists telefono text,
  add column if not exists responsable text;

alter table public.unidades_mpr
  add column if not exists numero_economico text,
  add column if not exists tipo text,
  add column if not exists marca text,
  add column if not exists anio int,
  add column if not exists seguro_vence date,
  add column if not exists verificacion_vence date,
  add column if not exists odometro_km numeric,
  add column if not exists rendimiento_km_l numeric,
  add column if not exists notas text;

alter table public.choferes_mpr
  add column if not exists numero_empleado text,
  add column if not exists email text,
  add column if not exists licencia_tipo text,
  add column if not exists licencia_vence date,
  add column if not exists contacto_emergencia text,
  add column if not exists notas text;

alter table public.tiendas_mpr
  add column if not exists telefono text,
  add column if not exists contacto text,
  add column if not exists horario text;

-- ---------- Operación ----------
-- Reintentos: un pedido no entregado se vuelve a programar como un pedido nuevo
-- (mismo folio) que apunta al intento anterior.
alter table public.pedidos_mpr
  add column if not exists intento int not null default 1,
  add column if not exists reintento_de uuid references public.pedidos_mpr(id) on delete set null;

alter table public.rutas_mpr
  add column if not exists km_plan numeric,            -- distancia estimada al generar la ruta
  add column if not exists km_gps numeric not null default 0, -- distancia acumulada con los puntos GPS
  add column if not exists odometro_inicio numeric,
  add column if not exists odometro_fin numeric,
  add column if not exists combustible_inicio text,
  add column if not exists checklist_salida jsonb;      -- revisión de la unidad antes de salir

alter table public.entregas_mpr
  add column if not exists recibe_nombre text,
  add column if not exists lat double precision,        -- dónde estaba el chofer al cerrar la entrega
  add column if not exists lng double precision,
  add column if not exists precision_m real,
  add column if not exists distancia_m real;            -- metros entre ese punto y el domicilio del pedido

-- Incidencias en ruta reportadas por el chofer (falla mecánica, tráfico, accidente…)
create table if not exists public.incidencias_mpr (
  id uuid primary key default gen_random_uuid(),
  ruta_id uuid references public.rutas_mpr(id) on delete cascade,
  chofer_id uuid references public.choferes_mpr(id) on delete set null,
  unidad_id uuid references public.unidades_mpr(id) on delete set null,
  centro_id uuid references public.centros_mpr(id) on delete set null,
  tipo text not null,
  descripcion text,
  lat double precision,
  lng double precision,
  foto text,
  hora timestamptz not null default now(),
  atendida boolean not null default false,
  atendida_por text,
  atendida_en timestamptz,
  nota_atencion text,
  created_at timestamptz not null default now()
);
create index if not exists incidencias_mpr_ruta_idx on public.incidencias_mpr (ruta_id);
create index if not exists incidencias_mpr_hora_idx on public.incidencias_mpr (hora desc);

alter table public.incidencias_mpr enable row level security;
revoke all on public.incidencias_mpr from anon;
drop policy if exists incidencias_mpr_sel on public.incidencias_mpr;
drop policy if exists incidencias_mpr_upd on public.incidencias_mpr;
drop policy if exists incidencias_mpr_del on public.incidencias_mpr;
create policy incidencias_mpr_sel on public.incidencias_mpr for select to authenticated using (mpr_ve_centro(centro_id));
-- El panel solo las marca como atendidas o las borra; las altas llegan por mpr_chofer_sync.
create policy incidencias_mpr_upd on public.incidencias_mpr for update to authenticated
  using (mpr_edita_centro(centro_id)) with check (mpr_edita_centro(centro_id));
create policy incidencias_mpr_del on public.incidencias_mpr for delete to authenticated using (mpr_edita_centro(centro_id));

drop trigger if exists incidencias_mpr_bitacora on public.incidencias_mpr;
create trigger incidencias_mpr_bitacora after insert or update or delete on public.incidencias_mpr
  for each row execute function mpr_bitacora();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incidencias_mpr') then
    alter publication supabase_realtime add table public.incidencias_mpr;
  end if;
end $$;

-- ---------- App del chofer ----------
-- Igual que antes, más el teléfono de la base (centro) para llamar con un toque.
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
    'unidad', (select jsonb_build_object('id', u.id, 'placa', u.placa, 'modelo', u.modelo, 'odometroKm', u.odometro_km) from unidades_mpr u where u.id = v_r.unidad_id),
    'origen', (select jsonb_build_object('nombre', t.nombre, 'lat', t.lat, 'lng', t.lng, 'telefono', t.telefono) from tiendas_mpr t where t.id = v_r.origen_tienda_id),
    'centro', (select jsonb_build_object('nombre', c.nombre, 'telefono', c.telefono) from centros_mpr c where c.id = v_r.centro_id),
    'pedidos', coalesce((select jsonb_agg(to_jsonb(p) order by p.orden_en_ruta nulls last, p.created_at) from pedidos_mpr p where p.ruta_id = v_r.id), '[]'::jsonb)
  );
end $$;

-- Eventos nuevos o ampliados:
--   inicio     + odometro, combustible, checklist
--   entrega    + recibe, lat, lng, prec, dist
--   fin        + odometro (actualiza también el odómetro de la unidad)
--   ubic       acumula km_gps de la ruta
--   incidencia alta en incidencias_mpr
create or replace function public.mpr_chofer_sync(p_eventos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_chofer uuid;
  e jsonb;
  v_r rutas_mpr%rowtype;
  v_p pedidos_mpr%rowtype;
  v_hora timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_km numeric;
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
        update rutas_mpr set estatus = 'en_curso', hora_inicio = coalesce(hora_inicio, v_hora),
               odometro_inicio = coalesce(nullif(e->>'odometro','')::numeric, odometro_inicio),
               combustible_inicio = coalesce(nullif(e->>'combustible',''), combustible_inicio),
               checklist_salida = coalesce(e->'checklist', checklist_salida)
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
                                    items_entregados, entrega_parcial, comentarios, fotos, firma, documentos,
                                    recibe_nombre, lat, lng, precision_m, distancia_m)
          values ((e->>'id')::uuid, v_p.id, v_p.ruta_id, v_p.centro_id, v_hora, e->>'resultado', nullif(e->>'motivo',''),
                  nullif(e->>'nuevaFecha','')::date, e->'itemsEntregados', coalesce((e->>'entregaParcial')::boolean, false),
                  nullif(e->>'comentarios',''),
                  array(select jsonb_array_elements_text(coalesce(e->'fotos','[]'::jsonb))),
                  nullif(e->>'firma',''),
                  array(select jsonb_array_elements_text(coalesce(e->'documentos','[]'::jsonb))),
                  nullif(e->>'recibe',''), nullif(e->>'lat','')::double precision, nullif(e->>'lng','')::double precision,
                  nullif(e->>'prec','')::real, nullif(e->>'dist','')::real)
          on conflict (id) do nothing;
          update pedidos_mpr set estatus = e->>'resultado' where id = v_p.id;
        end if;
      when 'fin' then
        update rutas_mpr set estatus = 'concluida', hora_fin = coalesce(hora_fin, v_hora),
               odometro_fin = coalesce(nullif(e->>'odometro','')::numeric, odometro_fin)
         where id = (e->>'rutaId')::uuid and chofer_id = v_chofer and estatus = 'en_curso'
         returning * into v_r;
        if found and v_r.unidad_id is not null then
          update unidades_mpr set estatus = 'disponible', odometro_km = coalesce(v_r.odometro_fin, odometro_km)
           where id = v_r.unidad_id;
        end if;
      when 'notif' then
        update rutas_mpr set notificacion_inicio = e->'data'
         where id = (e->>'rutaId')::uuid and chofer_id = v_chofer;
      when 'ubic' then
        select * into v_r from rutas_mpr
         where id = (e->>'rutaId')::uuid and chofer_id = v_chofer and estatus in ('en_curso','concluida');
        if found then
          v_lat := (e->>'lat')::double precision; v_lng := (e->>'lng')::double precision;
          insert into ubicaciones_mpr (ruta_id, chofer_id, unidad_id, centro_id, lat, lng, precision_m, velocidad_kmh, rumbo, registrada_en)
          values (v_r.id, v_chofer, v_r.unidad_id, v_r.centro_id, v_lat, v_lng,
                  nullif(e->>'prec','')::real, nullif(e->>'vel','')::real, nullif(e->>'rumbo','')::real, v_hora);
          if v_r.ultima_ubicacion is null or v_r.ultima_ubicacion < v_hora then
            -- Distancia (haversine) desde el punto anterior; se ignoran saltos imposibles (> 150 km).
            v_km := 0;
            if v_r.ultima_lat is not null then
              v_km := 6371 * 2 * asin(least(1, sqrt(
                power(sin(radians(v_lat - v_r.ultima_lat) / 2), 2)
                + cos(radians(v_r.ultima_lat)) * cos(radians(v_lat)) * power(sin(radians(v_lng - v_r.ultima_lng) / 2), 2))));
              if v_km > 150 then v_km := 0; end if;
            end if;
            update rutas_mpr set ultima_lat = v_lat, ultima_lng = v_lng, ultima_ubicacion = v_hora,
                   km_gps = coalesce(km_gps, 0) + v_km
             where id = v_r.id;
          end if;
        end if;
      when 'incidencia' then
        select * into v_r from rutas_mpr where id = (e->>'rutaId')::uuid and chofer_id = v_chofer;
        if found then
          insert into incidencias_mpr (id, ruta_id, chofer_id, unidad_id, centro_id, tipo, descripcion, lat, lng, foto, hora)
          values ((e->>'id')::uuid, v_r.id, v_chofer, v_r.unidad_id, v_r.centro_id, coalesce(nullif(e->>'tipo',''), 'otro'),
                  nullif(e->>'descripcion',''), nullif(e->>'lat','')::double precision, nullif(e->>'lng','')::double precision,
                  nullif(e->>'foto',''), v_hora)
          on conflict (id) do nothing;
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

-- Bitácora: km_gps cambia con cada punto GPS (como ultima_lat/lng) y no debe generar renglones.
create or replace function public.mpr_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cambios jsonb;
  v_id text;
  v_pesados text[] := array['fotos','firma','items','items_entregados','pedido_ids','orden_optimizado','notificacion_inicio','checklist_salida'];
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, n.value) into v_cambios
    from jsonb_each(to_jsonb(new)) n
    where to_jsonb(old) -> n.key is distinct from n.value
      and n.key not in ('ultima_lat','ultima_lng','ultima_ubicacion','km_gps');
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
revoke all on function public.mpr_bitacora() from public, anon, authenticated;

revoke all on function public.mpr_chofer_ruta(date), public.mpr_chofer_sync(jsonb) from public, anon;
grant execute on function public.mpr_chofer_ruta(date), public.mpr_chofer_sync(jsonb) to authenticated;
