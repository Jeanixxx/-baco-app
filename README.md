# Ábaco — Gestor de Finanzas

Aplicación basada en la interfaz HTML principal `Abaco_Gestor_Finanzas.html`, con envolturas nativas para Android e iOS.

## Compilaciones automáticas con GitHub Actions

Los flujos están configurados para ejecutarse al actualizar las ramas de trabajo incluidas en sus archivos y también pueden iniciarse manualmente desde la pestaña **Actions** de GitHub.

### Android

- Flujo: [Build Android APK](.github/workflows/android-apk.yml)
- Artefacto: `abaco-android-debug-apk`
- Archivo esperado: `app-debug.apk`
- Es una compilación **debug** para pruebas; no es una versión release firmada para publicar en Google Play.

### iOS

- Flujo: [Build iOS IPA](.github/workflows/ios-ipa.yml)
- Artefacto: `abaco-ios-unsigned-ipa`
- Archivos esperados: `Abaco-iOS-unsigned.ipa` y la aplicación `.app` compilada.
- El flujo usa macOS/Xcode y copia la interfaz HTML actual a los recursos del proyecto iOS antes de compilar.
- El IPA generado es **sin firma**. Para instalarlo en un iPhone físico o distribuirlo mediante TestFlight/App Store hace falta configurar firma de Apple, certificado y perfil de aprovisionamiento. No se deben guardar certificados privados en el repositorio; se deben configurar como secretos protegidos de GitHub Actions.

### Descargar los archivos

1. Abre la pestaña **Actions** del repositorio.
2. Selecciona la ejecución del flujo que terminó.
3. Espera a que el estado indique que finalizó correctamente.
4. Descarga el artefacto de Android o iOS en la sección **Artifacts**.

Los artefactos de estos flujos se conservan durante 14 días. La primera ejecución debe revisarse en Actions para confirmar que las dependencias y el proyecto compilan correctamente.

## Proyecto iOS

El proyecto de Xcode se genera desde `ios/project.yml` usando XcodeGen. La aplicación carga la interfaz local desde `index.html` y conserva el código Swift existente para la integración de seguridad biométrica. Las funciones que dependan de APIs exclusivas de Android requieren implementación y pruebas específicas en iOS.
