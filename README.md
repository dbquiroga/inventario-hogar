# Inventario del Hogar

App web de inventario doméstico con autenticación y base de datos en la nube. Un solo archivo `index.html` — abrilo en cualquier browser o usalo desde [GitHub Pages](https://dbquiroga.github.io/inventario-hogar).

## Stack

- **Frontend:** HTML + CSS + JavaScript puro, sin frameworks ni bundlers
- **Backend:** [Supabase](https://supabase.com) — autenticación por email y base de datos PostgreSQL
- **Hosting:** GitHub Pages (deploy automático desde `main`)

Los datos de inventario se guardan en Supabase y son accesibles desde cualquier dispositivo con la misma cuenta. Las categorías personalizadas se guardan en `localStorage` del browser.

## Cómo usar

**Registrarse:** ingresá a la app, completá email y contraseña en la pestaña "Registrarse" y confirmá el email que llega a tu casilla.

**Login:** ingresá con tu email y contraseña. La sesión persiste entre visitas.

**Categorías:** navegá entre las pestañas superiores (Artículos de Limpieza, Comida, Bebidas, Herramientas, Otras). Podés agregar categorías propias con el botón "+".

**Agregar ítem:** botón **Nuevo ítem** en el header o **Agregar** dentro de cada categoría. Completá nombre, categoría, subcategoría, cantidad actual, unidad, mínimo y consumo mensual.

**Actualizar cantidad:** editá directamente el campo numérico en la fila y presioná Enter o hacé clic afuera. Los colores se actualizan al instante.

**Editar / Eliminar:** íconos de lápiz y papelera en cada fila (en mobile aparecen como botones en la tarjeta del ítem).

**Alertas de stock:**
- Amarillo → cantidad por debajo del mínimo
- Rojo → sin stock o menos del 50% del mínimo
- El número rojo sobre cada pestaña indica cuántos ítems están bajos

**Lista de compras (🛒):** sección accesible desde el nav inferior. Muestra todos los ítems bajo mínimo con cantidad sugerida: `ceil(max(faltante, consumo_mensual) × 1.1)`.

**Copiar lista:** en la sección Compras, el botón **Copiar** genera texto listo para pegar en WhatsApp o cualquier app.

**Logout:** botón "Salir" en el header.

## Estructura de la base de datos (Supabase)

```sql
create table items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  nombre      text not null,
  categoria   text not null,
  subcategoria text,
  cantidad_actual numeric default 0,
  cantidad_minima numeric default 0,
  consumo_mensual numeric default 0,
  unidad      text default 'unidades',
  created_at  timestamptz default now()
);

-- Row Level Security: cada usuario solo ve sus propios ítems
alter table items enable row level security;
create policy "usuarios ven sus ítems" on items
  for all using (auth.uid() = user_id);
```

## Desarrollo local

Cloná el repo y abrí `index.html` directo en el browser — no hay build step ni servidor necesario.

```bash
git clone https://github.com/dbquiroga/inventario-hogar
cd inventario-hogar
open index.html   # macOS
```

Para conectar tu propia instancia de Supabase, reemplazá `SUPABASE_URL` y `SUPABASE_KEY` al inicio del bloque `<script>` en `index.html`.

## Agentes de IA

El proyecto incluye dos agentes de Claude para desarrollo y QA:

### `senior-dev.md`
Agente de desarrollo con protocolo pre-edición obligatorio: lee el contexto completo antes de tocar código, valida el entorno de ejecución (browser script vs módulo vs async), y verifica patrones existentes antes de introducir nuevos.

Para instalarlo: `cp senior-dev.md ~/.claude/agents/`

### `qa-tester.md`
Agente de QA que usa Claude in Chrome para probar la app de punta a punta: login, carga de datos, creación/edición/eliminación de ítems, categorías custom, responsividad mobile, y errores de consola. Reporta bugs con severidad y pasos de reproducción.

Para instalarlo: `cp qa-tester.md ~/.claude/agents/`

Para invocar los agentes desde Claude Code o Cowork:
```
@senior-dev arreglá el bug en la función X
@qa-tester corré el suite completo
```
