/**
 * sync-paulina.js
 * Extrae la lista de compras del menú semanal de Paulina Cocina
 * y sincroniza los ingredientes con tu inventario en Supabase.
 *
 * Uso:
 *   node scripts/sync-paulina.js
 *
 * Requiere .env con:
 *   PAULINA_EMAIL, PAULINA_PASSWORD
 *   SUPABASE_URL, SUPABASE_KEY
 *   SUPABASE_USER_ID, INVENTARIO_PASSWORD
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// ── Validar variables de entorno ──────────────────────────────────────────────
const {
  PAULINA_EMAIL,
  PAULINA_PASSWORD,
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_USER_ID,
  INVENTARIO_PASSWORD,
} = process.env;

const missing = ['PAULINA_EMAIL','PAULINA_PASSWORD','SUPABASE_URL','SUPABASE_KEY','SUPABASE_USER_ID','INVENTARIO_PASSWORD']
  .filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Faltan variables en .env:', missing.join(', '));
  process.exit(1);
}

// ── Clasificación de ingredientes por categoría ───────────────────────────────
const CATEGORIA_REGLAS = [
  {
    categoria: 'Bebidas',
    palabras: ['agua','jugo','vino','cerveza','gaseosa','bebida','leche','yogur','kefir','caldo','infusión','té','café','mate','sidra'],
  },
  {
    categoria: 'Limpieza',
    palabras: ['detergente','lavandina','esponja','jabón','trapo','papel','toalla','servilleta','bolsa de residuos','desengrasante'],
  },
  {
    categoria: 'Herramientas',
    palabras: ['papel film','papel aluminio','papel manteca','film','aluminio'],
  },
  {
    categoria: 'Comida',
    palabras: [], // default
  },
];

function clasificar(nombre) {
  const n = nombre.toLowerCase();
  for (const { categoria, palabras } of CATEGORIA_REGLAS) {
    if (palabras.some(p => n.includes(p))) return categoria;
  }
  return 'Comida';
}

// ── Parsear línea de ingrediente ──────────────────────────────────────────────
// Formatos comunes: "2 kg de harina", "1 lata de tomates", "Sal a gusto", "3 huevos"
const UNIDADES = ['kg','g','gr','gramos','ml','l','litro','litros','unidad','unidades',
  'taza','tazas','cucharada','cucharadas','cucharadita','cucharaditas',
  'lata','latas','paquete','paquetes','atado','atados','cabeza','cabezas',
  'diente','dientes','rodaja','rodajas','hoja','hojas','rama','ramas'];

function parsearIngrediente(linea) {
  linea = linea.trim().replace(/^[-•*·]\s*/, '').trim();
  if (!linea || linea.length < 2) return null;

  // Intentar extraer cantidad y unidad del inicio: "2 kg de harina", "1/2 taza de azúcar"
  const regex = new RegExp(
    `^([\\d½⅓⅔¼¾]+(?:[\\.,][\\d]+)?(?:\\s*\\/\\s*[\\d]+)?)\\s*(${UNIDADES.join('|')})?\\s*(?:de\\s+)?(.+)$`,
    'i'
  );
  const match = linea.match(regex);

  if (match) {
    const cantidad = parseFloat(match[1].replace(',', '.')) || 1;
    const unidad = match[2] || 'unidades';
    const nombre = match[3].trim();
    return { nombre, cantidad, unidad };
  }

  // Sin cantidad — solo nombre
  return { nombre: linea, cantidad: 1, unidad: 'unidades' };
}

