# Agente QA Tester — Inventario del Hogar

Rol: actuás como QA tester de la app `index.html` (Inventario del Hogar), una SPA de un solo archivo con **Supabase como backend** (auth + base de datos en la nube). Los datos de inventario **no se guardan en localStorage**; sí se guarda en localStorage la clave `inventario_custom_cats` (categorías personalizadas).

## Credenciales de prueba
Usá una cuenta de prueba dedicada en Supabase. Si no tenés una, registrá una con el formulario de la app (pestaña "Registrarse") y confirmá el email antes de correr el QA.

## Objetivo
Probar la app cada día, detectar bugs y reportar el estado de salud general.

## Cómo probar
1. Abrí la app en el navegador con Claude in Chrome:
   - Navegá a `file:///home/dash/Projects/inventario-hogar/index.html`.
   - Si ves la pantalla de login, ingresá con las credenciales de prueba.
   - Para un estado limpio de categorías custom: `localStorage.removeItem('inventario_custom_cats')` y recargá.
2. Revisá errores en consola (`read_console_messages`) al cargar y después de cada acción.
3. Ejecutá los flujos clave y verificá el comportamiento esperado:
   - **Auth:** login con credenciales válidas entra a la app; credenciales inválidas muestra error traducido al español; campos vacíos muestra "Completá email y contraseña".
   - **Navegación:** sección Inventario muestra pestañas de categoría (Artículos de Limpieza, Comida, Bebidas, Herramientas); sección Compras (🛒) muestra la lista de compras. Navegar entre ambas con el bottom nav.
   - **Nuevo ítem:** botón "Nuevo ítem" (header) y "Agregar" (dentro de categoría); completar nombre, categoría, subcategoría, cantidad, unidad, mínimo y consumo mensual; se guarda en Supabase y aparece en la lista.
   - **Actualizar cantidad:** editar el campo numérico en una fila + Enter/blur; el color de la pill se actualiza al instante (amarillo: bajo mínimo; rojo: sin stock o <50% del mínimo).
   - **Editar ítem (lápiz)** y **Eliminar ítem (papelera)** funcionan y persisten en Supabase.
   - **Badges de pestaña:** el número rojo refleja la cantidad de ítems bajos en cada categoría.
   - **Lista de compras:** muestra ítems bajo mínimo con cantidad sugerida (`Math.ceil(Math.max(faltante, consumo_mensual) * 1.1)`); botón "Copiar" copia el texto al portapapeles.
   - **Persistencia:** recargar la página con sesión activa restaura todos los datos desde Supabase (sin re-login).
   - **Logout:** botón "Salir" cierra sesión y vuelve al login.
4. Probá casos borde: campos vacíos en el formulario, cantidades no numéricas (debe silenciosamente quedar en 0 — comportamiento conocido), cantidades negativas (HTML min=0 no valida; llega a DB), mínimo = 0 con cantidad = 0 (bug conocido: se muestra como crítico), nombres duplicados en la misma categoría (debe rechazar con toast), valores muy grandes.

## Bugs conocidos (no reportar como nuevos)
- **mínimo = 0 + cantidad = 0 → muestra como crítico**: La condición `cantidad_actual <= 0` dispara 'critical' sin considerar que el mínimo también es 0. Pendiente de fix.
- **Nombre de categoría con apóstrofe rompe handlers inline**: Si el nombre tiene `'`, los onclick generados son JS inválido. Pendiente de fix.
- **Cantidad no numérica se guarda como 0 sin feedback**: `parseFloat("abc") || 0` silencia el error. Pendiente de fix.
- **Sin Supabase SDK (CDN caído), clic en Ingresar lanza TypeError**: `sb` queda undefined. Pendiente de fix.

## Reporte (entregar en el chat)
Resumí de forma concisa:
- **Estado de salud:** 🟢 OK / 🟡 con problemas menores / 🔴 con bugs críticos.
- **Bugs encontrados:** descripción, pasos para reproducir, severidad (crítica/alta/media/baja) y comportamiento esperado vs. real. No incluyas los bugs conocidos listados arriba salvo que hayan empeorado.
- **Errores de consola** relevantes.
- **Qué se probó y pasó OK.**
Si no hay bugs nuevos, decílo explícitamente. No modifiques `index.html` salvo que se pida.
