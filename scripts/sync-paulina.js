/**
 * sync-paulina.js
 * Extrae la "Lista compra general" del menú semanal de Paulina Cocina
 * y la marca en tu inventario de Supabase (campos paulina_*).
 *
 * Uso:
 *   node scripts/sync-paulina.js            # sincroniza
 *   node scripts/sync-paulina.js --dry-run  # scrapea, calcula e imprime el plan sin escribir
 *   node scripts/sync-paulina.js --debug    # browser visible y lento
 *
 * Requiere .env con:
 *   PAULINA_EMAIL, PAULINA_PASSWORD
 *   SUPABASE_URL, SUPABASE_KEY
 *   SUPABASE_USER_ID, INVENTARIO_PASSWORD
 *   INVENTARIO_EMAIL (opcional, si difiere de PAULINA_EMAIL)
 *
 * Contrato con la tabla items (supabase/migrations/20260928_paulina_origen.sql):
 *   - paulina_semana no null ⇒ el ítem está en el menú vigente.
 *   - origen = 'paulina' solo en ítems que esta sync creó.
 *   - cantidad_actual de ítems existentes NUNCA se modifica.
 *
 * Al terminar escribe sync-report.json en la raíz del repo (lo lee validar-sync.js).
 *
 * Las funciones puras (parseo, normalización, clasificación, dedupe, plan) se
 * exportan para tests; el main solo corre si se ejecuta el archivo directamente.
 */

const path = require('path');
const fs = require('fs');

const REPORTE_PATH = path.join(__dirname, '..', 'sync-report.json');
const MIGRACION = 'supabase/migrations/20260928_paulina_origen.sql';
const MSG_MIGRACION_FALTANTE = `Falta correr ${MIGRACION} en Supabase`;

// Deben coincidir exacto con DEFAULT_SUBCATS de index.html: la app arma
// pestañas y paneles iterando esas categorías, así que un ítem con otra
// categoría queda invisible en Inventario.
const CATEGORIAS_VALIDAS = ['Artículos de Limpieza', 'Comida', 'Bebidas', 'Herramientas', 'Otras'];

// Unidades que ofrece el <select id="f_unidad"> de index.html. La columna
// items.unidad de ítems nuevos tiene que ser una de estas para que el form de
// edición la muestre; la unidad "de Paulina" (lata, diente...) va en paulina_unidad.
const UNIDADES_APP = ['unidades', 'kg', 'g', 'litros', 'ml', 'paquetes', 'cajas', 'bolsas', 'rollos'];

// ── Normalización ─────────────────────────────────────────────────────────────

/** lowercase, trim, sin tildes/diacríticos (ñ → n), espacios colapsados. */
function normalizarNombre(nombre) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Raíz simple de una palabra ya normalizada (solo para comparar, no es un
 * singular "correcto"). Se aplica igual a ambos lados, así que lo que importa
 * es que singular y plural colapsen a la misma raíz:
 *   limón/limones → limon, tomate/tomates → tomat, papa/papas → papa,
 *   verde/verdes → verd, nuez/nueces → nuec.
 */
function singularizar(palabra) {
  if (palabra.length <= 3) return palabra; // "de", "las", "sal", "ajo"... no se tocan
  return palabra
    .replace(/e?s$/, '')
    .replace(/e$/, '')
    .replace(/z$/, 'c');
}

/**
 * Clave de comparación para match/dedupe: nombre normalizado + singular
 * simple por palabra. Solo se usa para comparar; nunca se guarda como nombre.
 */
function claveComparacion(nombre) {
  return normalizarNombre(nombre).split(' ').map(singularizar).join(' ');
}

