/* MapRoad — configuración compartida por el panel web (index.html) y la app del
   chofer (chofer/index.html, que también va dentro del APK).
   Las llaves de aquí son PÚBLICAS (publishable/anon): el acceso real lo controlan
   las políticas RLS y las funciones mpr_* del proyecto de Supabase. */
window.MPR_CONFIG = {
  // Proyecto "gk-control-operativo-entregas" — tablas con sufijo _mpr
  supabaseUrl: 'https://mhmqgjgfkcrgbtrhmtqw.supabase.co',
  supabaseKey: 'sb_publishable_up1bYZnUEh0JxdhfBIRTUQ_FO2jrb4X',
  // Dirección pública del panel web: se usa en el correo "tu pedido va en camino"
  // para armar el enlace de rastreo (#/tracking?folio=...).
  webUrl: 'https://kurodaclaudeksateam-blip.github.io/MapRoad/',
  // Aviso por correo al iniciar ruta (Edge Function notificar-inicio-ruta, en el
  // proyecto donde viven sus credenciales de Gmail/Resend). url vacío = desactivado.
  notifUrl: 'https://jtgungaomigzfzvxwrtc.supabase.co/functions/v1/notificar-inicio-ruta',
  notifKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0Z3VuZ2FvbWlnemZ6dnh3cnRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjM3NzAsImV4cCI6MjEwMjYzOTc3MH0.xEWemrDgziselIo7DaxgMmgaI7dBEHOfSlK_NgBQlzY',
  // Dominio interno de los usuarios creados sin correo real (usuario@dominio).
  dominioInterno: 'mpr.kuroda.com',
  dominioCorporativo: 'kuroda.com',
  // Cada cuánto reporta su posición la app del chofer durante la ruta.
  minutosUbicacion: 4,
  apkUrl: 'apk/MapRoadChofer.apk'
};
