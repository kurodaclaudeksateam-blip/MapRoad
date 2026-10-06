# MapRoad

Control de rutas de envío de mercancía para varias **sociedades (razones sociales)**, cada una con sus **centros** y **CEDIS**: unidades, choferes, rutas del día, entregas con evidencia, monitoreo en vivo con GPS y rastreo público para el cliente.

| Pieza | Dónde vive | Para quién |
|-------|-----------|------------|
| Panel web | [`index.html`](index.html) | Administrador, usuarios por sociedad / centro, observador de auditoría |
| App del chofer | [`chofer/index.html`](chofer/index.html) — la misma página va dentro del APK | Choferes |
| APK Android | [`apk/MapRoadChofer.apk`](apk/MapRoadChofer.apk) (fuente en [`android/`](android/)) | Choferes |
| Base de datos | Supabase, proyecto `gk-control-operativo-entregas` — [`supabase/schema_mpr.sql`](supabase/schema_mpr.sql) | — |

La app arranca **en blanco**: sin datos de ejemplo. El único usuario inicial es el administrador `fcerezo` (su cuenta de Supabase Auth `fcerezo@kuroda.com`, con su contraseña de siempre).

## Primeros pasos (con el panel vacío)

1. Entra al panel con `fcerezo`.
2. **Configuración → Sociedades**: da de alta cada razón social.
3. **Configuración → Centros y CEDIS**: crea los centros de cada sociedad (tipo *Centro* o *CEDIS*).
4. **Operación**: unidades, choferes y tiendas (marca como *punto de salida* las sucursales/CEDIS desde donde parten rutas; llevan coordenadas obligatorias).
5. **Configuración → Usuarios y roles**: crea los accesos (ver roles abajo). Para un chofer: primero el chofer en *Control de choferes*, luego su usuario con rol *Chofer* vinculado.
6. **Cargar rutas del día**: sube el Excel; cada vehículo del archivo se convierte en una ruta optimizada.
7. El chofer instala el APK, entra con su usuario y presiona **Salir de la sucursal e iniciar ruta**.

## Roles

| Rol | Qué ve | Qué puede cambiar |
|-----|--------|-------------------|
| **Administrador** | Todo | Todo; es el único que crea usuarios y sociedades |
| **Por sociedad** | Los centros de su razón social y todo lo que cuelga de ellos | Lo de sus centros (incluye crear centros de su sociedad) |
| **Por centro** | Solo su centro / CEDIS | Unidades, choferes, tiendas, rutas y pedidos de su centro |
| **Chofer** | Solo su ruta del día, y solo desde la app móvil | Registra salida, llegadas, entregas y fin de ruta |
| **Observador de auditoría** | Todo, más la bitácora | Nada (solo lectura) |

El alcance no depende de la interfaz: lo imponen las políticas **RLS** de Postgres (`mpr_ve_centro`, `mpr_edita_centro`). Ocultar botones en el panel es solo comodidad.

Los usuarios se crean desde el panel a través de la Edge Function [`usuarios-mpr`](supabase/functions/usuarios-mpr/index.ts), que verifica que quien llama sea administrador. Un usuario sin correo real entra solo con su nombre de usuario (internamente `usuario@mpr.kuroda.com`).

> **Proyecto compartido.** El proyecto de Supabase también aloja Control Operativo y otras apps. Todo lo de MapRoad lleva sufijo `_mpr` (tablas, bucket `evidencias-mpr`) o prefijo `mpr_` (funciones) y no toca nada existente. Como ese proyecto crea un perfil de Control Operativo por cada cuenta nueva de Auth, `usuarios-mpr` deja ese perfil **inactivo** para las cuentas que crea MapRoad. Al eliminar un usuario solo se borra la cuenta de Auth si es interna de MapRoad; a una cuenta con correo real solo se le retira el acceso.

## App del chofer y ubicación en vivo