// ── Clasificación de ingredientes por categoría ───────────────────────────────
// Se evalúa en orden: las reglas más específicas primero (papel film antes que
// papel). El match es por palabra completa sobre el nombre normalizado, con
// plural opcional, para evitar falsos positivos tipo "tomate" ⊃ "mate".
const CATEGORIA_REGLAS = [
  {
    categoria: 'Herramientas',
    palabras: ['papel film', 'papel aluminio', 'papel manteca', 'film', 'aluminio'],
  },
  {
    categoria: 'Artículos de Limpieza',
    palabras: ['detergente', 'lavandina', 'esponja', 'jabón', 'trapo', 'papel', 'toalla', 'servilleta', 'bolsa de residuos', 'desengrasante'],
  },
  {
    categoria: 'Bebidas',
    palabras: ['agua', 'jugo', 'vino', 'cerveza', 'gaseosa', 'bebida', 'leche', 'yogur', 'kefir', 'caldo', 'infusión', 'té', 'café', 'mate', 'sidra'],
  },
];

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REGLAS_COMPILADAS = CATEGORIA_REGLAS.map(({ categoria, palabras }) => ({
  categoria,
  regex: new RegExp(
    `(?:^|\\s)(?:${palabras.map(p => escaparRegex(normalizarNombre(p))).join('|')})(?:e?s)?(?=\\s|$)`
  ),
}));

function clasificar(nombre) {
  const n = normalizarNombre(nombre);
  for (const { categoria, regex } of REGLAS_COMPILADAS) {
    if (regex.test(n)) return categoria;
  }
  return 'Comida';
}

// ── Parseo de líneas de ingrediente ───────────────────────────────────────────

const FRACCIONES_UNICODE = { '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 1 / 8 };
const FRAC_CHARS = Object.keys(FRACCIONES_UNICODE).join('');

// variante (como aparece en el texto) → unidad canónica (paulina_unidad)
const UNIDADES = {
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos'],
  g: ['g', 'gr', 'grs', 'gramo', 'gramos'],
  ml: ['ml', 'cc', 'mililitro', 'mililitros'],
  litros: ['l', 'lt', 'lts', 'litro', 'litros'],
  unidades: ['unidad', 'unidades', 'u'],
  taza: ['taza', 'tazas', 'tacita', 'tacitas'],
  cucharada: ['cucharada', 'cucharadas', 'cda', 'cdas'],
  cucharadita: ['cucharadita', 'cucharaditas', 'cdita', 'cditas', 'cdta', 'cdtas'],
  lata: ['lata', 'latas'],
  paquete: ['paquete', 'paquetes', 'paquetito', 'paquetitos'],
  sobre: ['sobre', 'sobres', 'sobrecito', 'sobrecitos'],
  frasco: ['frasco', 'frascos', 'frasquito', 'frasquitos'],
  pote: ['pote', 'potes', 'potecito', 'potecitos'],
  bandeja: ['bandeja', 'bandejas', 'bandejita', 'bandejitas'],
  botella: ['botella', 'botellas'],
  bolsa: ['bolsa', 'bolsas'],
  caja: ['caja', 'cajas', 'cajita', 'cajitas'],
  rollo: ['rollo', 'rollos'],
  atado: ['atado', 'atados'],
  manojo: ['manojo', 'manojos'],
  planta: ['planta', 'plantas'],
  cabeza: ['cabeza', 'cabezas'],
  diente: ['diente', 'dientes'],
  rodaja: ['rodaja', 'rodajas'],
  feta: ['feta', 'fetas'],
  hoja: ['hoja', 'hojas'],
  rama: ['rama', 'ramas', 'ramita', 'ramitas'],
  trozo: ['trozo', 'trozos', 'trocito', 'trocitos'],
  puñado: ['puñado', 'puñados', 'puñadito', 'puñaditos'],
  pizca: ['pizca', 'pizcas'],
  docena: ['docena', 'docenas'],
  pack: ['pack', 'packs'],
  maple: ['maple', 'maples'],
};

const VARIANTE_A_UNIDAD = new Map();
for (const [canonica, variantes] of Object.entries(UNIDADES)) {
  for (const v of variantes) VARIANTE_A_UNIDAD.set(v, canonica);
}

// Unidad del form de la app (items.unidad) a partir de la unidad de Paulina.
const UNIDAD_A_APP = { kg: 'kg', g: 'g', ml: 'ml', litros: 'litros', paquete: 'paquetes', caja: 'cajas', bolsa: 'bolsas', rollo: 'rollos' };

function unidadApp(unidadPaulina) {
  return UNIDAD_A_APP[unidadPaulina] || 'unidades';
}

// Cantidad: "1 1/2", "1 ½", "1½", "1 y ½", "1/2", "1,5", "1.5", "2", "½"
const CANT = `(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*(?:y\\s+)?[${FRAC_CHARS}]|\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?|[${FRAC_CHARS}])`;
// Variantes ordenadas de la más larga a la más corta: si no, "diente" gana a
// "dientes" y "l" a "latas". Tras la unidad se exige fin de palabra (espacio,
// punto o fin de línea) para que "3 limones" no se lea como "3 l imones".
const UNIDAD_RE = [...VARIANTE_A_UNIDAD.keys()].sort((a, b) => b.length - a.length).map(escaparRegex).join('|');
const MODIFICADORES = '(?:chico|chica|chicos|chicas|grande|grandes|mediano|mediana|medianos|medianas|pequeño|pequeña)';

const LINEA_RE = new RegExp(
  `^(${CANT})` +                                  // 1: cantidad
  `(?:\\s*(?:-|–|a)\\s*(${CANT}))?` +              // 2: rango "2-3", "2 a 3" (se usa el mayor)
  `\\s*(?:(${UNIDAD_RE})\\.?(?=\\s|$))?` +         // 3: unidad
  `(?:\\s+${MODIFICADORES}(?=\\s|$))?` +           // "1 paquete chico de ..."
  `\\s*(?:de\\s+)?` +
  `(.+)$`,                                         // 4: nombre
  'i'
);

/** Convierte un token de cantidad a número. null si no se puede. */
function parsearCantidad(token) {
  if (token == null) return null;
  let t = String(token).trim().replace(/\s+y\s+/i, ' ');
  let total = 0;
  // Fracción unicode (sola o pegada/separada de un entero)
  const uni = t.match(new RegExp(`[${FRAC_CHARS}]`));
  if (uni) {
    total += FRACCIONES_UNICODE[uni[0]];
    t = t.replace(uni[0], '').trim();
    if (!t) return redondear(total);
  }
  // Mixto "1 1/2"
  let m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[3]) ? redondear(total + Number(m[1]) + Number(m[2]) / Number(m[3])) : null;
  // Fracción "1/2"
  m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[2]) ? redondear(total + Number(m[1]) / Number(m[2])) : null;
  // Entero o decimal con coma/punto
  m = t.match(/^\d+(?:[.,]\d+)?$/);
  if (m) return redondear(total + parseFloat(t.replace(',', '.')));
  return null;
}

