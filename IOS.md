# Ábaco para iPhone

El workflow **Build iOS App** compila la app en un runner macOS cada vez que se actualiza una de las ramas configuradas, cuando se abre un pull request a `main`, o al iniciarlo desde GitHub Actions.

Siempre publica el artefacto `abaco-iphone-simulator`. Es una compilación sin firma para el simulador de iOS; **no se instala en un iPhone físico**.

Para que GitHub Actions exporte también `abaco-iphone-ipa`, configura en el repositorio, en **Settings → Secrets and variables → Actions**, estos secretos:

- `IOS_CERTIFICATE_BASE64`: certificado de distribución de Apple exportado como `.p12` y codificado en Base64.
- `IOS_CERTIFICATE_PASSWORD`: contraseña del `.p12`.
- `IOS_PROVISIONING_PROFILE_BASE64`: perfil de aprovisionamiento Ad Hoc para el identificador `mx.abaco.app`, codificado en Base64.
- `IOS_TEAM_ID`: identificador de tu equipo de Apple Developer.

Se requiere una cuenta de Apple Developer y un perfil Ad Hoc que incluya los dispositivos autorizados. Los secretos se usan solo en el runner macOS; no los pegues en el chat. Si faltan o están incompletos, el workflow conserva la compilación del simulador y omite la IPA.

La app carga `Abaco_Gestor_Finanzas.html` desde el paquete y usa Face ID o Touch ID del dispositivo para el acceso biométrico.
