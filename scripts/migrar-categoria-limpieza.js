/**
 * migrar-categoria-limpieza.js
 *
 * Corrige los ítems guardados con categoría 'Limpieza' por versiones viejas de
 * sync-paulina.js. La app arma pestañas y paneles iterando DEFAULT_SUBCATS, que
 * usa 'Artículos de Limpieza': los ítems con 'Limpieza' quedan invisibles en la
 * sección Inventario (aunque sí aparecen en la lista de compras, que no filtra
 * por categoría).
 *
 * Uso:
 *   node scripts/migrar-categoria-limpieza.js           # dry-run: solo muestra
 *   node scripts/migrar-categoria-limpieza.js --apply   # aplica los cambios
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_USER_ID,
  INVENTARIO_PASSWORD,
  INVENTARIO_EMAIL,
  PAULINA_EMAIL,
} = process.env;

const CATEGORIA_VIEJA = 'Limpieza';
const CATEGORIA_NUEVA = 'Artículos de Limpieza';

const missing = ['SUPABASE_URL','SUPABASE_KEY','SUPABASE_USER_ID','INVENTARIO_PASSWORD']
  .filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Faltan variables en .env:', missing.join(', '));
  process.exit(1);
}

(async () => {
  const aplicar = process.argv.includes('--apply');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { error: authError } = await sb.auth.signInWithPassword({
    email: INVENTARIO_EMAIL || PAULINA_EMAIL,
    password: INVENTARIO_PASSWORD,
  });
  if (authError) {
    console.error(`❌ Error autenticando en Supabase: ${authError.message}`);
    process.exit(1);
  }

  const { data: afectados, error } = await sb
    .from('items')
    .select('id, nombre, categoria')
    .eq('user_id', SUPABASE_USER_ID)
    .eq('categoria', CATEGORIA_VIEJA);

  if (error) {
    console.error(`❌ Error consultando ítems: ${error.message}`);
    process.exit(1);
  }

  if (!afectados || afectados.length === 0) {
    console.log(`✅ No hay ítems con categoría '${CATEGORIA_VIEJA}'. Nada que migrar.`);
    return;
  }

  console.log(`\n📋 ${afectados.length} ítem(s) con categoría '${CATEGORIA_VIEJA}':`);
  afectados.forEach(i => console.log(`   • ${i.nombre}`));

  if (!aplicar) {
    console.log(`\n🔍 Dry-run: no se modificó nada.`);
    console.log(`   Para aplicar: node scripts/migrar-categoria-limpieza.js --apply`);
    return;
  }

  const { error: updateError } = await sb
    .from('items')
    .update({ categoria: CATEGORIA_NUEVA })
    .in('id', afectados.map(i => i.id));

  if (updateError) {
    console.error(`❌ Error actualizando: ${updateError.message}`);
    process.exit(1);
  }

  console.log(`\n🎉 ${afectados.length} ítem(s) movidos a '${CATEGORIA_NUEVA}'.`);
})();
