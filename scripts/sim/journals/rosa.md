# Diario de Rosa Delgado — apertura en P Street

## Meta 1: Entrar y cambiar a español
**DONE.** Entré por la pantalla de tiles: ubicación P Street → rol Encargada de Llaves (Key Holder) → mi nombre Rosa Delgado → PIN 4444. Cargó directo al Panel.

CONFUSED/FELT: no tuve que cambiar nada — la app YA estaba en español antes de tocar el menú de usuario. Fui a "Menú de usuario" para verificar y el radio de Idioma mostraba "ES · Español" ya marcado (y deshabilitado, no se puede volver a marcar el que ya está activo); "EN · English" seguía disponible. O sea que el idioma quedó guardado de una sesión anterior, o el sistema detecta P Street/mi usuario como hispanohablante por defecto. No sé cuál — lo dejo apuntado porque no es lo que esperaba (esperaba tener que tocar algo).

## Meta 2: Apertura — Reporte de Apertura (Fase 1 y Fase 2)

### ¿Estaba el trabajo de Maya (turno de la mañana)?
**EN BLANCO — no encontré nada de Maya.** Al abrir "Reporte de Apertura" el contador decía "0 de 44 verificadas · 0 de 8 temperaturas registradas · 0 de 36 entradas de prep" — ni una casilla tocada, ni una temperatura, ni un conteo. Raro porque el Panel había mostrado el reporte como "En progreso" (no "Sin empezar"), así que algo quedó a medio crear pero sin ningún dato real adentro. BUG/CONFUSED: el estado del Panel no coincide con lo que realmente hay en el reporte.

Más contundente: al terminar de llenar mis conteos de apertura, apareció un aviso nuevo: **"No se detectaron datos de cierre previo"** — "36 artículo(s) no tenían conteo de cierre de anoche — se ingresaron recuentos matutinos. Confirma la razón:" con dos opciones (Ubicación cerrada (planificado) / Cierre omitido o No sé). Elegí **"Cierre omitido / No sé"** porque como Encargada de Llaves de apertura no tengo cómo saber si cerraron la ubicación a propósito o si alguien se saltó el cierre — es honestamente lo que pasó, no lo sé. Esto confirma: el cierre de anoche (el trabajo de Maya, si lo hizo) NO quedó registrado en el sistema.

### Fase 1 — Verificación
DONE. Llené temperaturas plausibles (34–40°F) en las 8 neveras/refrigeradores, y conteos pequeños razonables en los 36 ítems de prep (Verduras, Cocidos, Acompañantes, Salsas, Rebanado) usando clic+teclado como me indicaron (los campos numéricos no aceptaban el llenado automático directo). Toqué "Verificar" en las 10 estaciones y "Verificar sección" en las 5 secciones de conteo.

CONFUSED/BUG: justo antes de enviar, el resumen decía "44 de 44 verificadas · 8 de 8 temperaturas registradas · **0 de 36** entradas de prep" — a pesar de que las 36 casillas de conteo SÍ tenían números visibles. El botón "Enviar Apertura" igual se habilitó (decía "Listo para enviar"), así que no bloqueó nada, pero el contador de "36" se quedó en 0 aunque los datos estaban ahí. Parece un contador que no se actualiza a tiempo.

### Envío de Fase 1 — ¿quién puede enviar?
**FUNCIONÓ. No hubo bloqueo por rol.** Toqué "Enviar Apertura" y la app NO mostró ningún mensaje de "tu rol no puede enviar esto" — pasó directo a la "Fase 2 — Entrada de Prep". O sea que como Encargada de Llaves SÍ tengo permiso para enviar el Reporte de Apertura completo. (No hubo mensaje textual de restricción de rol que transcribir — el envío simplemente se aceptó.)

### Fase 2 — Entrada de Prep
La app me llevó automáticamente a esta fase sin pedir nada más. Aquí sí vi datos reales de negocio: Par, "Conteo de cierre" (que resultó ser MI conteo matutino, usado como sustituto porque no había cierre real), "Por preparar" (calculado), un campo "Preparado hoy", y un botón desplegable "Usa: X ingrediente · ~Y oz — toca para confirmar" que muestra la receta ya aplanada a materia prima (SKUs) por cada ítem — se ve el trabajo de "flatten" de recetas funcionando en vivo, bastante impresionante.

Llené "Preparado hoy" para los 36 ítems (usando el valor de "Por preparar" cuando había, o 0 cuando ya estaban al par) y toqué el botón "Usa" en cada uno. Cada clic expande el desglose de ingredientes Y guarda automáticamente — aparece "Guardado por Rosa Delgado a las [hora]" con un botón "Deshacer". Buen detalle de auditoría (queda quién y cuándo).

**BUG encontrado:** el resumen llegó a decir "44 de 44 verificadas · 8 de 8 temperaturas registradas · **36 de 36** entradas de prep" y "Listo para enviar", con el botón "Finalizar Fase 2" habilitado. Pero al tocarlo, la app mostró una alerta: **"Faltan 1 artículo(s) de prep por guardar antes de terminar."** Verifiqué manualmente: los 36 ítems SÍ tenían su "Guardado por Rosa Delgado" con hora. Volví a tocar "Finalizar Fase 2" por si era un error pasajero — mismo resultado, mismo mensaje, y la consola del navegador marcó errores. No pude avanzar más allá de este punto por mi cuenta; no llegué a ninguna ceremonia de confirmación con PIN porque este bug me detuvo antes.

