# MapRoad

Prototipo funcional de una app web para **control de unidades, choferes, rutas y entregas**, con **tracking público para clientes**. Todo corre en un único archivo (`index.html`, con CSS y JS embebidos) usando `localStorage` como base de datos, pensado para migrarse después a **Supabase** sin rediseñar la app.

## Cómo probarlo

Abre `index.html` con un servidor local (no funciona como `file://` porque `localStorage` se deshabilita en ese modo):

```bash
npx serve MapRoad -l 8766
```

o con el `serve.ps1` incluido (PowerShell, sin dependencias):

```bash
powershell -File MapRoad/serve.ps1 -Port 8766
```

Luego abre `http://localhost:8766`.

## Diseño visual

La paleta, tipografía (Open Sans) y estilo de tarjetas/sidebar/botones están
adaptados del look de [Argon Dashboard PRO (Material UI)](https://demos.creative-tim.com/argon-dashboard-pro-material-ui/)
— solo el estilo/UX (colores, radios, sombras, layout), sin usar ningún asset
ni código de ese sitio.

**Imagen del encabezado (banner de bienvenida del Dashboard):** vive en
[`assets/header-vehicle.svg`](assets/header-vehicle.svg) — es una ilustración
propia (no la del sitio de referencia). Para cambiarla, sube tu propia imagen
a esa misma ruta desde GitHub (mismo nombre de archivo, o cambia la ruta en el
`<img>` dentro de `viewDashboard()` en `index.html`). Se muestra a la mitad
(50%) de su ancho natural y es responsiva (se reduce más en móvil).

## Accesos de prueba

| Usuario   | Contraseña  | Rol      | Vista |
|-----------|-------------|----------|-------|
| admin     | admin123    | admin    | Panel completo + usuarios |
| trafico   | trafico123  | trafico  | Panel operativo (sin gestión de usuarios) |
| chofer1/2/3 | chofer123 | chofer   | App móvil de ruta (solo choferes) |

También hay un enlace público **"Rastrear un pedido"** (sin login) para el tracking de clientes.

## Módulos

1. **Panel de control de unidades** — CRUD de vehículos (placa, capacidad, estatus, centro, chofer asignado).
2. **Control de choferes** — CRUD de choferes + alta de su acceso a la app móvil.
3. **Asignación de tiendas por chofer** — tabla de puntos de entrega con asignación por dropdown, filtrable por centro.
4. **Centros / razón social** — administra depósitos (con lat/lng de origen) y su razón social.
5. **Cargar rutas del día** — importa un `.xlsx`/`.csv` con las columnas del pedido (Folio, Vehículo, Cliente, dirección, coordenadas, pesos, fechas de entrega, etc.), agrupa por Folio (multi-artículo) y por Vehículo, y genera una ruta optimizada por vehículo/chofer. Antes de generar, muestra una tabla de **verificación**: qué vehículo del archivo se mapea a qué unidad/chofer registrado (editable si no hubo match automático) y qué pedidos tienen datos faltantes (ej. coordenadas), con un botón ✎ para corregirlos ahí mismo. Ya generada, cada ruta se puede volver a abrir desde **Monitoreo** (✎ "Editar ruta") para reasignar chofer/unidad, corregir dirección/teléfono/coordenadas de un pedido, o recalcular el orden óptimo.
6. **Optimización de ruta** — heurística de vecino más cercano que penaliza giros a la derecha (aprox. al enfoque de Amazon de preferir seguir de frente / girar a la izquierda), usando el rumbo (bearing) entre paradas consecutivas. No usa red vial real, solo geometría de línea recta — para producción se recomienda un motor de ruteo real (OSRM, Google Routes API, etc.).
7. **App del chofer (móvil)** — login exclusivo, ve su ruta del día en orden optimizado, botón "Navegar" que abre Google Maps con el destino. Al llegar al domicilio debe presionar **"Confirmar llegada"** antes de poder registrar la entrega — eso separa el tiempo de traslado del tiempo en el sitio. Luego registra la entrega (hasta 10 fotos, firma en canvas, documentos, resultado/motivo) y avanza automáticamente a la siguiente parada. Al terminar solicita concluir la ruta (con validación opcional de geolocalización contra el centro de retorno), calculando duración total, tiempo en traslado, tiempo en sitio (promedio y total) y % de eficiencia.
8. **Tracking del cliente** — acceso público con Folio + teléfono/C.P. (para no exponer el pedido a cualquiera). Muestra el progreso como pasos (sin coordenadas exactas — se difumina la posición para no revelar el punto anterior real de la unidad) y una hora estimada de entrega calculada a partir del tiempo histórico promedio por parada de ese chofer.
9. **Monitoreo en tiempo real** — mapa real (Leaflet + tiles de OpenStreetMap, gratuito, sin API key) con la ruta de cada chofer en un color distinto sobre el mapa de México, tabla de estatus con filtros por chofer/unidad/centro/estatus/fecha. Se actualiza entre pestañas del mismo navegador vía el evento `storage`.
10. **Histórico y estadísticas** — rutas de días anteriores con filtros por cualquier campo, duración, % de éxito y tiempo promedio por parada.
11. **Usuarios y accesos** (solo admin) — alta de usuarios y su rol.

## Diseño de datos (pensado para Supabase)

Todo el acceso a datos pasa por el objeto `DB` (ver `index.html`), con 5 métodos que reflejan 1:1 las llamadas de un cliente de Supabase:

```js
DB.get(tabla)         // ≈ supabase.from(tabla).select('*')
DB.insert(tabla, obj) // ≈ supabase.from(tabla).insert(obj)
DB.update(tabla,id,p) // ≈ supabase.from(tabla).update(p).eq('id', id)
DB.remove(tabla, id)  // ≈ supabase.from(tabla).delete().eq('id', id)
DB.query(tabla, fn)   // ≈ supabase.from(tabla).select('*') + filtro en cliente
```

Las tablas usadas hoy en `localStorage` (`maproad_*`) son: `usuarios`, `unidades`, `choferes`, `tiendas`, `centros`, `pedidos`, `rutas`, `entregas`. Migrar a Supabase implica:

- Crear estas tablas en Postgres (mismos campos) — el esquema completo ya está listo en [`supabase/schema.sql`](supabase/schema.sql).
- Reemplazar la implementación de `DB` por llamadas async al cliente `@supabase/supabase-js`.
- Mover fotos/firmas/documentos de *dataURL en localStorage* a **Supabase Storage** (el prototipo ya comprime las fotos a JPEG antes de guardarlas, pero `localStorage` tiene un límite de ~5-10MB).
- El mapa ya usa Leaflet + OpenStreetMap (gratuito); si se requiere navegación/tráfico en vivo se puede cambiar a Google Maps/Mapbox sin tocar el resto de la app (mismas coordenadas).
- Sustituir el algoritmo de optimización por uno basado en una API de ruteo real (OSRM, Google Routes API) si se requiere precisión en calles/tráfico.

### Consulta pública de solo lectura por Folio (para otra web)

`supabase/schema.sql` incluye la función `get_informe_por_folio(folio)`: permite
que **otra página web**, usando solo la llave pública (anon) de tu proyecto
Supabase, consulte el mismo informe que ves en "Histórico → Informe por Folio
de Pedido" — de solo lectura, buscando **únicamente por número de folio** (sin
pedir teléfono/C.P. como el tracking interno). Row Level Security queda cerrado
en todas las tablas; la función es la única puerta, y solo devuelve un folio a
la vez, nunca una lista. Instrucciones de conexión (JS y REST puro) en
[`supabase/README.md`](supabase/README.md).

