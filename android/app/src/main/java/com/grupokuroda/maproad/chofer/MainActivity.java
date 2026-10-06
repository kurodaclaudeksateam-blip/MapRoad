package com.grupokuroda.maproad.chofer;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * MapRoad Chofer: muestra la app web del chofer (empaquetada dentro del APK, carpeta
 * assets/www) y le da lo que un navegador no puede: ubicación en segundo plano
 * (UbicacionService), cámara para las evidencias y arranque sin conexión.
 *
 * La página se sirve desde un origen https ficticio (HOST) que solo existe dentro
 * de este WebView; nada se descarga de internet salvo las llamadas a Supabase.
 */
public class MainActivity extends Activity {

    private static final String HOST = "app.maproad";
    private static final String INICIO = "https://" + HOST + "/chofer/index.html";
    private static final int REQ_ARCHIVO = 1;
    private static final int REQ_UBICACION = 2;
    private static final int REQ_ALMACEN = 3;

    private static WeakReference<MainActivity> viva = new WeakReference<>(null);

    private WebView web;
    private ValueCallback<Uri[]> respuestaArchivo;
    private Uri fotoPendiente;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        viva = new WeakReference<>(this);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#070B17"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.addJavascriptInterface(new Puente(), "MRNative");
        web.setWebViewClient(new Cliente());
        web.setWebChromeClient(new ClienteChrome());

        if (estado == null) web.loadUrl(INICIO);
        else web.restoreState(estado);

        // Si la ruta seguía en curso y el sistema cerró la app, se retoma el reporte de ubicación.
        if (getSharedPreferences(UbicacionService.PREFS, MODE_PRIVATE).getBoolean(UbicacionService.K_ACTIVO, false)
                && tienePermisoUbicacion()) {
            UbicacionService.iniciar(this, getSharedPreferences(UbicacionService.PREFS, MODE_PRIVATE)
                    .getInt(UbicacionService.K_MINUTOS, 4));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle salida) {
        super.onSaveInstanceState(salida);
        web.saveState(salida);
    }

    @Override
    public void onBackPressed() {
        // "Atrás" cierra primero la hoja abierta (entrega o menú); si no hay, manda la app al fondo
        // sin cerrarla, para no interrumpir una ruta en curso.
        web.evaluateJavascript(
                "(function(){var s=document.querySelector('.sheet-bg');if(s){s.remove();return true;}return false;})()",
                cerro -> {
                    if (!"true".equals(cerro)) moveTaskToBack(true);
                });
    }

    @Override
    protected void onDestroy() {
        if (respuestaArchivo != null) {
            respuestaArchivo.onReceiveValue(null);
            respuestaArchivo = null;
        }
        if (viva.get() == this) viva = new WeakReference<>(null);
        web.destroy();
        super.onDestroy();
    }

    /** Lo llama UbicacionService cada vez que guarda un punto: la página lo recoge y lo sube. */
    static void avisarPunto() {
        MainActivity a = viva.get();
        if (a == null) return;
        a.runOnUiThread(() -> {
            if (a.web != null) a.web.evaluateJavascript("window.MPRNativeTick&&window.MPRNativeTick()", null);
        });
    }

    private boolean tienePermisoUbicacion() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /* ---------- Puente JavaScript (window.MRNative) ---------- */

    private class Puente {
        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean hasLocationPermission() {
            return tienePermisoUbicacion();
        }

        @JavascriptInterface
        public void requestLocationPermission() {
            runOnUiThread(() -> {
                List<String> pedir = new ArrayList<>();
                pedir.add(Manifest.permission.ACCESS_FINE_LOCATION);
                pedir.add(Manifest.permission.ACCESS_COARSE_LOCATION);
                if (Build.VERSION.SDK_INT >= 33) pedir.add(Manifest.permission.POST_NOTIFICATIONS);
                requestPermissions(pedir.toArray(new String[0]), REQ_UBICACION);
            });
        }

