# Ábaco · gestor de finanzas personales

Aplicación web para llevar cuentas, gastos, ingresos, préstamos, tarjetas (con meses sin intereses), ahorros, inversiones y suscripciones. Funciona sin servidor: todos los datos quedan en el dispositivo. Se empaqueta como app Android con un WebView local (ver [ANDROID.md](ANDROID.md)).

## Estructura

| Archivo | Responsabilidad |
|---|---|
| `js/abaco-core.js` | Motor financiero: ledger de partida doble, importes en centavos, préstamos, MSI, reversas. Sin DOM. |
| `js/abaco-store.js` | Almacenamiento único en IndexedDB. Un guardado = una transacción. Exportación e importación v3. |
| `js/abaco-migrate.js` | Migración de la versión anterior (localStorage) al ledger. Reproduce el historial con sus fechas. |
| `js/abaco-data.js` | Capa entre motor y pantalla: vista en pesos y operaciones que guardan. |
| `js/abaco-simulate.js` | Simulador puro: suscripciones, deudas, inversiones, metas y MSI. No guarda nada. |
| `js/abaco-app.js` | Controlador de la interfaz: arranque, acciones financieras, copias. |
| `js/abaco-dialog.js` | Diálogos de confirmación y de datos (reemplazan `confirm()` y `prompt()`). |
| `js/app.js` | Interfaz: navegación, pantallas, tablero y datos no financieros. |
| `js/abaco-simulator-ui.js` | Pantalla del simulador. |
| `js/security.js` | Bloqueo opcional con PIN o patrón (solo barrera de acceso local). |
| `js/boot.js` | Arranque mínimo del registro. |

Orden de carga en `index.html`: `boot`, `abaco-core`, `abaco-migrate`, `abaco-store`, `abaco-data`, `abaco-simulate`, `abaco-dialog`, `abaco-app`, `app`, `abaco-simulator-ui`, `security`.

## Datos

- Los importes se guardan en centavos enteros.
- Cada movimiento es una partida doble: lo que sale de una cuenta entra en otra o en una cuenta externa (gastos, ingresos, saldos iniciales). Los saldos se calculan desde ese registro y se verifican al cargar.
- Las preferencias visuales (tema, pestaña activa) siguen en `localStorage`. Los datos financieros nunca.
- Al abrir por primera vez una versión con datos antiguos, la app migra automáticamente. Los datos antiguos quedan intactos en `localStorage`.

## Pruebas

Requiere Node 18 o superior. Las pruebas de la interfaz usan Playwright con el Chromium de `/opt/pw-browsers` (cámbialo con la variable `ABACO_CHROMIUM`).

```bash
node --test tests/core.test.js          # motor financiero
node --test tests/migrate.test.js       # migración
node --test tests/store.test.js         # IndexedDB y migración de extremo a extremo
node --test tests/data.test.js          # capa de datos
node --test tests/simulate.test.js      # simulador
node --test tests/characterization.test.js  # comportamiento de la app
node --test tests/app.test.js           # integración de la interfaz
```

`tests/fixtures/legacy-v2/` es una copia congelada de la app anterior. La prueba de migración la usa para generar datos del formato antiguo.

## Compilar Android

Ver [ANDROID.md](ANDROID.md). Para actualizar una app instalada, usa siempre el APK firmado con la clave de release.