function redondear(n) {
  return Math.round(n * 1000) / 1000;
}

/** Quita las aclaraciones de uso que agrega Paulina: "(vas a usar ½)", "(opcional)". */
function limpiarLinea(texto) {
  return String(texto || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\((?:opcional\s*[-–]\s*)?vas a usar[^)]*\)/gi, '')
    .replace(/\s*\(opcional\)/gi, '')
    .replace(/^[-•*·]\s*/, '')
    .trim();
}

function limpiarNombre(nombre) {
  let n = nombre
    .replace(/\([^)]*\)/g, ' ')          // cualquier otra aclaración entre paréntesis
    .replace(/\s+(?:a gusto|c\/n|cantidad necesaria)\s*$/i, '')
    .replace(/[\s.,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : n;
}

/**
 * Parsea una línea de la lista de Paulina.
 * Devuelve { texto, nombre, nombre_norm, clave, cantidad, unidad } o null.
 *   - texto: la línea original (espacios colapsados), va a paulina_texto.
 *   - cantidad/unidad: null si la línea no trae cantidad ("Aceite de oliva").
 *     Si trae número pero no unidad ("3 huevos") la unidad es 'unidades'.
 */
function parsearIngrediente(linea) {
  const texto = String(linea || '').replace(/\s+/g, ' ').trim();
  const limpio = limpiarLinea(texto);
  if (limpio.length < 2) return null;

  let nombre = limpio;
  let cantidad = null;
  let unidad = null;

  const m = limpio.match(LINEA_RE);
  if (m) {
    const c1 = parsearCantidad(m[1]);
    const c2 = parsearCantidad(m[2]);
    if (c1 != null) {
      cantidad = c2 != null ? Math.max(c1, c2) : c1;
      unidad = m[3] ? VARIANTE_A_UNIDAD.get(m[3].toLowerCase()) || 'unidades' : 'unidades';
      nombre = m[4];
    }
  }

  nombre = limpiarNombre(nombre);
  if (nombre.length < 2) return null;

  return {
    texto,
    nombre,
    nombre_norm: normalizarNombre(nombre),
    clave: claveComparacion(nombre),
    cantidad,
    unidad,
  };
}

// ── Dedupe ────────────────────────────────────────────────────────────────────

/** Une textos repetidos: ["2 papas","3 papas"] → "2 papas | 3 papas"; ["X","X"] → "X (x2)". */
function unirTextos(textos) {
  const conteo = new Map();
  for (const t of textos) conteo.set(t, (conteo.get(t) || 0) + 1);
  return [...conteo].map(([t, n]) => (n > 1 ? `${t} (x${n})` : t)).join(' | ');
}

/**
 * Agrupa ingredientes por clave de comparación (la lista de Paulina repite
 * ingredientes entre recetas).
 *   - Misma unidad (incluido "sin cantidad" en ambos): se suman cantidades.
 *   - Unidad distinta: se conserva cantidad/unidad del primero.
 *   - En ambos casos paulina_texto conserva todas las líneas originales.
 * Mantiene el orden de primera aparición.
 */
function deduplicar(ingredientes) {
  const grupos = new Map();
  for (const ing of ingredientes) {
    const g = grupos.get(ing.clave);
    if (!g) {
      grupos.set(ing.clave, { ...ing, textos: [ing.texto] });
      continue;
    }
    g.textos.push(ing.texto);
    if (g.unidad === ing.unidad && g.cantidad != null && ing.cantidad != null) {
      g.cantidad = redondear(g.cantidad + ing.cantidad);
    }
  }
  return [...grupos.values()].map(({ textos, ...g }) => ({ ...g, texto: unirTextos(textos) }));
}

// ── Plan de sincronización (puro) ─────────────────────────────────────────────

/**
 * Calcula qué hacer contra la tabla items, sin tocar la base.
 * @param existentes ítems del usuario [{id, nombre, paulina_semana}], idealmente ordenados por created_at
 * @param ingredientes salida de deduplicar()
 * @returns {{ marcar: Array<{id, nombre, ingrediente}>, insertar: Array, desmarcar: Array<{id, nombre, paulina_semana}> }}
 *
 * - marcar: ítems existentes cuyo nombre matchea (primer ítem por clave si hay
 *   duplicados en el inventario).
 * - insertar: ingredientes sin match.
 * - desmarcar: todo ítem con paulina_semana != null que no se marca en esta
 *   corrida (semanas anteriores y, si la lista de la misma semana cambió, los
 *   que ya no están). Así correr dos veces la misma semana es idempotente.
 */
function planificar(existentes, ingredientes) {
  const porClave = new Map();
  for (const it of existentes) {
    const k = claveComparacion(it.nombre);
    if (!porClave.has(k)) porClave.set(k, it);
  }

  const marcar = [];
  const insertar = [];
  const idsMarcados = new Set();
  for (const ing of ingredientes) {
    const ex = porClave.get(ing.clave);
    if (ex && !idsMarcados.has(ex.id)) {
      marcar.push({ id: ex.id, nombre: ex.nombre, ingrediente: ing });
      idsMarcados.add(ex.id);
    } else if (!ex) {
      insertar.push(ing);
    }
  }

  const desmarcar = existentes
    .filter(it => it.paulina_semana != null && !idsMarcados.has(it.id))
    .map(({ id, nombre, paulina_semana }) => ({ id, nombre, paulina_semana }));

  return { marcar, insertar, desmarcar };
}

/**
 * Lo que la sync va a escribir en paulina_* por ingrediente deduplicado. Se
 * guarda en el reporte (planificados) y validar-sync.js lo compara con la DB.
 */
function resumenPlanificado({ marcar, insertar }) {
  return [
    ...marcar.map(m => ({ ...m.ingrediente, accion: 'marcar', id: m.id, nombre: m.nombre })),
    ...insertar.map(i => ({ ...i, accion: 'insertar', id: null })),
  ].map(({ accion, id, nombre, clave, texto, cantidad, unidad }) => ({
    accion, id, nombre, clave,
    paulina_texto: texto,
    paulina_cantidad: cantidad,
    paulina_unidad: unidad,
  }));
}

function camposPaulina(ing, semana, syncAt) {
  return {
    paulina_semana: semana,
    paulina_cantidad: ing.cantidad,
    paulina_unidad: ing.unidad,
    paulina_texto: ing.texto,
    paulina_sync_at: syncAt,
  };
}

function filaNueva(ing, { userId, semana, syncAt }) {
  return {
    user_id: userId,
    nombre: ing.nombre,
    categoria: clasificar(ing.nombre),
    // No aparece en la lista normal del hogar porque la UI (stockStatus en
    // index.html) considera 'ok' a los ítems origen='paulina' sin mínimo propio
    // (cantidad_minima <= 0); la sección Paulina los muestra aparte, así no se
    // duplican en Compras. Por eso el mínimo tiene que quedar en 0.
    cantidad_actual: 0,
    cantidad_minima: 0,
    consumo_mensual: 0,
    unidad: unidadApp(ing.unidad),
    origen: 'paulina',
    ...camposPaulina(ing, semana, syncAt),
  };
}

/** true si el error de PostgREST es por una columna inexistente (migración no corrida). */
function esErrorColumnaFaltante(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return /column .* does not exist/i.test(msg) || /could not find the .* column/i.test(msg);
}

// ── Scraping de Paulina Cocina ────────────────────────────────────────────────
async function obtenerListaCompras({ email, password, debug }) {
  const { chromium } = require('playwright');
  console.log('🌐 Abriendo Paulina Cocina...');
  const browser = await chromium.launch({ headless: !debug, slowMo: debug ? 500 : 0 });
  const context = await browser.newContext({ locale: 'es-AR' });
  const page = await context.newPage();

  try {
    // 1. Login
    // Usar la página de WooCommerce directa (más estable que la de Elementor)
    await page.goto('https://almacen.paulinacocina.net/cuenta-usuario/', { waitUntil: 'networkidle' });
    console.log('🔑 Haciendo login...');

    // Esperar a que el formulario esté visible (Elementor/JS puede tardar en renderizarlo)
    await page.waitForSelector('#username, input[name="username"]', { timeout: 15000 });

    // WooCommerce usa id="username" e id="password"
    await page.fill('#username', email);
    await page.fill('#password', password);

    // Click + waitForNavigation en paralelo para no perder el evento de navegación
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }),
      page.click('button[name="login"]'),
    ]);

    // Verificar login exitoso
    const urlLogin = page.url();
    if (urlLogin.includes('ingresar') || urlLogin.includes('lost-password')) {
      throw new Error('Login fallido — revisá PAULINA_EMAIL y PAULINA_PASSWORD en .env');
    }
    console.log('✅ Login exitoso');

    // 2. Ir al portal del menú semanal y encontrar la semana más reciente
    console.log('🔍 Buscando semana más reciente...');
    await page.goto('https://almacen.paulinacocina.net/menu-semanal/', { waitUntil: 'networkidle' });

    // Esperar a que las cards de Elementor Loop carguen
    await page.waitForSelector('.e-loop-item a[href*="menu-semana-"]', { timeout: 15000 });

    const semanas = await page.$$eval('.e-loop-item a[href*="menu-semana-"]', els =>
      els.map(el => {
        const m = el.href.match(/menu-semana-(\d+)/);
        return m ? { n: parseInt(m[1]), href: el.href.split('?')[0] } : null;
      }).filter(Boolean)
    );

    if (!semanas.length) {
      throw new Error('No encontré cards de menú semanal. Puede que el login no haya funcionado.');
    }

    // La semana más reciente = número más alto
    const actual = semanas.reduce((max, s) => s.n > max.n ? s : max, semanas[0]);
    console.log(`📅 Semana más reciente: semana ${actual.n} → ${actual.href}`);

    await page.goto(actual.href, { waitUntil: 'networkidle' });

    // 3. Extraer lista de compras del contenedor "Lista compra general".
    // Se devuelve el texto crudo de cada label (ej. "1 paquete de arroz (vas a
    // usar ½ taza)"): la limpieza de aclaraciones se hace en parsearIngrediente
    // para que sea testeable y para guardar la línea original en paulina_texto.
    const lineas = await page.evaluate(() => {
      const contenedor = document.querySelector('[data-nombre="Lista compra general"]');
      if (!contenedor) return null;
      return Array.from(contenedor.querySelectorAll('label'))
        .map(label => label.textContent.replace(/\s+/g, ' ').trim());
    });

    if (!lineas) {
      throw new Error('No encontré el contenedor "Lista compra general". Revisá que el login haya funcionado y que estés en la página del menú semanal.');
    }

    // Sin filtrar: el total crudo va al reporte (scraped_raw_count) para que el
    // validador detecte si el parser descartó demasiadas líneas.
    console.log(`📋 Lista extraída (${lineas.length} líneas)`);
    return { semana: actual.n, url: actual.href, lineas };

  } finally {
    await browser.close();
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────

/** Crea el cliente y se autentica como el usuario (RLS). Compartido con validar-sync.js. */
async function conectarSupabase(env = process.env) {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  // El email del inventario no tiene por qué ser el mismo que el de Paulina Cocina:
  // si difieren, definir INVENTARIO_EMAIL en .env.
  const { error } = await sb.auth.signInWithPassword({
    email: env.INVENTARIO_EMAIL || env.PAULINA_EMAIL,
    password: env.INVENTARIO_PASSWORD,
  });
  if (error) {
    throw new Error(`Error autenticando en Supabase: ${error.message}\nRevisá INVENTARIO_PASSWORD (e INVENTARIO_EMAIL si aplica) en .env`);
  }
  return sb;
}

/** SELECT con detección de migración faltante. */
async function seleccionarItems(sb, userId, columnas) {
  const { data, error } = await sb
    .from('items')
    .select(columnas)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    if (esErrorColumnaFaltante(error)) throw new Error(MSG_MIGRACION_FALTANTE);
    throw new Error(`Error leyendo ítems de Supabase: ${error.message}`);
  }
  return data || [];
}

