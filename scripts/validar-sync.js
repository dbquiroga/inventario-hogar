/**
 * validar-sync.js
 * Árbitro determinístico de la sync con Paulina Cocina: lee sync-report.json
 * (lo escribe sync-paulina.js), consulta Supabase como el usuario y verifica
 * que el inventario quedó como dice el contrato.
 *
 * Uso:
 *   node scripts/validar-sync.js [ruta/al/sync-report.json]
 *
 * Mismas variables de entorno que sync-paulina.js (no necesita PAULINA_PASSWORD).
 * Sale con código 1 si algún criterio falla.
 *
 * Criterios:
 *   (a) la lista scrapeada tiene >= 5 ítems
 *   (b) cada ingrediente scrapeado está en items con paulina_semana = semana
 *   (c) no hay ítems con paulina_semana != null y != semana
 *   (d) no hay nombres duplicados (normalizados) entre los ítems de la semana
 *   (e) los ítems creados por la sync (origen='paulina') de la semana tienen
 *       categoría de DEFAULT_SUBCATS
 *   (f) ningún ítem existente antes de la sync cambió cantidad_actual
 *   (g) el parser no descartó más del 10% ni más de 3 líneas crudas
 *   (h) cada ingrediente planificado quedó en la DB con paulina_texto,
 *       paulina_cantidad y paulina_unidad iguales a lo planificado
 */

const fs = require('fs');
const path = require('path');
const {
  CATEGORIAS_VALIDAS,
  REPORTE_PATH,
  claveComparacion,
  conectarSupabase,
  seleccionarItems,
} = require('./sync-paulina.js');

const MIN_ITEMS = 5;
const MAX_DESCARTE_LINEAS = 3;
const MAX_DESCARTE_RATIO = 0.10;

const mismoNumero = (a, b) => (a == null || b == null ? a == null && b == null : Number(a) === Number(b));

function leerReporte(ruta) {
  if (!fs.existsSync(ruta)) throw new Error(`No existe ${ruta}: corré primero npm run sync-paulina`);
  const r = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (r.error) throw new Error(`El reporte registra un error de la sync: ${r.error}`);
  if (r.dry_run) throw new Error('El reporte es de un --dry-run: no hay escrituras que validar');
  if (!Number.isInteger(r.semana)) throw new Error('El reporte no tiene un número de semana válido');
  return r;
}