**BLOQUEADO — pero por un bug de conteo, no por mi rol.** Mensaje verbatim: "Faltan 1 artículo(s) de prep por guardar antes de terminar."

FELT: el flujo de apertura en general se siente sólido y bien pensado — el aviso de "no hay datos de cierre" es honesto y útil, el guardado con nombre+hora inspira confianza. Pero el desajuste entre "36 de 36" / "Listo para enviar" y luego "Falta 1" es el tipo de cosa que en una tienda real de verdad me haría dudar de si mi trabajo se guardó, y perdería minutos buscando cuál ítem falta sin que la app me diga cuál.

## Meta 3: El camión de la mañana — Recepción

**DONE.** Fui a Operaciones → Recepción. La página confirmó que esta es la PRIMERA entrega que se registra en el sistema para P Street: "Aún no se han registrado entregas." en la lista de "Entregas recientes" — pantalla completamente vacía, sin ejemplos ni entregas de otras tiendas mezcladas. Se siente como una hoja en blanco de verdad, no como una demo con datos de mentira.

Elegí **Baldor** como proveedor (proveedor de produce/especialidades — encaja con lo que me pidieron). Al elegirlo, la app cargó automáticamente un ítem "sugerido según el uso de este proveedor" (Ham), y el picker de SKU mostró solo 6 artículos disponibles para Baldor: Ham, Cholula, Fresh Mozzarella, Onions, Salami, White Cheddar. Agregué 5 líneas en total:
- **Ham** — 3 × case, $62.50/paquete (venía sugerido de antes)
- **Onions** — 5 paquetes, $28.75/paquete, nota "Bolsas un poco húmedas, se ven bien"
- **Salami** — 4 paquetes, marcado **Faltante** (pedimos 6, llegaron 4), $22.00/paquete, nota explicando la merma
- **Fresh Mozzarella** — 2 inner, $19.99/paquete
- **White Cheddar** — 3 paquetes, $31.20/paquete

Factura #INV-88214, total $552.83, marqué "Foto después" (no tengo cámara real en esta simulación) y dejé una nota general de la entrega.

CONFUSED: para Onions, Salami y White Cheddar la app mostró "Sin cadena de empaque — ingresa la cantidad en paquetes" — en vez del selector "Unidad" (case/inner) que sí tenía Ham y Fresh Mozzarella. Como cocinera que no es técnica, "cadena de empaque" no me dice nada — entendí que era simplemente "no configuraron las unidades para este SKU todavía", pero el mensaje no lo dice así de claro.

**BUG (el más raro del turno):** al tocar "Entrega confirmada" la primera vez, la app mostró una alerta que literalmente decía **"receiving.error.credit_write_failed"** — una clave de traducción cruda, no un mensaje real, ni en español ni en inglés entendible. Pensé que la entrega había fallado del todo. La volví a tocar por si acaso, y esta vez sí apareció un mensaje — pero **ENTERO EN INGLÉS**: "This invoice was already received for this vendor today. (delivery 4c1b4212-11ad-4dfa-8913-4287cc1018f3)" con un enlace en español "Ver entrega existente". Seguí el enlace y descubrí que mi entrega SÍ se había guardado completa la primera vez (los 5 artículos, notas, precios, todo) — el aviso de "credit_write_failed" fue un error de una parte secundaria del sistema (algo de crédito con el proveedor) que confundió, haciéndome creer que todo el envío había fallado cuando en realidad solo falló un paso interno. EN INGLÉS: "This invoice was already received for this vendor today." (debería estar en español). También noté que en el detalle de la entrega, la nota que escribí aparece con **"[PHOTO PENDING]"** pegado al final — EN INGLÉS otra vez, un tag de sistema metido directo en el texto de mi nota.

Quedó además un "Borrador de las 11:50 a.m." colgado en la pantalla de Recepción (de mi segundo intento fallido) — lo descarté con el botón "Descartar" para no dejar basura.

Al final, "Entregas recientes" sí muestra la entrega: "Baldor · 2026-08-11 · Falta foto · 5 artículo(s) · #INV-88214 · Rosa Delgado" — así que el dato quedó bien guardado a pesar de la confusión en el camino.

FELT: el diseño del formulario en sí (proveedor → pedido habitual sugerido → agregar líneas → foto → confirmar) se siente natural, como se haría en la puerta con el camión esperando. Pero ese primer error críptico ("receiving.error.credit_write_failed") en la puerta, con el camionero ahí parado, me habría hecho pensar que perdí todo el trabajo y que tendría que volver a escribirlo todo — mal momento para un mensaje que no dice nada.

## Meta 4: Cerrar sesión
**DONE.** Menú de usuario → "Cerrar sesión". Volvió directo a la pantalla de tiles ("Where are you?" — esa pantalla de login siempre está en inglés porque todavía no hay nadie conectado, tiene sentido). Sesión cerrada limpia, sin dejar nada pendiente.

## Resumen del turno
Complete Fase 1 de apertura y la envié sin problema de rol. Fase 2 (Entrada de Prep) la llené entera pero me quedé bloqueada por un bug de conteo ("Falta 1" con 36/36 guardados) antes de llegar a cualquier ceremonia de PIN. La recepción de Baldor sí se completó de verdad (5 artículos, primera entrega del sistema) a pesar de un error de traducción feo a mitad de camino. En general la app se siente capaz y bien pensada, pero tiene varias grietas de traducción/mensajes de error que en un turno real de apertura, sola, con el camión esperando, me habrían hecho dudar de mi propio trabajo.
