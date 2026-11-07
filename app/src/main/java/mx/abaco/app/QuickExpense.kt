package mx.abaco.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Notificación fija y silenciosa para anotar un gasto desde la barra de notificaciones.
 *
 * La persona escribe "85 tacos" en la respuesta directa. El texto se guarda en una cola local
 * (SharedPreferences) y la interfaz lo registra como gasto la próxima vez que se abre Ábaco
 * (js/abaco-quick.js lo interpreta y confirma qué se guardó). Así el gasto nunca se pierde,
 * aunque la app esté cerrada.
 */
internal object QuickExpense {
    const val CHANNEL_ID = "abaco_gasto_rapido"
    const val NOTIFICATION_ID = 4242
    const val ACTION_ADD = "mx.abaco.app.action.QUICK_EXPENSE_ADD"
    const val KEY_TEXT = "abaco_quick_text"
    const val EXTRA_OPEN = "abaco_open_panel"

    private const val STORE = "abaco_quick_expense"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_QUEUE = "queue"
    private const val KEY_MESSAGE = "message"
    private const val HINT = "Escribe el monto y qué fue, por ejemplo: 85 tacos"

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    /** Activa por defecto: la persona la pidió y puede apagarla en Ajustes. */
    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
        if (enabled) show(context) else cancel(context)
    }

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Anotar gasto rápido", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Notificación fija y silenciosa para anotar un gasto desde la barra"
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            }
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    private fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Publica (o actualiza) la notificación. Siempre silenciosa. */
    fun show(context: Context) {
        if (!isEnabled(context) || !canNotify(context)) return
        createChannel(context)
        val pending = queue(context).length()
        val text = prefs(context).getString(KEY_MESSAGE, null)
            ?: if (pending > 0) "$pending por guardar · se guardan al abrir Ábaco" else HINT

        val openIntent = Intent(context, MainActivity::class.java).apply {
            putExtra(EXTRA_OPEN, "hormiga")
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val open = PendingIntent.getActivity(context, NOTIFICATION_ID, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        // La respuesta directa necesita un PendingIntent mutable en Android 12+.
        val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val addIntent = Intent(context, QuickExpenseReceiver::class.java).setAction(ACTION_ADD).setPackage(context.packageName)
        val add = PendingIntent.getBroadcast(context, NOTIFICATION_ID + 1, addIntent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
        val input = RemoteInput.Builder(KEY_TEXT).setLabel("Monto y qué fue · 85 tacos").build()
        val action = NotificationCompat.Action.Builder(R.drawable.ic_notification, "Anotar gasto", add)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(false)
            .build()

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Anotar un gasto")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .addAction(action)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        try { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification) } catch (_: SecurityException) { }
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    /** Muestra un mensaje en la notificación (confirmación o aviso) y la vuelve a publicar. */
    fun feedback(context: Context, message: String?) {
        prefs(context).edit().apply { if (message == null) remove(KEY_MESSAGE) else putString(KEY_MESSAGE, message) }.apply()
        show(context)
    }

    private fun queue(context: Context): JSONArray =
        try { JSONArray(prefs(context).getString(KEY_QUEUE, "[]")) } catch (_: Exception) { JSONArray() }

    @Synchronized
    fun enqueue(context: Context, text: String) {
        val list = queue(context)
        list.put(JSONObject().put("id", UUID.randomUUID().toString()).put("text", text).put("at", System.currentTimeMillis()))
        prefs(context).edit().putString(KEY_QUEUE, list.toString()).apply()
    }

    fun pending(context: Context): String = queue(context).toString()

    /** Quita de la cola lo que la interfaz ya guardó (o descartó) y actualiza la notificación. */
    @Synchronized
    fun confirm(context: Context, idsJson: String, message: String?) {
        val ids = try {
            val arr = JSONArray(idsJson)
            (0 until arr.length()).map { arr.optString(it) }.toSet()
        } catch (_: Exception) { emptySet() }
        val list = queue(context)
        val keep = JSONArray()
        for (i in 0 until list.length()) {
            val item = list.optJSONObject(i) ?: continue
            if (item.optString("id") !in ids) keep.put(item)
        }
        prefs(context).edit().putString(KEY_QUEUE, keep.toString()).apply()
        feedback(context, message)
    }
}
