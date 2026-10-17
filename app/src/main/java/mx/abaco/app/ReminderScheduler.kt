package mx.abaco.app

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

internal object ReminderScheduler {
    const val ACTION_SHOW = "mx.abaco.app.action.SHOW_REMINDER"
    const val EXTRA_ID = "reminder_id"
    const val EXTRA_TITLE = "reminder_title"
    const val EXTRA_BODY = "reminder_body"
    const val CHANNEL_ID = "abaco_reminders"
    private const val STORE = "abaco_local_reminders"
    private const val KEY_PREFIX = "reminder_"

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Recordatorios de Ábaco", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Avisos locales de recordatorios"
            }
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    fun schedule(context: Context, id: String, title: String, body: String, whenMillis: Long) {
        if (id.isBlank() || whenMillis <= System.currentTimeMillis()) return
        val data = JSONObject()
            .put(EXTRA_ID, id)
            .put(EXTRA_TITLE, title)
            .put(EXTRA_BODY, body)
            .put("when", whenMillis)
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit()
            .putString(KEY_PREFIX + id, data.toString())
            .apply()
        setAlarm(context, id, title, body, whenMillis)
    }

    fun cancel(context: Context, id: String) {
        if (id.isBlank()) return
        val pending = alarmPendingIntent(context, id, "", "")
        context.getSystemService(AlarmManager::class.java)?.cancel(pending)
        pending.cancel()
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().remove(KEY_PREFIX + id).apply()
        NotificationManagerCompat.from(context).cancel(requestCode(id))
    }

    fun rescheduleAll(context: Context) {
        val now = System.currentTimeMillis()
        val entries = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).all
            .filterKeys { it.startsWith(KEY_PREFIX) }
            .values
            .filterIsInstance<String>()
        entries.forEach { raw ->
            try {
                val data = JSONObject(raw)
                val id = data.optString(EXTRA_ID)
                if (id.isNotBlank()) {
                    val whenMillis = data.optLong("when", now + 1_000L).coerceAtLeast(now + 1_000L)
                    setAlarm(context, id, data.optString(EXTRA_TITLE, "Ábaco · Recordatorio"), data.optString(EXTRA_BODY), whenMillis)
                }
            } catch (_: Exception) { }
        }
    }

    fun show(context: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Ábaco · Recordatorio" }
        val body = intent.getStringExtra(EXTRA_BODY).orEmpty()
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().remove(KEY_PREFIX + id).apply()
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return

        createNotificationChannel(context)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val contentIntent = PendingIntent.getActivity(context, requestCode(id), launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try { NotificationManagerCompat.from(context).notify(requestCode(id), notification) } catch (_: SecurityException) { }
    }

    private fun setAlarm(context: Context, id: String, title: String, body: String, whenMillis: Long) {
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val pending = alarmPendingIntent(context, id, title, body)
        // Inexact, idle-capable alarm: no special exact-alarm access is requested.
        alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenMillis, pending)
    }

    private fun alarmPendingIntent(context: Context, id: String, title: String, body: String): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ACTION_SHOW
            data = Uri.parse("abaco://reminder/" + Uri.encode(id))
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_TITLE, title)
            putExtra(EXTRA_BODY, body)
        }
        return PendingIntent.getBroadcast(context, requestCode(id), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun requestCode(id: String): Int = id.toIntOrNull() ?: id.hashCode()
}
