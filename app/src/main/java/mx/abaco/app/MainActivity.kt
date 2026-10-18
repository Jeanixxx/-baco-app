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
import android.provider.Settings
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.util.Locale
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var contentFrame: FrameLayout
    private lateinit var privacyCover: TextView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var pageReady = false
    private var biometricPromptActive = false
    private var biometricEnrollmentPending = false
    private var appLocked = false

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
        setSystemBarColor("#FAF9F6")
        ReminderScheduler.createNotificationChannel(this)

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#FAF9F6"))
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

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    pageReady = true
                    completeBiometricStartup()
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
        contentFrame = FrameLayout(this)
        contentFrame.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))
        privacyCover = TextView(this).apply {
            text = "Ábaco bloqueado\nConfirma tu identidad para continuar"
            gravity = Gravity.CENTER
            textSize = 16f
            setTextColor(Color.parseColor("#2B4C3F"))
            setBackgroundColor(Color.parseColor("#FAF9F6"))
            visibility = if (isBiometricLockEnabled()) android.view.View.VISIBLE else android.view.View.GONE
        }
        contentFrame.addView(privacyCover, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))
        appLocked = isBiometricLockEnabled()
        setContentView(contentFrame)

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
        } else {
            pageReady = true
            completeBiometricStartup()
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            webView.evaluateJavascript("try { window.dispatchEvent(new Event('blur')); } catch(e) {}", null)
            webView.onPause()
        }
        if (::privacyCover.isInitialized && isBiometricLockEnabled() && !biometricPromptActive) lockApp()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            webView.evaluateJavascript("try { checkReminders(); } catch(e) {}", null)
            if (pageReady && biometricEnrollmentPending && !biometricPromptActive) {
                biometricEnrollmentPending = false
                if (biometricAvailability() == "available") {
                    authenticateBiometric("enable")
                } else {
                    sendBiometricResult("enable", false, "No se registró ninguna huella. Puedes intentarlo de nuevo desde Ajustes.")
                }
            } else if (pageReady && appLocked && isBiometricLockEnabled() && !biometricPromptActive) {
                authenticateBiometric("unlock")
            }
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
        val color = try { Color.parseColor(value) } catch (_: IllegalArgumentException) { Color.parseColor("#FAF9F6") }
        window.statusBarColor = color
        window.navigationBarColor = color
        val lightBars = Color.luminance(color) > 0.55f
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = lightBars
            isAppearanceLightNavigationBars = lightBars
        }
    }

    private fun biometricAvailability(): String = when (
        BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
    ) {
        BiometricManager.BIOMETRIC_SUCCESS -> "available"
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "no_hardware"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none_enrolled"
        else -> "unavailable"
    }

    private fun isBiometricLockEnabled(): Boolean =
        getSharedPreferences(SECURITY_PREFS, MODE_PRIVATE).getBoolean(KEY_BIOMETRIC_LOCK, false)

    private fun completeBiometricStartup() {
        if (!isBiometricLockEnabled()) return
        if (biometricAvailability() == "available") {
            lockApp()
            authenticateBiometric("unlock")
        } else {
            getSharedPreferences(SECURITY_PREFS, MODE_PRIVATE).edit().putBoolean(KEY_BIOMETRIC_LOCK, false).apply()
            appLocked = false
            if (::privacyCover.isInitialized) privacyCover.visibility = android.view.View.GONE
            Toast.makeText(this, "La biometría ya no está disponible. Actívala de nuevo en Ajustes.", Toast.LENGTH_LONG).show()
        }
    }

    private fun lockApp() {
        appLocked = true
        if (::privacyCover.isInitialized) privacyCover.visibility = android.view.View.VISIBLE
    }

    private fun authenticateBiometric(mode: String) {
        if (biometricPromptActive || isFinishing) return
        if (biometricAvailability() != "available") {
            sendBiometricResult(mode, false, "Registra una huella o biometría en los ajustes de Android.")
            return
        }
        biometricPromptActive = true
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                biometricPromptActive = false
                appLocked = false
                if (mode == "enable") {
                    getSharedPreferences(SECURITY_PREFS, MODE_PRIVATE).edit().putBoolean(KEY_BIOMETRIC_LOCK, true).apply()
                }
                if (::privacyCover.isInitialized) privacyCover.visibility = android.view.View.GONE
                sendBiometricResult(mode, true, "")
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                biometricPromptActive = false
                if (mode == "enable") {
                    appLocked = false
                    sendBiometricResult(mode, false, errString.toString())
                } else {
                    lockApp()
                }
            }
        })
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Acceso a Ábaco")
            .setSubtitle("Confirma tu identidad para continuar")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
        prompt.authenticate(promptInfo)
    }

    private fun sendBiometricResult(mode: String, success: Boolean, message: String) {
        if (!::webView.isInitialized) return
        val modeJson = JSONObject.quote(mode)
        val messageJson = JSONObject.quote(message)
        webView.evaluateJavascript(
            "window.onNativeBiometricResult?.($modeJson,$success,$messageJson)",
            null
        )
    }

    private fun setBiometricLock(enabled: Boolean) {
        if (!enabled) {
            biometricEnrollmentPending = false
            getSharedPreferences(SECURITY_PREFS, MODE_PRIVATE).edit().putBoolean(KEY_BIOMETRIC_LOCK, false).apply()
            appLocked = false
            if (::privacyCover.isInitialized) privacyCover.visibility = android.view.View.GONE
            sendBiometricResult("disable", true, "")
            return
        }
        if (biometricAvailability() == "none_enrolled") {
            biometricEnrollmentPending = true
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    startActivity(Intent(Settings.ACTION_BIOMETRIC_ENROLL).putExtra(
                        Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                        BiometricManager.Authenticators.BIOMETRIC_STRONG
                    ))
                } else {
                    startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
                }
            } catch (_: Exception) {
                biometricEnrollmentPending = false
                sendBiometricResult("enable", false, "No se pudieron abrir los ajustes de biometría.")
            }
            return
        }
        if (biometricAvailability() != "available") {
            sendBiometricResult("enable", false, "La biometría no está disponible en este momento.")
            return
        }
        authenticateBiometric("enable")
    }

    private inner class AndroidBridge {
        @JavascriptInterface
        fun biometricAvailability(): String = this@MainActivity.biometricAvailability()

        @JavascriptInterface
        fun biometricLockEnabled(): Boolean = isBiometricLockEnabled()

        @JavascriptInterface
        fun setBiometricLock(enabled: Boolean) {
            runOnUiThread { this@MainActivity.setBiometricLock(enabled) }
        }

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

    companion object {
        private const val SECURITY_PREFS = "abaco_security"
        private const val KEY_BIOMETRIC_LOCK = "biometric_lock_enabled"
    }
}