- Al entrar, la app **descarga una sola vez** la ruta del día (`mpr_chofer_ruta`) y la guarda en el teléfono; desde ahí trabaja local, también sin señal.
- Lo que pasa en la ruta (salida, llegadas, entregas, fin, puntos GPS) se guarda en una cola local y se sube **en lote** con una sola llamada (`mpr_chofer_sync`): al cerrar cada entrega y en cada reporte de ubicación. Sin conexión, espera y se envía al volver la señal. No hay consultas a tablas ni canales abiertos desde el teléfono.
- Al iniciar la ruta, la unidad aparece en **Monitoreo en vivo** y la app reporta su posición **cada 4 minutos** hasta concluirla. En el APK lo hace un servicio en primer plano (con notificación fija), así que funciona con la pantalla apagada; en navegador solo mientras la pestaña esté abierta.
- En el mapa cada chofer tiene su color: línea punteada = plan, línea continua = recorrido real, 🚚 = última posición (se pone gris si lleva más de 12 min sin señal).
- Fotos y firma se suben a Storage (`evidencias-mpr`) y en la base solo queda la URL.
- Tres temas: oscuro, claro y multicolor, estilo *liquid glass*, adaptable a teléfono y tableta.

El intervalo se cambia en [`config.js`](config.js) (`minutosUbicacion`) y requiere recompilar el APK.

### Compilar el APK

```bash
cd android && gradle assembleRelease
```

Requiere `android/local.properties` (ruta del SDK) y `android/keystore.properties` (llave de firma); ninguno se sube al repositorio. La compilación empaqueta `chofer/`, `vendor/` y `config.js` tal como están en el repo. Al publicar una versión nueva, sube `versionCode` en `android/app/build.gradle` y copia el resultado a `apk/MapRoadChofer.apk`.

## Módulos del panel

- **Resumen** — rutas y pedidos de hoy, flota, rutas en curso sin señal GPS.
- **Monitoreo en vivo** — mapa (Leaflet + OpenStreetMap) y tabla de avance; se actualiza solo (Supabase Realtime).
- **Histórico y estadísticas** — filtros por fecha, chofer, unidad, centro y folio; informe por folio con evidencia; exportación a CSV.
- **Cargar rutas del día** — importa `.xlsx`/`.csv`, valida coordenadas, asigna vehículo → unidad/chofer y genera rutas optimizadas desde la tienda de origen. Incluye plantilla descargable y hoja *Detalle* para el checklist de artículos.
- **Unidades, choferes, tiendas** — catálogos por centro.
- **Configuración** — sociedades, centros y CEDIS, usuarios y roles, **bitácora de auditoría** (quién cambió qué y cuándo; la llenan triggers en la base).
- **Rastreo público** (`#/tracking`) — el cliente consulta con su folio; ve avance, hora estimada, zona aproximada (nunca la posición exacta) y fotos de entrega (nunca la firma).

Columnas del archivo de rutas:

```
Folio de Pedido, Vehiculo, Nombre de Item, Cantidad, Codigo de Item, Numero del Cliente,
Nombre del Contacto, Telefono, Email del Contacto, Dirección, Colonia, C.P., Latitud, Longitud,
Fecha Minima Entrega, Fecha Maxima Entrega, Control de Destino, Oficina de Ventas,
Sucursal que Solicita, Nombre del Vendedor, Comentarios, Folio de Factura,
Peso Total en KG, Volumen Total en M3, Importe Total Factura
```

## Publicación

El panel es estático (sin compilación): basta servir la raíz del repositorio por HTTPS — por ejemplo GitHub Pages (Settings → Pages → rama `master`, carpeta `/`). Si la dirección final no es `https://kurodaclaudeksateam-blip.github.io/MapRoad/`, cámbiala en `config.js` (`webUrl`): se usa en el enlace de rastreo del correo al cliente.

Para probar en local:

```bash
python -m http.server 8766
```

## Aviso por correo al iniciar ruta

Cuando el chofer inicia la ruta, la app llama a la Edge Function [`notificar-inicio-ruta`](supabase/functions/notificar-inicio-ruta/index.ts) (vive en el proyecto `jtgungaomigzfzvxwrtc`, donde están sus credenciales de Gmail/Resend en Vault), que escribe a cada cliente con su folio, hora estimada y el enlace de rastreo. El resultado se ve en el detalle de la ruta. Se desactiva dejando `notifUrl` vacío en `config.js`.

## Dependencias

[SheetJS](https://sheetjs.com/) y [Leaflet](https://leafletjs.com/) por CDN (solo el panel); [supabase-js](https://github.com/supabase/supabase-js) incluido en `vendor/` para que la app del chofer abra sin conexión.