function imprimirPlan({ marcar, insertar, desmarcar }, semana) {
  console.log(`\n📝 Plan para semana ${semana}:`);
  console.log(`   Desmarcar (${desmarcar.length}):`);
  desmarcar.forEach(d => console.log(`     - ${d.nombre} (semana ${d.paulina_semana})`));
  console.log(`   Marcar existentes (${marcar.length}):`);
  marcar.forEach(m => console.log(`     ~ ${m.nombre} ← "${m.ingrediente.texto}"`));
  console.log(`   Insertar nuevos (${insertar.length}):`);
  insertar.forEach(i => {
    const cant = i.cantidad != null ? ` — ${i.cantidad} ${i.unidad}` : '';
    console.log(`     + ${i.nombre} [${clasificar(i.nombre)}]${cant}`);
  });
}

async function sincronizarConInventario(ingredientes, { semana, syncAt, dryRun, userId, reporte, env }) {
  const sb = await conectarSupabase(env);

  const existentes = await seleccionarItems(sb, userId, 'id, nombre, cantidad_actual, paulina_semana, created_at');

  // Snapshot previo a cualquier escritura: validar-sync.js verifica que la
  // sync no modificó cantidad_actual de ningún ítem existente.
  reporte.snapshot_cantidades = Object.fromEntries(existentes.map(i => [i.id, i.cantidad_actual]));

  const maxPrevia = Math.max(-Infinity, ...existentes.map(i => i.paulina_semana).filter(n => n != null));
  if (maxPrevia > semana) {
    console.warn(`⚠️  En el inventario hay ítems de la semana ${maxPrevia}, mayor a la detectada (${semana}). Se desmarcan igual.`);
  }

  const plan = planificar(existentes, ingredientes);
  reporte.marcados = plan.marcar.map(m => m.nombre);
  reporte.insertados = plan.insertar.map(i => i.nombre);
  reporte.desmarcados = plan.desmarcar.map(d => d.nombre);
  reporte.planificados = resumenPlanificado(plan);

  console.log(`📦 ${ingredientes.length} ingredientes únicos — ${plan.marcar.length} ya en inventario, ${plan.insertar.length} nuevos, ${plan.desmarcar.length} a desmarcar`);
  imprimirPlan(plan, semana);

  if (dryRun) {
    console.log('\n🧪 --dry-run: no se escribió nada en Supabase.');
    return plan;
  }

  // 1. Desmarcar menú anterior (no toca cantidades ni origen)
  if (plan.desmarcar.length) {
    const { error } = await sb
      .from('items')
      .update({ paulina_semana: null, paulina_cantidad: null, paulina_unidad: null, paulina_texto: null, paulina_sync_at: null })
      .eq('user_id', userId)
      .in('id', plan.desmarcar.map(d => d.id));
    if (error) throw new Error(`Error desmarcando semana anterior: ${error.message}`);
  }

  // 2. Marcar existentes: solo campos paulina_* (cada uno con su cantidad/texto)
  for (const { id, nombre, ingrediente } of plan.marcar) {
    const { error } = await sb
      .from('items')
      .update(camposPaulina(ingrediente, semana, syncAt))
      .eq('user_id', userId)
      .eq('id', id);
    if (error) throw new Error(`Error marcando "${nombre}": ${error.message}`);
  }

  // 3. Insertar nuevos
  if (plan.insertar.length) {
    const rows = plan.insertar.map(ing => filaNueva(ing, { userId, semana, syncAt }));
    const { error } = await sb.from('items').insert(rows);
    if (error) {
      if (esErrorColumnaFaltante(error)) throw new Error(MSG_MIGRACION_FALTANTE);
      throw new Error(`Error insertando en Supabase: ${error.message}`);
    }
  }

  console.log(`\n✅ Escrito en Supabase: ${plan.desmarcar.length} desmarcados, ${plan.marcar.length} marcados, ${plan.insertar.length} insertados`);
  return plan;
}

