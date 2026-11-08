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
| `js/abaco-dialog.js` | Diálogos de confirmación y de datos con campos de texto, lista y área de texto (reemplazan `confirm()` y `prompt()`). |
| `js/abaco-sky.js` | Cielo del día: paleta por hora, sol y luna que cruzan la pantalla, tema claro/oscuro automático. Parte pura probada en Node. |
| `js/abaco-extras.js` | Lógica pura de convivencia: equivalencias, pausa, decisiones, pactos, cartas, préstamos entre sobres, preguntas, medidas, silencio y brújula. |
| `js/abaco-shell.js` | Estructura del rediseño: cabecera de título grande (se compacta al desplazar), formularios como hojas inferiores, ayuda desde el menú. |
| `js/abaco-calm.js` | Modo calmado: Inicio «Hoy, solo tres cosas», Registrar en dos pasos, Sobres y Tarjetas con hoja de detalle, menú con lo que más usas. |
| `js/abaco-quick.js` | Gastos anotados desde la notificación de Android: interpreta «85 tacos», guarda con su hora y confirma a Android. |
| `js/abaco-extras-ui.js` | Interfaz de convivencia: avisos de Inicio, brújula flotante, pausa antes de pagar y las pantallas Estadísticas, Decisiones, Pactos, Cartas y Configuración. |
| `styles.css` | Una sola hoja de estilo: variables de cristal (claro de día, oscuro de noche), componentes y cielo. |
| `js/app.js` | Interfaz: navegación, pantallas, tablero y datos no financieros. |
| `js/abaco-simulator-ui.js` | Pantalla del simulador. |
| `js/security.js` | Bloqueo opcional con PIN o patrón (solo barrera de acceso local). |
| `js/boot.js` | Arranque mínimo del registro. |

Orden de carga en `index.html`: `boot`, `abaco-sky`, `abaco-extras`, `abaco-core`, `abaco-migrate`, `abaco-store`, `abaco-data`, `abaco-simulate`, `abaco-dialog`, `abaco-app`, `app`, `abaco-simulator-ui`, `abaco-delegate`, `abaco-shell`, `abaco-calm`, `abaco-quick`, `abaco-extras-ui`, `security`. La tipografía Inter viene en `fonts/` para funcionar sin internet.

## Diseño: ciclo del día y convivencia

- **Cielo.** El fondo sigue la hora: amanecer, mañana, tarde, atardecer y noche. El sol cruza de 6:00 a 19:30 y después entra la luna hasta las 6:00. El tema es claro de día y oscuro de noche. El botón *Tema* del menú alterna automático, día fijo y noche fija (`theme_mode`).
- **Cristal.** Las tarjetas, la cabecera, el menú, los diálogos y la barra inferior son cristal translúcido con desenfoque.
- **Convivencia.** Informar con cifras, ofrecer opciones, dejar decidir, no culpar. Lo que la persona elige vive en `state.extras` y se guarda con el resto de los datos no financieros (y viaja en la copia de seguridad):
  - *Equivalencias*: si elige una unidad (café, cine, comida, pasaje o una propia), cada gasto muestra "Son 3 cafés". Por defecto no compara nada.
  - *Pausa antes de pagar*: en compras marcadas "fue por impulso" espera unos segundos; "Mejor no" lo anota como decisión, sin reproche.
  - *Cajón de decisiones*: compras grandes con su motivo; meses después pregunta si valió la pena.
  - *Pactos*: acuerdos con uno mismo que la persona marca como cumplidos o rotos.
  - *Cartas*: al cerrar el mes se escribe una carta corta; se puede guardar, editar o borrar (borrar es definitivo).
  - *Sobres*: porcentaje por sobre y préstamos entre sobres con nota.
  - *Preguntas sin prisa* en Cuentas, *silencio por encargo* hasta el lunes y *tono* (directo, amable, silencioso).
  - *Brújula* en Inicio: círculo flotante cuya aguja se sacude y apunta a donde conviene mirar; al tocarla muestra una nota, sin cambiar de pantalla.
- **Estructura (canvas aprobado).** Cada pantalla tiene un título grande con el momento del día (en Inicio, el saludo y la hora). El menú es un mosaico de secciones. La barra inferior es fija: Inicio, Movimientos, Registrar, Estadísticas y Cuentas. Los formularios se abren como hojas inferiores.
- **Modo calmado (la interfaz de la app).** Pensado para que nada abrume, también para personas con TDAH: un dato principal, una acción y el detalle solo al tocar.
  - *Hoy*: como máximo tres cosas calculadas de tus datos (anotar lo de hoy, un cobro cercano, un sobre que se pasó, una carta o decisión pendiente). Se palomean y se recuerda por día.
  - *Registrar*: 1) el monto con teclado y Guardar; 2) «¿Qué fue?» opcional, sin presión: el gasto ya está guardado y nunca se vuelve a preguntar. Nota, cuenta e impulso en «Más opciones».
  - *Sobres* y *Tarjetas*: un renglón o tarjeta por elemento; el detalle y las acciones en una hoja. *Ajustes*: una lista; cada renglón abre una sola decisión. *Estadísticas*: una frase y las barras; lo demás en «Ver más». *Menú*: lo que más usas arriba; el resto plegado.
  - La brújula queda quieta. El motor tiene `annotate` para cambiar la categoría o la nota de un gasto sin tocar importes.
- **Notificación rápida (Android).** Una notificación fija y silenciosa con respuesta directa: escribes «85 tacos» en la barra de notificaciones y queda en una cola local; al abrir Ábaco se registra como gasto con la hora en que lo anotaste. Se apaga en Ajustes.
- **Probar otra hora o fecha.** Abrir con `?hora=19` (o `?hora=19.5`) fija la hora del cielo; `window.__abacoNow = <ms>` fija la fecha de la capa de convivencia. No hay ningún control visible para esto.

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
node --test tests/sky.test.js           # cielo del día (funciones puras)
node --test tests/extras.test.js        # lógica de convivencia
node --test tests/glass.test.js         # cristal líquido y convivencia en Chromium, 390x844
node --test tests/shell.test.js         # estructura del rediseño: cabecera, hojas, menú, barra
node --test tests/calm.test.js          # modo calmado: Hoy, Sobres, Tarjetas, menú
node --test tests/quick.test.js         # notificación rápida con un puente de Android simulado
```

`tests/fixtures/legacy-v2/` es una copia congelada de la app anterior. La prueba de migración la usa para generar datos del formato antiguo.

## Compilar Android

Ver [ANDROID.md](ANDROID.md). Para actualizar una app instalada, usa siempre el APK firmado con la clave de release.
