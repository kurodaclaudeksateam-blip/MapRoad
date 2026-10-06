package com.grupokuroda.maproad.chofer;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Servicio en primer plano que toma la posición de la unidad cada N minutos mientras
 * la ruta está en curso, aunque la pantalla esté apagada o la app en segundo plano.
 *
 * No habla con el servidor: guarda cada punto en una cola local y avisa a la pantalla
 * (MainActivity) para que la app web lo suba junto con lo demás pendiente. Si la
 * pantalla no existe en ese momento, los puntos esperan en la cola.
 */
public class UbicacionService extends Service {

    static final String PREFS = "mpr_gps";
    static final String K_COLA = "cola";
    static final String K_ACTIVO = "activo";
    static final String K_MINUTOS = "minutos";
    private static final String CANAL = "ruta";
    private static final int ID_NOTIF = 41;
    private static final long VENTANA_MS = 40_000;   // tiempo máximo buscando un buen punto
    private static final float PRECISION_OK = 25f;   // metros: con esto ya no se espera más
    private static final int MAX_COLA = 600;

    private static final Object CANDADO = new Object();

    private final Handler reloj = new Handler(Looper.getMainLooper());
    private LocationManager gps;
    private PowerManager.WakeLock despierto;
    private long intervaloMs = 4 * 60_000L;
    private Location mejor;
    private boolean buscando;

    static void iniciar(Context ctx, int minutos) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean(K_ACTIVO, true).putInt(K_MINUTOS, Math.max(1, minutos)).apply();
        Intent i = new Intent(ctx, UbicacionService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void detener(Context ctx) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(K_ACTIVO, false).apply();
        ctx.stopService(new Intent(ctx, UbicacionService.class));
    }

    /** Entrega los puntos acumulados (JSON) y vacía la cola. */
    static String vaciarCola(Context ctx) {
        synchronized (CANDADO) {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
            String cola = p.getString(K_COLA, "[]");
            p.edit().putString(K_COLA, "[]").commit();
            return cola;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        // El sistema puede revivir el servicio (START_STICKY): solo sigue si la ruta continúa.
        if (!p.getBoolean(K_ACTIVO, false) || !tienePermiso()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        intervaloMs = p.getInt(K_MINUTOS, 4) * 60_000L;

        Notification n = notificacion(p.getInt(K_MINUTOS, 4));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID_NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(ID_NOTIF, n);
        }

        if (gps == null) gps = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (despierto == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            despierto = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "maproad:ruta");
            despierto.setReferenceCounted(false);
        }
        if (!despierto.isHeld()) despierto.acquire(16 * 60 * 60 * 1000L); // tope de seguridad: 16 h

        reloj.removeCallbacks(tic);
        reloj.post(tic); // primer punto de inmediato: la unidad aparece en el mapa al iniciar la ruta
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        reloj.removeCallbacksAndMessages(null);
        soltarGps();
        if (despierto != null && despierto.isHeld()) despierto.release();
        super.onDestroy();
    }

    private final Runnable tic = new Runnable() {
        @Override
        public void run() {
            buscarPunto();
            reloj.postDelayed(this, intervaloMs);
        }
    };

    private final LocationListener oyente = new LocationListener() {
        @Override
        public void onLocationChanged(Location l) {
            if (mejor == null || l.getAccuracy() < mejor.getAccuracy()) mejor = l;
            if (l.hasAccuracy() && l.getAccuracy() <= PRECISION_OK) cerrarBusqueda();
        }

        @Override
        public void onStatusChanged(String proveedor, int estado, Bundle extras) {
        }

        @Override
        public void onProviderEnabled(String proveedor) {
        }

        @Override
        public void onProviderDisabled(String proveedor) {
        }
    };

    private final Runnable finVentana = this::cerrarBusqueda;

    /** Enciende GPS y red unos segundos y se queda con el punto más preciso. */
    private void buscarPunto() {
        if (buscando || !tienePermiso()) return;
        buscando = true;
        mejor = null;
        try {
            if (gps.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                gps.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 0, oyente, Looper.getMainLooper());
            }
            if (gps.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                gps.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000, 0, oyente, Looper.getMainLooper());
            }
        } catch (SecurityException | IllegalArgumentException ignorada) {
        }
        reloj.postDelayed(finVentana, VENTANA_MS);
    }

    private void cerrarBusqueda() {
        if (!buscando) return;
        buscando = false;
        reloj.removeCallbacks(finVentana);
        soltarGps();
        Location l = mejor;
        if (l == null) l = ultimaConocidaReciente();
        if (l != null) guardar(l);
    }

    private void soltarGps() {
        try {
            if (gps != null) gps.removeUpdates(oyente);
        } catch (SecurityException ignorada) {
        }
    }

    /** Respaldo cuando no hubo señal en la ventana: último punto del sistema si tiene menos de 2 min. */
    private Location ultimaConocidaReciente() {
        Location mejorCache = null;
        try {
            for (String prov : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                Location l = gps.getLastKnownLocation(prov);
                if (l == null || System.currentTimeMillis() - l.getTime() > 120_000) continue;
                if (mejorCache == null || l.getAccuracy() < mejorCache.getAccuracy()) mejorCache = l;
            }
        } catch (SecurityException ignorada) {
        }
        return mejorCache;
    }

    private void guardar(Location l) {
        try {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            JSONObject o = new JSONObject();
            o.put("lat", l.getLatitude());
            o.put("lng", l.getLongitude());
            o.put("prec", l.hasAccuracy() ? Math.round(l.getAccuracy()) : JSONObject.NULL);
            o.put("vel", l.hasSpeed() ? Math.round(l.getSpeed() * 3.6f * 10) / 10.0 : JSONObject.NULL);
            o.put("rumbo", l.hasBearing() ? Math.round(l.getBearing()) : JSONObject.NULL);
            o.put("hora", iso.format(new Date()));
            synchronized (CANDADO) {
                SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
                JSONArray cola = new JSONArray(p.getString(K_COLA, "[]"));
                cola.put(o);
                while (cola.length() > MAX_COLA) cola.remove(0);
                p.edit().putString(K_COLA, cola.toString()).commit();
            }
        } catch (Exception ignorada) {
        }
        MainActivity.avisarPunto();
    }

    private boolean tienePermiso() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private Notification notificacion(int minutos) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CANAL) == null) {
            NotificationChannel canal = new NotificationChannel(CANAL, "Ruta en curso", NotificationManager.IMPORTANCE_LOW);
            canal.setDescription("Aviso fijo mientras se comparte la ubicación de la unidad");
            canal.setShowBadge(false);
            nm.createNotificationChannel(canal);
        }
        PendingIntent abrir = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CANAL) : new Notification.Builder(this);
        return b.setSmallIcon(R.drawable.ic_camion)
                .setContentTitle("MapRoad · ruta en curso")
                .setContentText("Compartiendo la ubicación de la unidad cada " + minutos + " min")
                .setContentIntent(abrir)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }
}
