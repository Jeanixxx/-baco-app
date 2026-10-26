# Ábaco para Android (Kotlin)

La app Android usa un WebView local. La interfaz está separada en `index.html`, `styles.css`, `js/boot.js`, `js/app.js` y `js/security.js`. Gradle copia estos archivos al directorio de assets en cada build; las rutas relativas se mantienen y el HTML antiguo `Abaco_Gestor_Finanzas.html` redirige a `index.html`.

## Funciones Android

- Recordatorios locales del sistema, programados en el dispositivo con AlarmManager. No necesitan servidor ni conexión a Internet y pueden aparecer con Ábaco cerrada.
- Los recordatorios se restauran al reiniciar el teléfono o actualizar la app. Android puede retrasar las alarmas inexactas durante ahorro de batería; Ábaco no solicita el acceso especial a alarmas exactas.
- Android 13 o posterior solicita permiso de notificaciones cuando se crea un recordatorio. Si se deniega, el sistema no mostrará avisos hasta concederlo; Ábaco conserva su aviso al volver a abrir la app.
- Vibración háptica, color de las barras del sistema y manejo del botón Atrás.
- Exportación de respaldos JSON mediante el menú nativo para compartir e importación con el selector de archivos.
- Los datos y recordatorios quedan en el almacenamiento privado local de la app; no se añade backend ni sincronización remota. La exportación solo comparte datos cuando la persona pulsa Exportar.
- En el menú se puede configurar opcionalmente un PIN de 4 a 8 dígitos o un patrón de al menos 4 puntos. Ábaco guarda una derivación PBKDF2 con sal aleatoria, no el PIN/patrón original, y solicita desbloqueo al volver a abrirse. Esta capa es una barrera de acceso local; no sustituye el cifrado del dispositivo ni protege frente a alguien con acceso técnico al almacenamiento de la app.

## Compilar

Requisitos: JDK 17, Android SDK con la plataforma 35 y Gradle 8.10.2. Desde la raíz del repositorio, ejecuta:

gradle --no-daemon :app:assembleDebug

El APK de prueba queda en app/build/outputs/apk/debug/app-debug.apk. El workflow de GitHub Actions compila el mismo APK en cada push a main o a la rama de integración, y en cada pull request a main. Descárgalo desde el artefacto abaco-android-debug-apk de la ejecución de Actions. Es un APK de depuración para probar; no es una versión firmada para publicar en Google Play.
