package mx.abaco.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

/** Recibe lo que la persona escribió en la notificación y lo deja en la cola. */
class QuickExpenseReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != QuickExpense.ACTION_ADD) return
        val text = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(QuickExpense.KEY_TEXT)
            ?.toString()
            ?.trim()
            .orEmpty()
        if (text.isEmpty() || text.none { it.isDigit() }) {
            QuickExpense.feedback(context, "No vi un monto. Escribe algo como: 85 tacos")
            return
        }
        QuickExpense.enqueue(context, text.take(120))
        // Volver a publicar la notificación cierra el campo de respuesta y muestra la confirmación.
        QuickExpense.feedback(context, "Anotado: «${text.take(60)}». Se guarda al abrir Ábaco.")
    }
}