// ── Scraping de Paulina Cocina ────────────────────────────────────────────────
async function obtenerListaCompras() {
  console.log('🌐 Abriendo Paulina Cocina...');
  const debug = process.argv.includes('--debug');
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
    await page.fill('#username', PAULINA_EMAIL);
    await page.fill('#password', PAULINA_PASSWORD);

    // Click + waitForNavigation en paralelo para no perder el evento de navegación
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }),
      page.click('button[name="login"]'),
    ]);

    // Verificar login exitoso
    const url = page.url();
    if (url.includes('ingresar') || url.includes('lost-password')) {
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

    // 3. Extraer lista de compras
    const listaTexto = await page.evaluate(() => {
      // Estrategia 1: buscar heading/elemento que diga "lista de compras"
      const todos = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,strong,b,span'));
      const heading = todos.find(el =>
        /lista de compras/i.test(el.textContent) && el.textContent.trim().length < 60
      );

      if (heading) {
        // Recolectar todos los <li> o <p> que vienen después del heading
        const items = [];
        let el = heading.nextElementSibling || heading.parentElement.nextElementSibling;
        let intentos = 0;
        while (el && intentos < 20) {
          // Parar si llegamos a otro heading de sección
          if (/recetas|lunes|martes|miércoles|jueves|viernes/i.test(el.textContent) &&
              /^h[1-4]$/i.test(el.tagName)) break;
          const lis = el.querySelectorAll('li');
          if (lis.length) {
            lis.forEach(li => items.push(li.textContent.trim()));
          } else if (el.tagName === 'P' || el.tagName === 'LI') {
            const t = el.textContent.trim();
            if (t) items.push(t);
          }
          el = el.nextElementSibling;
          intentos++;
        }
        if (items.length) return items.join('\n');
      }

      // Estrategia 2: todos los <li> de la página (frecuente en recetas)
      const lis = Array.from(document.querySelectorAll('li'));
      if (lis.length) return lis.map(li => li.textContent.trim()).filter(t => t).join('\n');

      // Fallback: texto completo
      return document.body.innerText;
    });

    console.log(`📋 Lista extraída (${listaTexto.split('\n').length} líneas)`);
    return listaTexto;

  } finally {
    await browser.close();
  }
}

// ── Insertar en Supabase ──────────────────────────────────────────────────────
async function sincronizarConInventario(ingredientes) {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Autenticar como el usuario para que RLS funcione
  const { error: authError } = await sb.auth.signInWithPassword({
    email: PAULINA_EMAIL,
    password: INVENTARIO_PASSWORD,
  });
  if (authError) {
    throw new Error(`Error autenticando en Supabase: ${authError.message}\nRevisá INVENTARIO_PASSWORD en .env`);
  }

  // Cargar ítems existentes
  const { data: existentes } = await sb
    .from('items')
    .select('id, nombre, cantidad_minima')
    .eq('user_id', SUPABASE_USER_ID);

  const mapaExistentes = new Map((existentes || []).map(i => [i.nombre.toLowerCase(), i]));

  // Deduplicar por nombre (la lista de Paulina repite ingredientes entre recetas)
  const vistos = new Set();
  const ingredientesUnicos = ingredientes.filter(i => {
    const key = i.nombre.toLowerCase();
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });

  const nuevos = ingredientesUnicos.filter(i => !mapaExistentes.has(i.nombre.toLowerCase()));
  const aActualizar = ingredientesUnicos.filter(i => mapaExistentes.has(i.nombre.toLowerCase()));

  console.log(`📦 ${ingredientes.length} ingredientes — ${aActualizar.length} ya en inventario, ${nuevos.length} nuevos`);

  // Insertar nuevos (cantidad_actual=0 → aparecen en lista de compras)
  if (nuevos.length) {
    const rows = nuevos.map(({ nombre, cantidad, unidad }) => ({
      user_id: SUPABASE_USER_ID,
      nombre,
      categoria: clasificar(nombre),
      cantidad_actual: 0,
      cantidad_minima: Math.max(1, cantidad),
      consumo_mensual: 0,
      unidad,
    }));
    const { error } = await sb.from('items').insert(rows);
    if (error) throw new Error(`Error insertando en Supabase: ${error.message}`);
    console.log(`✅ ${rows.length} ítems nuevos agregados:`);
    rows.forEach(r => console.log(`   + ${r.nombre} (${r.categoria})`));
  }

  // Resetear cantidad_actual=0 en los que ya existen → aparecen en lista de compras
  if (aActualizar.length) {
    const ids = aActualizar.map(i => mapaExistentes.get(i.nombre.toLowerCase()).id);
    const { error } = await sb
      .from('items')
      .update({ cantidad_actual: 0 })
      .in('id', ids);
    if (error) throw new Error(`Error actualizando stock en Supabase: ${error.message}`);
    console.log(`🔄 ${ids.length} ítems existentes puestos en lista de compras:`);
    aActualizar.forEach(i => console.log(`   ~ ${i.nombre}`));
  }

  return { insertados: nuevos.length, actualizados: aActualizar.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const textoLista = await obtenerListaCompras();

    const ingredientes = textoLista
      .split('\n')
      .map(parsearIngrediente)
      .filter(Boolean)
      .filter(i => i.nombre.length > 1);

    if (!ingredientes.length) {
      console.error('❌ No se encontraron ingredientes en la lista');
      process.exit(1);
    }

    const { insertados, actualizados } = await sincronizarConInventario(ingredientes);
    console.log(`\n🎉 Sincronización completa: ${insertados} agregados, ${actualizados} puestos en lista de compras`);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
})();
