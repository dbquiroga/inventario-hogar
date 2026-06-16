# Inventario del Hogar

App web de inventario doméstico. Un solo archivo `index.html` — abrilo en cualquier browser, sin instalación.

## Cómo usar

**Abrir:** doble clic en `index.html` (o arrastralo al browser).

**Categorías:** usá las pestañas superiores para navegar entre Artículos de Limpieza, Comida, Bebidas y Herramientas. La pestaña de Lista de Compras agrupa todo lo que está bajo mínimo.

**Agregar ítem:** botón **Nuevo ítem** (header) o **Agregar** dentro de cada categoría. Completá nombre, categoría, subcategoría, cantidad actual, unidad, mínimo y consumo mensual.

**Actualizar cantidad:** editá directamente el campo numérico en la fila del ítem y presioná Enter o hacé clic afuera. Los colores se actualizan al instante.

**Editar ítem:** ícono de lápiz en la fila.

**Eliminar ítem:** ícono de papelera en la fila.

**Alertas de stock:**
- Fondo amarillo → cantidad por debajo del mínimo
- Fondo rojo → sin stock o menos del 50% del mínimo
- El número en rojo sobre cada pestaña indica cuántos ítems están bajos

**Lista de compras:** pestaña 🛒. Muestra todos los ítems bajo mínimo con cantidad sugerida (máximo entre lo faltante y el consumo mensual, con 10% de buffer).

**Exportar:** en la lista de compras, copiá el texto generado con el botón **Copiar**.

## Datos

Todo se guarda automáticamente en el `localStorage` del browser. Los datos persisten entre sesiones en el mismo browser/dispositivo. No se envía nada a ningún servidor.

Para resetear al inventario de ejemplo: abrí la consola del browser (F12) y ejecutá `localStorage.removeItem('inventario_hogar_v1')`, luego recargá la página.