## Columnas esperadas en el archivo de rutas

```
Folio de Pedido, Vehiculo, Nombre de Item, Cantidad, Codigo de Item, Numero del Cliente,
Nombre del Contacto, Telefono, Email del Contacto, Dirección, Colonia, C.P., Latitud, Longitud,
Fecha Minima Entrega, Fecha Maxima Entrega, Control de Destino, Oficina de Ventas,
Sucursal que Solicita, Nombre del Vendedor, Comentarios, Folio de Factura,
Peso Total en KG, Volumen Total en M3, Importe Total Factura
```

Filas con el mismo "Folio de Pedido" se agrupan como una sola parada con varios artículos.

## Dependencias

Dos recursos externos por CDN, ambos gratuitos y sin API key: [SheetJS](https://sheetjs.com/) (`xlsx.full.min.js`, para leer `.xlsx` en el navegador — los `.csv` se parsean sin dependencias) y [Leaflet](https://leafletjs.com/) con tiles de [OpenStreetMap](https://www.openstreetmap.org/copyright) para los mapas (monitoreo y tracking).

## Estado del prototipo

Es un prototipo funcional para validar el flujo completo antes de invertir en backend. Limitaciones conocidas a resolver en la versión con Supabase:
- Sin encriptación de contraseñas (login solo para demo).
- Sin sincronización multi-dispositivo real (solo localStorage del navegador; el evento `storage` sincroniza pestañas del mismo navegador, no dispositivos distintos).
- El "tiempo real" del monitoreo depende de que el chofer use la app en el mismo navegador/perfil; con Supabase esto se resuelve con *Realtime subscriptions*.
