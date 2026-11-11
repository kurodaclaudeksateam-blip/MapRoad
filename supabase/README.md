# Supabase — MapRoad

Proyecto: **gk-control-operativo-entregas** (`mhmqgjgfkcrgbtrhmtqw`), compartido con otras apps.
Todo lo de MapRoad se distingue por nombre y no modifica objetos existentes:

| Tipo | Nombres |
|------|---------|
| Tablas | `sociedades_mpr`, `centros_mpr`, `unidades_mpr`, `choferes_mpr`, `tiendas_mpr`, `usuarios_mpr`, `rutas_mpr`, `pedidos_mpr`, `entregas_mpr`, `ubicaciones_mpr`, `bitacora_mpr` |
| Funciones | `mpr_rol`, `mpr_sociedad`, `mpr_ve_centro`, `mpr_edita_centro`, `mpr_ve_sociedad`, `mpr_chofer_ruta`, `mpr_chofer_sync`, `mpr_tracking`, `mpr_bitacora`, `mpr_auth_id_por_email` |
| Storage | bucket `evidencias-mpr` (fotos y firmas de entrega) |
| Edge Function | `usuarios-mpr` (altas, cambios y bajas de usuarios; solo administradores) |

[`schema_mpr.sql`](schema_mpr.sql) es el esquema completo y se puede volver a aplicar sin riesgo (`if not exists` / `create or replace`). No inserta datos, salvo dar el rol de administrador a la cuenta `fcerezo@kuroda.com`.

## Ampliación v2

[`migracion_v2_mpr.sql`](migracion_v2_mpr.sql) se aplica **después** del esquema base y antes de publicar el panel y el APK 1.1. Solo agrega: columnas opcionales en catálogos, rutas, pedidos y entregas; la tabla `incidencias_mpr`; y las nuevas versiones de `mpr_chofer_ruta`, `mpr_chofer_sync` (eventos `incidencia`, odómetro, revisión de salida, ubicación de la entrega, km por GPS) y `mpr_bitacora`. Es compatible con el APK 1.0.

## Acceso

- **Panel** (admin, sociedad, centro, auditor): lee y escribe las tablas directamente; RLS limita cada renglón al alcance del rol.
- **Chofer**: no tiene acceso directo a ninguna tabla. Usa dos funciones:
  - `mpr_chofer_ruta(fecha)` — devuelve su ruta del día completa en un JSON.
  - `mpr_chofer_sync(eventos)` — aplica en lote `inicio`, `llegada`, `entrega`, `fin`, `ubic` y `notif`. Es idempotente (reenviar un lote no duplica entregas) y un evento inválido se cuenta en `errores` sin detener al resto.
- **Público** (sin sesión): solo `mpr_tracking(folio)`, que devuelve un pedido a la vez, sin teléfono, firma ni documentos.

## Consultar un folio desde otra web

```js
const { data } = await supabase.rpc('mpr_tracking', { p_folio: 'F1000' })
if (data.encontrado) console.log(data.pedido.estatus, data.ruta?.estatus, data.entrega?.fotos)
```

## Realtime

`rutas_mpr`, `pedidos_mpr`, `entregas_mpr` y `ubicaciones_mpr` están en la publicación `supabase_realtime`; el panel se suscribe para refrescar el monitoreo. RLS también aplica a lo que llega por ese canal.
