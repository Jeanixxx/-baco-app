package mx.abaco.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    private val backupPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        pendingFileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        pendingFileCallback = null
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) Toast.makeText(this, "Activa las notificaciones para recibir recordatorios", Toast.LENGTH_LONG).show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setSystemBarColor("#EAEFF5")
        ReminderScheduler.createNotificationChannel(this)

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#EAEFF5"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.scheme == "http" || uri.scheme == "https") {
                        return try {
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                            true
                        } catch (_: Exception) {
                            false
                        }
                    }
                    return false
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: WebChromeClient.FileChooserParams?
                ): Boolean {
                    if (filePathCallback == null) return false
                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = filePathCallback
                    return try {
                        backupPicker.launch("application/json")
                        true
                    } catch (_: Exception) {
                        pendingFileCallback = null
                        false
                    }
                }
            }
        }
        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "if (typeof window.handleAndroidBack === 'function') { window.handleAndroidBack(); }",
                    null
                )
            }
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl("file:///android_asset/index.html")
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            webView.evaluateJavascript("try { window.dispatchEvent(new Event('blur')); } catch(e) {}", null)
            webView.onPause()
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            webView.evaluateJavascript("try { checkReminders(); } catch(e) {}", null)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("AndroidBridge")
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun requestNotificationPermissionFromBridge() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun setSystemBarColor(value: String) {
        val color = try { Color.parseColor(value) } catch (_: IllegalArgumentException) { Color.parseColor("#EAEFF5") }
        window.statusBarColor = color
        window.navigationBarColor = color
        val lightBars = Color.luminance(color) > 0.55f
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = lightBars
            isAppearanceLightNavigationBars = lightBars
        }
    }

    private inner class AndroidBridge {
        @JavascriptInterface
        fun requestNotificationPermission() {
            runOnUiThread { requestNotificationPermissionFromBridge() }
        }

        @JavascriptInterface
        fun scheduleLocalNotification(id: String, title: String, body: String, whenMillis: Long) {
            ReminderScheduler.schedule(this@MainActivity, id, title, body, whenMillis)
        }

        @JavascriptInterface
        fun cancelLocalNotification(id: String) {
            ReminderScheduler.cancel(this@MainActivity, id)
        }

        @JavascriptInterface
        fun hapticTap(style: String?) {
            val duration = when (style?.uppercase(Locale.ROOT)) {
                "HEAVY" -> 28L
                "MEDIUM" -> 18L
                else -> 10L
            }
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                (getSystemService(VIBRATOR_SERVICE) as? Vibrator)
            } ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(duration)
            }
        }

        @JavascriptInterface
        fun setStatusBarColor(color: String) {
            runOnUiThread { setSystemBarColor(color) }
        }

        @JavascriptInterface
        fun shareBackup(filename: String, json: String) {
            Thread {
                try {
                    val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_")
                    val folder = File(cacheDir, "backups").apply { mkdirs() }
                    val backup = File(folder, safeName)
                    backup.writeText(json, Charsets.UTF_8)
                    val uri = FileProvider.getUriForFile(this@MainActivity, "${packageName}.fileprovider", backup)
                    val sendIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        clipData = ClipData.newUri(contentResolver, safeName, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    runOnUiThread {
                        startActivity(Intent.createChooser(sendIntent, "Compartir copia de Ábaco"))
                    }
                } catch (_: Exception) {
                    runOnUiThread { Toast.makeText(this@MainActivity, "No se pudo compartir la copia", Toast.LENGTH_LONG).show() }
                }
            }.start()
        }
    }
}
