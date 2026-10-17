# Ábaco para Android (Kotlin)

La app Android usa un WebView local; el archivo fuente de interfaz sigue siendo Abaco_Gestor_Finanzas.html en la raíz. Gradle lo copia a los assets en cada build, así que no hay una segunda copia del HTML que pueda quedar desactualizada.

## Funciones Android

- Recordatorios locales del sistema, programados en el dispositivo con AlarmManager. No necesitan servidor ni conexión a Internet y pueden aparecer con Ábaco cerrada.
- Los recordatorios se restauran al reiniciar el teléfono o actualizar la app. Android puede retrasar las alarmas inexactas durante ahorro de batería; Ábaco no solicita el acceso especial a alarmas exactas.
- Android 13 o posterior solicita permiso de notificaciones cuando se crea un recordatorio. Si se deniega, el sistema no mostrará avisos hasta concederlo; Ábaco conserva su aviso al volver a abrir la app.
- Vibración háptica, color de las barras del sistema y manejo del botón Atrás.
- Exportación de respaldos JSON mediante el menú nativo para compartir e importación con el selector de archivos.
- Los datos y recordatorios quedan en el almacenamiento privado local de la app; no se añade backend ni sincronización remota. La exportación solo comparte datos cuando la persona pulsa Exportar.

## Compilar

Requisitos: JDK 17, Android SDK con la plataforma 35 y Gradle 8.10.2. Desde la raíz del repositorio, ejecuta:

gradle --no-daemon :app:assembleDebug

El APK de prueba queda en app/build/outputs/apk/debug/app-debug.apk. El workflow de GitHub Actions compila el mismo APK en cada push a main o a la rama de integración, y en cada pull request a main. Descárgalo desde el artefacto abaco-android-debug-apk de la ejecución de Actions. Es un APK de depuración para probar; no es una versión firmada para publicar en Google Play.