        @JavascriptInterface
        public void startTracking(int minutos) {
            runOnUiThread(() -> {
                if (!tienePermisoUbicacion()) return;
                try {
                    UbicacionService.iniciar(MainActivity.this, minutos);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No se pudo iniciar el reporte de ubicación", Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void stopTracking() {
            runOnUiThread(() -> UbicacionService.detener(MainActivity.this));
        }

        @JavascriptInterface
        public String drainLocations() {
            return UbicacionService.vaciarCola(MainActivity.this);
        }

        /** Iguala las barras del sistema al tema elegido en la app (oscuro, claro o multicolor). */
        @JavascriptInterface
        public void setBarColor(String hex, boolean claro) {
            runOnUiThread(() -> {
                try {
                    int c = Color.parseColor(hex);
                    getWindow().setStatusBarColor(c);
                    getWindow().setNavigationBarColor(c);
                    web.setBackgroundColor(c);
                    int flags = claro ? (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : 0;
                    getWindow().getDecorView().setSystemUiVisibility(flags);
                } catch (Exception ignorada) {
                }
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        super.onRequestPermissionsResult(codigo, permisos, resultados);
        if (codigo == REQ_UBICACION) {
            web.evaluateJavascript("window.MPRPermiso&&window.MPRPermiso(" + tienePermisoUbicacion() + ")", null);
            if (!tienePermisoUbicacion()) {
                Toast.makeText(this, "Sin permiso de ubicación no se puede iniciar la ruta. Actívalo en Ajustes > Apps > MapRoad Chofer.",
                        Toast.LENGTH_LONG).show();
            }
        }
    }

    /* ---------- Página empaquetada ---------- */

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("woff2", "font/woff2");
    }

    private class Cliente extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri uri = req.getUrl();
            if (!HOST.equalsIgnoreCase(uri.getHost())) return null; // Supabase y demás: red normal
            String ruta = uri.getPath() == null ? "" : uri.getPath();
            if (ruta.isEmpty() || ruta.endsWith("/")) ruta += "index.html";
            if (ruta.contains("..")) return new WebResourceResponse("text/plain", "UTF-8", 404, "No encontrado", null, null);
            String ext = ruta.contains(".") ? ruta.substring(ruta.lastIndexOf('.') + 1).toLowerCase() : "";
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            try {
                InputStream in = getAssets().open("www" + ruta);
                Map<String, String> cab = new HashMap<>();
                cab.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", cab, in);
            } catch (Exception e) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "No encontrado", null, null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri uri = req.getUrl();
            if (HOST.equalsIgnoreCase(uri.getHost())) return false;
            // Navegar (Google Maps), llamar al cliente (tel:) y cualquier otro enlace salen de la app.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(MainActivity.this, "No hay una app para abrir este enlace", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detalle) {
            recreate();
            return true;
        }
    }

    /* ---------- Fotos de evidencia: cámara o galería ---------- */

    private class ClienteChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> respuesta, FileChooserParams params) {
            if (respuestaArchivo != null) respuestaArchivo.onReceiveValue(null);
            respuestaArchivo = respuesta;

            Intent galeria = new Intent(Intent.ACTION_GET_CONTENT);
            galeria.addCategory(Intent.CATEGORY_OPENABLE);
            galeria.setType("image/*");
            galeria.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

            Intent selector = Intent.createChooser(galeria, "Foto de evidencia");
            Intent camara = intentCamara();
            if (camara != null) selector.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camara});
            try {
                startActivityForResult(selector, REQ_ARCHIVO);
            } catch (ActivityNotFoundException e) {
                respuestaArchivo.onReceiveValue(null);
                respuestaArchivo = null;
                descartarFotoPendiente();
                return false;
            }
            return true;
        }
    }

    /** Cámara del teléfono escribiendo directo en la galería (no requiere permiso de cámara propio). */
    private Intent intentCamara() {
        fotoPendiente = null;
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_ALMACEN);
            return null; // esta vez solo galería; la cámara aparece en el siguiente intento
        }
        try {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, "maproad_" + System.currentTimeMillis() + ".jpg");
            v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            fotoPendiente = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (fotoPendiente == null) return null;
            Intent camara = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camara.putExtra(MediaStore.EXTRA_OUTPUT, fotoPendiente);
            camara.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (camara.resolveActivity(getPackageManager()) == null) {
                descartarFotoPendiente();
                return null;
            }
            return camara;
        } catch (Exception e) {
            fotoPendiente = null;
            return null;
        }
    }

    private void descartarFotoPendiente() {
        if (fotoPendiente == null) return;
        try {
            getContentResolver().delete(fotoPendiente, null, null);
        } catch (Exception ignorada) {
        }
        fotoPendiente = null;
    }

    private boolean tieneContenido(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            return c != null && c.moveToFirst() && c.getLong(0) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onActivityResult(int codigo, int resultado, Intent datos) {
        super.onActivityResult(codigo, resultado, datos);
        if (codigo != REQ_ARCHIVO || respuestaArchivo == null) return;

        List<Uri> elegidos = new ArrayList<>();
        if (resultado == RESULT_OK) {
            if (datos != null && datos.getClipData() != null) {
                for (int i = 0; i < datos.getClipData().getItemCount(); i++) {
                    elegidos.add(datos.getClipData().getItemAt(i).getUri());
                }
            } else if (datos != null && datos.getData() != null) {
                elegidos.add(datos.getData());
            } else if (fotoPendiente != null && tieneContenido(fotoPendiente)) {
                elegidos.add(fotoPendiente); // vino de la cámara
                fotoPendiente = null;
            }
        }
        descartarFotoPendiente(); // si no se usó, no se deja un archivo vacío en la galería
        respuestaArchivo.onReceiveValue(elegidos.isEmpty() ? null : elegidos.toArray(new Uri[0]));
        respuestaArchivo = null;
    }
}