/** Criterios puros sobre el reporte y los ítems actuales del usuario. */
function evaluar(reporte, items) {
  const { semana } = reporte;
  const scraped = reporte.scraped || [];
  const deLaSemana = items.filter(i => i.paulina_semana === semana);
  const muestra = arr => arr.slice(0, 5).join(', ') + (arr.length > 5 ? ` (+${arr.length - 5})` : '');
  const resultados = [];
  const agregar = (id, criterio, ok, detalle) => resultados.push({ id, criterio, ok, detalle });

  agregar('a', `Lista scrapeada con >= ${MIN_ITEMS} ítems`, scraped.length >= MIN_ITEMS,
    `${scraped.length} líneas`);

  const clavesSemana = new Set(deLaSemana.map(i => claveComparacion(i.nombre)));
  const faltantes = [...new Set(scraped.filter(s => !clavesSemana.has(claveComparacion(s.nombre))).map(s => s.nombre))];
  agregar('b', `Todo lo scrapeado está marcado con semana ${semana}`, faltantes.length === 0,
    faltantes.length ? `faltan: ${muestra(faltantes)}` : `${deLaSemana.length} ítems marcados`);

  const otraSemana = items.filter(i => i.paulina_semana != null && i.paulina_semana !== semana);
  agregar('c', 'Sin ítems marcados con otra semana', otraSemana.length === 0,
    otraSemana.length ? muestra(otraSemana.map(i => `${i.nombre} (sem ${i.paulina_semana})`)) : 'ok');

  const porClave = new Map();
  for (const i of deLaSemana) {
    const k = claveComparacion(i.nombre);
    porClave.set(k, [...(porClave.get(k) || []), i.nombre]);
  }
  const duplicados = [...porClave.values()].filter(v => v.length > 1).map(v => v.join(' / '));
  agregar('d', 'Sin duplicados de nombre en el menú de la semana', duplicados.length === 0,
    duplicados.length ? muestra(duplicados) : 'ok');

  const creados = deLaSemana.filter(i => i.origen === 'paulina');
  const malCategoria = creados.filter(i => !CATEGORIAS_VALIDAS.includes(i.categoria));
  agregar('e', 'Categorías válidas en ítems creados por la sync', malCategoria.length === 0,
    malCategoria.length ? muestra(malCategoria.map(i => `${i.nombre}: ${i.categoria}`)) : `${creados.length} revisados`);

  const snapshot = reporte.snapshot_cantidades || {};
  const actuales = new Map(items.map(i => [i.id, i]));
  const cambiados = [];
  for (const [id, antes] of Object.entries(snapshot)) {
    const it = actuales.get(id);
    if (!it) continue; // borrado a mano después de la sync: no es responsabilidad de la sync
    if (Number(it.cantidad_actual ?? 0) !== Number(antes ?? 0)) {
      cambiados.push(`${it.nombre}: ${antes} → ${it.cantidad_actual}`);
    }
  }
  const nSnapshot = Object.keys(snapshot).length;
  agregar('f', 'cantidad_actual de ítems previos sin cambios', cambiados.length === 0,
    cambiados.length ? muestra(cambiados) : `${nSnapshot} ítems comparados`);

  const raw = reporte.scraped_raw_count;
  if (!Number.isInteger(raw)) {
    agregar('g', 'Parser sin descartes excesivos', false, 'el reporte no tiene scraped_raw_count');
  } else {
    const descartadas = raw - scraped.length;
    const ok = descartadas <= MAX_DESCARTE_LINEAS && descartadas <= raw * MAX_DESCARTE_RATIO;
    agregar('g', 'Parser sin descartes excesivos', ok,
      `${descartadas} de ${raw} líneas descartadas (máx ${MAX_DESCARTE_LINEAS} y ${MAX_DESCARTE_RATIO * 100}%)`);
  }

  const planificados = reporte.planificados;
  if (!Array.isArray(planificados)) {
    agregar('h', 'paulina_* en DB = lo planificado', false, 'el reporte no tiene planificados');
  } else {
    const porId = new Map(deLaSemana.map(i => [i.id, i]));
    const porClaveSemana = new Map(deLaSemana.map(i => [claveComparacion(i.nombre), i]));
    const difieren = [];
    for (const p of planificados) {
      const it = p.id ? porId.get(p.id) : porClaveSemana.get(p.clave || claveComparacion(p.nombre));
      if (!it) { difieren.push(`${p.nombre}: no está marcado`); continue; }
      const campos = [];
      if (it.paulina_texto !== p.paulina_texto) campos.push('texto');
      if (!mismoNumero(it.paulina_cantidad, p.paulina_cantidad)) campos.push(`cantidad ${it.paulina_cantidad}≠${p.paulina_cantidad}`);
      if ((it.paulina_unidad ?? null) !== (p.paulina_unidad ?? null)) campos.push(`unidad ${it.paulina_unidad}≠${p.paulina_unidad}`);
      if (campos.length) difieren.push(`${p.nombre}: ${campos.join(', ')}`);
    }
    agregar('h', 'paulina_* en DB = lo planificado', planificados.length > 0 && difieren.length === 0,
      difieren.length ? muestra(difieren) : `${planificados.length} ingredientes comparados`);
  }

  return resultados;
}

function imprimirTabla(resultados) {
  const filas = resultados.map(r => [`(${r.id})`, r.ok ? 'PASS' : 'FAIL', r.criterio, r.detalle]);
  const anchos = [0, 1, 2].map(c => Math.max(...filas.map(f => f[c].length)));
  console.log('');
  for (const f of filas) {
    console.log(`${f[0].padEnd(anchos[0])}  ${f[1].padEnd(anchos[1])}  ${f[2].padEnd(anchos[2])}  ${f[3]}`);
  }
  console.log('');
}

async function main(argv = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const env = process.env;
  const missing = ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_USER_ID', 'INVENTARIO_PASSWORD'].filter(k => !env[k]);
  if (!env.INVENTARIO_EMAIL && !env.PAULINA_EMAIL) missing.push('INVENTARIO_EMAIL o PAULINA_EMAIL');
  if (missing.length) throw new Error(`Faltan variables en .env: ${missing.join(', ')}`);

  const ruta = argv[0] ? path.resolve(argv[0]) : REPORTE_PATH;
  const reporte = leerReporte(ruta);
  console.log(`🔎 Validando sync de la semana ${reporte.semana} (${reporte.sync_at})`);

  const sb = await conectarSupabase(env);
  const items = await seleccionarItems(sb, env.SUPABASE_USER_ID, 'id, nombre, categoria, cantidad_actual, origen, paulina_semana, paulina_texto, paulina_cantidad, paulina_unidad');

  const resultados = evaluar(reporte, items);
  imprimirTabla(resultados);

  const fallidos = resultados.filter(r => !r.ok);
  if (fallidos.length) {
    console.error(`❌ ${fallidos.length} criterio(s) fallaron: ${fallidos.map(r => r.id).join(', ')}`);
    return 1;
  }
  console.log('✅ Sincronización válida');
  return 0;
}

module.exports = { evaluar, leerReporte };

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(err => {
      console.error('\n❌ Error:', err.message);
      process.exit(1);
    });
}