function escribirReporte(reporte) {
  fs.writeFileSync(REPORTE_PATH, JSON.stringify(reporte, null, 2) + '\n');
  console.log(`🧾 Reporte escrito en ${path.relative(process.cwd(), REPORTE_PATH) || REPORTE_PATH}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(argv = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const env = process.env;
  const dryRun = argv.includes('--dry-run');
  const debug = argv.includes('--debug');

  const missing = ['PAULINA_EMAIL', 'PAULINA_PASSWORD', 'SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_USER_ID', 'INVENTARIO_PASSWORD']
    .filter(k => !env[k]);
  if (missing.length) throw new Error(`Faltan variables en .env: ${missing.join(', ')}`);

  // Un reporte viejo no debe poder validarse como si fuera de esta corrida.
  fs.rmSync(REPORTE_PATH, { force: true });

  const syncAt = new Date().toISOString();
  const reporte = {
    semana: null,
    url: null,
    sync_at: syncAt,
    dry_run: dryRun,
    scraped_raw_count: null,
    scraped: [],
    insertados: [],
    marcados: [],
    desmarcados: [],
    snapshot_cantidades: {},
  };

  try {
    const { semana, url, lineas } = await obtenerListaCompras({
      email: env.PAULINA_EMAIL,
      password: env.PAULINA_PASSWORD,
      debug,
    });
    reporte.semana = semana;
    reporte.url = url;

    reporte.scraped_raw_count = lineas.length;
    const parseados = lineas.map(parsearIngrediente).filter(Boolean);
    reporte.scraped = parseados.map(({ texto, nombre, nombre_norm, cantidad, unidad }) => ({ texto, nombre, nombre_norm, cantidad, unidad }));
    if (!parseados.length) throw new Error('No se encontraron ingredientes en la lista');

    const ingredientes = deduplicar(parseados);
    await sincronizarConInventario(ingredientes, {
      semana, syncAt, dryRun, userId: env.SUPABASE_USER_ID, reporte, env,
    });

    console.log(`\n🎉 Sincronización ${dryRun ? '(dry-run) ' : ''}completa — semana ${semana}: ` +
      `${reporte.insertados.length} agregados, ${reporte.marcados.length} marcados, ${reporte.desmarcados.length} desmarcados`);
  } catch (err) {
    reporte.error = err.message;
    throw err;
  } finally {
    escribirReporte(reporte);
  }
}

module.exports = {
  CATEGORIAS_VALIDAS,
  UNIDADES_APP,
  MSG_MIGRACION_FALTANTE,
  REPORTE_PATH,
  normalizarNombre,
  claveComparacion,
  clasificar,
  parsearCantidad,
  limpiarLinea,
  parsearIngrediente,
  deduplicar,
  planificar,
  resumenPlanificado,
  filaNueva,
  unidadApp,
  esErrorColumnaFaltante,
  conectarSupabase,
  seleccionarItems,
  main,
};

if (require.main === module) {
  main().catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
}
