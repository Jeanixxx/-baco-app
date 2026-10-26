package mx.abaco.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ReminderScheduler.ACTION_SHOW) ReminderScheduler.show(context, intent)
    }
}
