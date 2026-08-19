# Consulta pública de solo lectura por Folio de Pedido

`schema.sql` incluye una función `get_informe_por_folio(folio)` pensada para que
**otra página web** consulte el informe de una entrega usando únicamente el
número de folio — de solo lectura, sin poder ver ni listar el resto de la base.

## Cómo se conecta la otra web

Solo necesita dos valores públicos de tu proyecto Supabase (Project Settings → API):
- **Project URL** (ej. `https://xxxxxxxx.supabase.co`)
- **anon / publishable key** (segura de exponer en el frontend de la otra web — el
  acceso real está controlado por RLS + la función, no por esta llave)

### Opción A — con `@supabase/supabase-js`

```js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://xxxxxxxx.supabase.co',
  'TU_ANON_KEY'
)

const { data, error } = await supabase.rpc('get_informe_por_folio', {
  p_folio: 'F1000'
})

if (data?.encontrado) {
  console.log(data.cliente, data.direccion, data.resultado, data.fotos)
} else {
  console.log('No encontrado:', data?.error)
}
```

### Opción B — REST directo (cualquier lenguaje, sin librería)

```bash
curl -X POST 'https://xxxxxxxx.supabase.co/rest/v1/rpc/get_informe_por_folio' \
  -H "apikey: TU_ANON_KEY" \
  -H "Authorization: Bearer TU_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_folio": "F1000"}'
```

Responde un JSON con los mismos campos que ves en el "Informe por Folio de
Pedido" del panel admin de MapRoad (cliente, dirección, chofer, ruta, hora de
llegada/entrega, fotos, firma, documentos), o `{"encontrado": false, ...}` si
el folio no existe.

## Por qué es seguro exponer la anon key

- Row Level Security está **activado y sin políticas** en todas las tablas, así
  que la anon key no puede hacer `SELECT` directo sobre `pedidos`, `entregas`, etc.
- La función está marcada `SECURITY DEFINER`, así que ella sí puede leer, pero
  solo se le dio `GRANT EXECUTE` a `anon` — nunca acceso a las tablas.
- La función siempre devuelve **como máximo un registro** (el del folio pedido),
  nunca una lista.

## Decisión pendiente: folio solo vs. folio + dato de verificación

Tal como se pidió, la función solo requiere el folio (sin teléfono/C.P. como el
tracking interno de MapRoad). Esto es más simple de integrar, pero significa que
cualquiera que tenga o adivine el folio puede ver el informe completo. Si más
adelante se quiere una capa extra de privacidad, basta con:

```sql
create or replace function public.get_informe_por_folio(p_folio text, p_telefono text)
...
  select * into v_pedido from pedidos
  where lower(folio) = lower(trim(p_folio)) and telefono = p_telefono
  limit 1;
...
```

y pedirle ese segundo dato al usuario en la otra web antes de llamar la función.
