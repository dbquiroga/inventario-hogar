// Tests unitarios de las funciones puras de sync-paulina.js (sin red ni Supabase).
// Correr: npm test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  CATEGORIAS_VALIDAS,
  UNIDADES_APP,
  normalizarNombre,
  claveComparacion,
  clasificar,
  parsearCantidad,
  parsearIngrediente,
  deduplicar,
  planificar,
  filaNueva,
  esErrorColumnaFaltante,
} = require('./sync-paulina.js');

// Líneas reales de la "Lista compra general" de la semana 13 (texto crudo del label).
const SEMANA_13 = [
  '1 pote chico de yogur natural (vas a usar 2 cdas.)',
  '7 huevos',
  '1 paquete de copos de maíz sin azúcar (vas a usar 1 taza)',
  '1 paquete de fideos (vas a usar 200g)',
  '100g de queso fresco o muzzarella',
  '100g de queso parmesano rallado',
  '1 paquete de pan rallado (vas a usar 200g aprox.)',
  '100g de panceta (vas a usar 1 trocito)',
  '1 lata de garbanzos (vas a usar ½)',
  '1 paquete chico de pan lactal (vas a usar 2 rodajas)',
  '1 frasquito de anchoas (vas a usar 3)',
  '1 paquete de harina (vas a usar 100g)',
  '100g de semillas de sésamo (vas a usar 1 cda.)',
  '100g de tomates secos (vas a usar 2)',
  '100g de almendras (vas a usar 1 puñadito)',
  '3 pechugas de pollo',
  '4 filetes de solomillo o carré',
  '200g de carne picada',
  '4 dientes de ajo',
  '3 limones',
  '2 plantas de lechuga (vas a usar 1 y ½)',
  '2 rabanitos',
  '2 zanahorias',
  '1 bandejita de champiñones (vas a usar 5-6)',
  '1 cebolla morada (vas a usar ½)',
  '1 cebolla blanca (vas a usar ½)',
  '4 zapallitos redondos',
  '1 manojo de puerro (vas a usar 1)',
  '1 morrón rojo (vas a usar ¼ aprox.)',
  '2 papas',
  '¼ repollo colorado',
  '1 manzana (opcional - vas a usar ½)',
  '1 harina (vas a usar 550g)',
  '1 paquetito de levadura seca (vas a usar 5g)',
  '1 paquete de aceitunas descarozadas (vas a usar 1 puñadito)',
  'Aceite de oliva',
  'Sal y romero',
  '3 papas',
  '4 huevos',
  '1 leche (vas a usar 200ml)',
  '100g de queso fresco o muzzarella',
  '100g de jamón en fetas',
  '250g de tomates cherry',
  '1 cebolla morada (vas a usar ½)',
  '1 limón (vas a usar ½)',
  'Aceite de oliva',
  'Sal y pimienta',
  'Aceite de oliva',
  'Aceite de girasol',
  'Sal y pimienta',
  'Mostaza (vas a usar 2 cditas.)',
  'Mayonesa (vas a usar 1 cda.)',
  'Pesto (vas a usar 1 cda.)',
];

const p = linea => {
  const r = parsearIngrediente(linea);
  return r && { nombre: r.nombre, cantidad: r.cantidad, unidad: r.unidad };
};

describe('normalizarNombre / claveComparacion', () => {
  test('lowercase, trim, sin tildes, espacios colapsados', () => {
    assert.equal(normalizarNombre('  Morrón   ROJO  '), 'morron rojo');
    assert.equal(normalizarNombre('Champiñones'), 'champinones');
    assert.equal(normalizarNombre('Semillas de\tsésamo'), 'semillas de sesamo');
  });

  test('singular y plural simple colapsan a la misma clave', () => {
    const pares = [['Limón', 'limones'], ['Papa', 'Papas'], ['Huevo', 'huevos'], ['Tomate seco', 'Tomates secos'],
      ['Zanahoria', 'zanahorias'], ['Champiñón', 'champiñones'], ['nuez', 'nueces'], ['Pechuga de pollo', 'pechugas de pollo']];
    for (const [a, b] of pares) assert.equal(claveComparacion(a), claveComparacion(b), `${a} vs ${b}`);
  });

  test('no colapsa ingredientes distintos', () => {
    assert.notEqual(claveComparacion('Sal y pimienta'), claveComparacion('Sal y romero'));
    assert.notEqual(claveComparacion('Aceite de oliva'), claveComparacion('Aceite de girasol'));
    assert.notEqual(claveComparacion('Cebolla morada'), claveComparacion('Cebolla blanca'));
  });
});

describe('parsearCantidad', () => {
  test('enteros, decimales con coma o punto', () => {
    assert.equal(parsearCantidad('3'), 3);
    assert.equal(parsearCantidad('1,5'), 1.5);
    assert.equal(parsearCantidad('1.5'), 1.5);
  });
  test('fracciones unicode y ascii, solas y mixtas', () => {
    assert.equal(parsearCantidad('½'), 0.5);
    assert.equal(parsearCantidad('¼'), 0.25);
    assert.equal(parsearCantidad('¾'), 0.75);
    assert.equal(parsearCantidad('⅓'), 0.333);
    assert.equal(parsearCantidad('⅔'), 0.667);
    assert.equal(parsearCantidad('1/2'), 0.5);
    assert.equal(parsearCantidad('1 ½'), 1.5);
    assert.equal(parsearCantidad('1½'), 1.5);
    assert.equal(parsearCantidad('1 y ½'), 1.5);
    assert.equal(parsearCantidad('1 1/2'), 1.5);
  });
  test('basura o división por cero → null', () => {
    assert.equal(parsearCantidad('abc'), null);
    assert.equal(parsearCantidad('1/0'), null);
    assert.equal(parsearCantidad(null), null);
  });
});

describe('parsearIngrediente', () => {
  test('unidad con límite de palabra (bug "3 limones" → "imones")', () => {
    assert.deepEqual(p('3 limones'), { nombre: 'Limones', cantidad: 3, unidad: 'unidades' });
    assert.deepEqual(p('1 leche (vas a usar 200ml)'), { nombre: 'Leche', cantidad: 1, unidad: 'unidades' });
    assert.deepEqual(p('1 limón (vas a usar ½)'), { nombre: 'Limón', cantidad: 1, unidad: 'unidades' });
    assert.deepEqual(p('1 lata de garbanzos (vas a usar ½)'), { nombre: 'Garbanzos', cantidad: 1, unidad: 'lata' });
  });

  test('prefiere la variante más larga de la unidad (bug "dientes" → "s de ajo")', () => {
    assert.deepEqual(p('4 dientes de ajo'), { nombre: 'Ajo', cantidad: 4, unidad: 'diente' });
  });

  test('unidades diminutivas / nuevas', () => {
    assert.deepEqual(p('1 frasquito de anchoas (vas a usar 3)'), { nombre: 'Anchoas', cantidad: 1, unidad: 'frasco' });
    assert.deepEqual(p('1 bandejita de champiñones (vas a usar 5-6)'), { nombre: 'Champiñones', cantidad: 1, unidad: 'bandeja' });
    assert.deepEqual(p('1 manojo de puerro (vas a usar 1)'), { nombre: 'Puerro', cantidad: 1, unidad: 'manojo' });
    assert.deepEqual(p('1 paquetito de levadura seca (vas a usar 5g)'), { nombre: 'Levadura seca', cantidad: 1, unidad: 'paquete' });
    assert.deepEqual(p('2 plantas de lechuga (vas a usar 1 y ½)'), { nombre: 'Lechuga', cantidad: 2, unidad: 'planta' });
    assert.deepEqual(p('1 trocito de jengibre'), { nombre: 'Jengibre', cantidad: 1, unidad: 'trozo' });
  });

  test('modificador chico/grande queda fuera del nombre', () => {
    assert.deepEqual(p('1 pote chico de yogur natural (vas a usar 2 cdas.)'), { nombre: 'Yogur natural', cantidad: 1, unidad: 'pote' });
    assert.deepEqual(p('1 paquete chico de pan lactal (vas a usar 2 rodajas)'), { nombre: 'Pan lactal', cantidad: 1, unidad: 'paquete' });
    assert.deepEqual(p('1 frasco grande de pepinos'), { nombre: 'Pepinos', cantidad: 1, unidad: 'frasco' });
  });

  test('gramos pegados al número', () => {
    assert.deepEqual(p('100g de queso fresco o muzzarella'), { nombre: 'Queso fresco o muzzarella', cantidad: 100, unidad: 'g' });
    assert.deepEqual(p('250 gr de tomates cherry'), { nombre: 'Tomates cherry', cantidad: 250, unidad: 'g' });
  });

  test('fracciones en la cantidad principal', () => {
    assert.deepEqual(p('¼ repollo colorado'), { nombre: 'Repollo colorado', cantidad: 0.25, unidad: 'unidades' });
    assert.deepEqual(p('1/2 kg de papas'), { nombre: 'Papas', cantidad: 0.5, unidad: 'kg' });
    assert.deepEqual(p('1 ½ taza de azúcar'), { nombre: 'Azúcar', cantidad: 1.5, unidad: 'taza' });
    assert.deepEqual(p('1 1/2 litros de agua'), { nombre: 'Agua', cantidad: 1.5, unidad: 'litros' });
  });

  test('rango usa el mayor', () => {
    assert.deepEqual(p('2-3 tomates'), { nombre: 'Tomates', cantidad: 3, unidad: 'unidades' });
    assert.deepEqual(p('2 a 3 tomates'), { nombre: 'Tomates', cantidad: 3, unidad: 'unidades' });
  });

  test('sin cantidad → cantidad y unidad null; nombres compuestos no se parten', () => {
    assert.deepEqual(p('Aceite de oliva'), { nombre: 'Aceite de oliva', cantidad: null, unidad: null });
    assert.deepEqual(p('Sal y pimienta'), { nombre: 'Sal y pimienta', cantidad: null, unidad: null });
    assert.deepEqual(p('Mostaza (vas a usar 2 cditas.)'), { nombre: 'Mostaza', cantidad: null, unidad: null });
    assert.deepEqual(p('Sal a gusto'), { nombre: 'Sal', cantidad: null, unidad: null });
    assert.deepEqual(p('4 filetes de solomillo o carré'), { nombre: 'Filetes de solomillo o carré', cantidad: 4, unidad: 'unidades' });
  });

  test('conserva la línea original en texto y descarta líneas vacías', () => {
    const r = parsearIngrediente('  1 manzana   (opcional - vas a usar ½) ');
    assert.equal(r.texto, '1 manzana (opcional - vas a usar ½)');
    assert.equal(r.nombre, 'Manzana');
    assert.equal(parsearIngrediente(''), null);
    assert.equal(parsearIngrediente(' - '), null);
  });

  test('fixture semana 13: ningún nombre roto ni unidad de un solo carácter', () => {
    for (const linea of SEMANA_13) {
      const r = parsearIngrediente(linea);
      assert.ok(r, linea);
      assert.match(r.nombre, /^[A-ZÁÉÍÓÚÑ]/, `nombre sin mayúscula inicial: ${linea} → ${r.nombre}`);
      assert.doesNotMatch(r.nombre, /^(?:chico|grande|s de|ata|imon|eche)/i, `${linea} → ${r.nombre}`);
      assert.ok(r.unidad === null || r.unidad.length > 1 || r.unidad === 'g', `${linea} → ${r.unidad}`);
    }
  });
});

describe('deduplicar', () => {
  const unicos = deduplicar(SEMANA_13.map(parsearIngrediente));
  const por = nombre => unicos.find(u => u.clave === claveComparacion(nombre));

  test('fixture semana 13: 53 líneas → 44 ingredientes, claves únicas', () => {
    assert.equal(unicos.length, 44);
    assert.equal(new Set(unicos.map(u => u.clave)).size, unicos.length);
  });

  test('suma cantidades si la unidad coincide y conserva todos los textos', () => {
    assert.equal(por('papas').cantidad, 5);
    assert.equal(por('papas').texto, '2 papas | 3 papas');
    assert.equal(por('huevos').cantidad, 11);
    assert.equal(por('queso fresco o muzzarella').cantidad, 200);
    assert.equal(por('queso fresco o muzzarella').unidad, 'g');
  });

  test('singular/plural se agrupan (3 limones + 1 limón)', () => {
    const l = por('limón');
    assert.equal(l.cantidad, 4);
    assert.equal(l.nombre, 'Limones'); // se queda con el nombre de la primera aparición
    assert.equal(l.texto, '3 limones | 1 limón (vas a usar ½)');
  });

  test('unidad distinta: conserva el primero y concatena textos', () => {
    const h = por('harina');
    assert.equal(h.cantidad, 1);
    assert.equal(h.unidad, 'paquete');
    assert.equal(h.texto, '1 paquete de harina (vas a usar 100g) | 1 harina (vas a usar 550g)');
  });

  test('líneas idénticas se compactan con (xN)', () => {
    assert.equal(por('aceite de oliva').texto, 'Aceite de oliva (x3)');
    assert.equal(por('aceite de oliva').cantidad, null);
    assert.equal(por('sal y pimienta').texto, 'Sal y pimienta (x2)');
    assert.equal(por('cebolla morada').cantidad, 2);
    assert.equal(por('cebolla morada').texto, '1 cebolla morada (vas a usar ½) (x2)');
  });

  test('mantiene el orden de primera aparición', () => {
    assert.equal(unicos[0].nombre, 'Yogur natural');
    assert.equal(unicos[1].nombre, 'Huevos');
  });
});

describe('clasificar', () => {
  test('siempre devuelve una categoría de DEFAULT_SUBCATS', () => {
    for (const linea of SEMANA_13) {
      assert.ok(CATEGORIAS_VALIDAS.includes(clasificar(parsearIngrediente(linea).nombre)), linea);
    }
  });
  test('match por palabra completa (tomate no es "mate")', () => {
    assert.equal(clasificar('Tomates cherry'), 'Comida');
    assert.equal(clasificar('Mate cocido'), 'Bebidas');
    assert.equal(clasificar('Vinos tintos'), 'Bebidas');
  });
  test('reglas específicas antes que genéricas', () => {
    assert.equal(clasificar('Papel film'), 'Herramientas');
    assert.equal(clasificar('Papel higiénico'), 'Artículos de Limpieza');
    assert.equal(clasificar('Jabón en polvo'), 'Artículos de Limpieza');
  });
});

describe('planificar', () => {
  const ing = deduplicar(['3 limones', '2 papas', 'Aceite de oliva', '1 lata de garbanzos'].map(parsearIngrediente));

  test('marca existentes por clave, inserta el resto y desmarca semanas viejas', () => {
    const existentes = [
      { id: 'a', nombre: 'Limón', paulina_semana: null },
      { id: 'b', nombre: 'papas', paulina_semana: 12 },
      { id: 'c', nombre: 'Detergente', paulina_semana: 12 },
      { id: 'd', nombre: 'Arroz', paulina_semana: null },
    ];
    const plan = planificar(existentes, ing);
    assert.deepEqual(plan.marcar.map(m => m.id), ['a', 'b']);
    assert.deepEqual(plan.insertar.map(i => i.nombre), ['Aceite de oliva', 'Garbanzos']);
    assert.deepEqual(plan.desmarcar.map(d => d.id), ['c']);
  });

  test('inventario con duplicados: marca solo el primero y desmarca el otro', () => {
    const existentes = [
      { id: 'a', nombre: 'Papas', paulina_semana: 13 },
      { id: 'b', nombre: 'papa', paulina_semana: 13 },
    ];
    const plan = planificar(existentes, ing);
    assert.deepEqual(plan.marcar.map(m => m.id), ['a']);
    assert.deepEqual(plan.desmarcar.map(d => d.id), ['b']);
  });

  test('idempotente: aplicar el plan y replanificar no inserta ni desmarca nada', () => {
    const existentes = [
      { id: 'a', nombre: 'Limón', paulina_semana: null },
      { id: 'c', nombre: 'Detergente', paulina_semana: 12 },
    ];
    const plan1 = planificar(existentes, ing);
    // Simular la escritura del plan 1
    const despues = existentes.map(e => {
      if (plan1.desmarcar.some(d => d.id === e.id)) return { ...e, paulina_semana: null };
      if (plan1.marcar.some(m => m.id === e.id)) return { ...e, paulina_semana: 13 };
      return e;
    }).concat(plan1.insertar.map((i, n) => ({ id: `new${n}`, nombre: i.nombre, paulina_semana: 13 })));

    const plan2 = planificar(despues, ing);
    assert.equal(plan2.insertar.length, 0);
    assert.equal(plan2.desmarcar.length, 0);
    assert.equal(plan2.marcar.length, ing.length);
  });
});

describe('filaNueva', () => {
  test('ítem nuevo: origen paulina, stock y mínimo 0, unidad válida para la app', () => {
    const [garbanzos] = deduplicar([parsearIngrediente('1 lata de garbanzos (vas a usar ½)')]);
    const fila = filaNueva(garbanzos, { userId: 'u1', semana: 13, syncAt: '2026-09-28T00:00:00.000Z' });
    assert.deepEqual(fila, {
      user_id: 'u1',
      nombre: 'Garbanzos',
      categoria: 'Comida',
      cantidad_actual: 0,
      cantidad_minima: 0,
      consumo_mensual: 0,
      unidad: 'unidades',
      origen: 'paulina',
      paulina_semana: 13,
      paulina_cantidad: 1,
      paulina_unidad: 'lata',
      paulina_texto: '1 lata de garbanzos (vas a usar ½)',
      paulina_sync_at: '2026-09-28T00:00:00.000Z',
    });
  });

  test('unidad de la app siempre es una opción del form', () => {
    for (const linea of [...SEMANA_13, '1 kg de pollo', '2 litros de agua', 'Sal']) {
      const i = parsearIngrediente(linea);
      const fila = filaNueva(i, { userId: 'u', semana: 1, syncAt: 'x' });
      assert.ok(UNIDADES_APP.includes(fila.unidad), `${linea} → ${fila.unidad}`);
    }
  });
});

describe('esErrorColumnaFaltante', () => {
  test('detecta el error de PostgREST por columna inexistente', () => {
    assert.ok(esErrorColumnaFaltante({ code: '42703', message: 'column items.paulina_semana does not exist' }));
    assert.ok(esErrorColumnaFaltante({ code: 'PGRST204', message: "Could not find the 'origen' column of 'items' in the schema cache" }));
    assert.ok(!esErrorColumnaFaltante({ code: '42501', message: 'permission denied' }));
    assert.ok(!esErrorColumnaFaltante(null));
  });
});

describe('validar-sync: evaluar', () => {
  const { evaluar } = require('./validar-sync.js');
  const { resumenPlanificado } = require('./sync-paulina.js');
  const scraped = ['3 limones', '2 papas', 'Aceite de oliva', '1 lata de garbanzos', '7 huevos', '1 limón']
    .map(parsearIngrediente);
  const previos = [
    { id: 'a', nombre: 'Limón', categoria: 'Comida', cantidad_actual: 2, origen: null, paulina_semana: null },
    { id: 'b', nombre: 'Papas', categoria: 'Comida', cantidad_actual: 0.5, origen: null, paulina_semana: 12 },
    { id: 'f', nombre: 'Detergente', categoria: 'Mi categoría', cantidad_actual: 1, origen: null, paulina_semana: 12 },
  ];
  const plan = planificar(previos, deduplicar(scraped));
  const base = {
    semana: 13,
    scraped_raw_count: scraped.length,
    scraped,
    planificados: resumenPlanificado(plan),
    snapshot_cantidades: { a: 2, b: 0.5, f: 1 },
  };
  // Estado de la DB después de aplicar el plan (lo que haría la sync real)
  const itemsOk = [
    ...previos.map(e => {
      const m = plan.marcar.find(x => x.id === e.id);
      if (!m) return { ...e, paulina_semana: null, paulina_texto: null, paulina_cantidad: null, paulina_unidad: null };
      return { ...e, paulina_semana: 13, paulina_texto: m.ingrediente.texto, paulina_cantidad: m.ingrediente.cantidad, paulina_unidad: m.ingrediente.unidad };
    }),
    ...plan.insertar.map((i, n) => ({
      id: `n${n}`, nombre: i.nombre, categoria: clasificar(i.nombre), cantidad_actual: 0, origen: 'paulina',
      paulina_semana: 13, paulina_texto: i.texto, paulina_cantidad: i.cantidad, paulina_unidad: i.unidad,
    })),
  ];
  const estado = (items, reporte = base) => Object.fromEntries(evaluar(reporte, items).map(r => [r.id, r.ok]));
  const mod = (id, cambios) => itemsOk.map(i => (i.id === id ? { ...i, ...cambios } : i));
  const idDe = nombre => itemsOk.find(i => claveComparacion(i.nombre) === claveComparacion(nombre)).id;

  test('resumenPlanificado: nombre de la DB en marcados y paulina_* del ingrediente deduplicado', () => {
    const limon = base.planificados.find(p => p.id === 'a');
    assert.deepEqual(limon, {
      accion: 'marcar', id: 'a', nombre: 'Limón', clave: 'limon',
      paulina_texto: '3 limones | 1 limón', paulina_cantidad: 4, paulina_unidad: 'unidades',
    });
    assert.equal(base.planificados.find(p => p.nombre === 'Aceite de oliva').accion, 'insertar');
  });

  test('estado consistente: todo PASS', () => {
    assert.deepEqual(estado(itemsOk), { a: true, b: true, c: true, d: true, e: true, f: true, g: true, h: true });
  });

  test('detecta cada violación por separado', () => {
    assert.equal(estado(mod(idDe('huevos'), { paulina_semana: null })).b, false);             // (b) falta marcar
    assert.equal(estado(mod('f', { paulina_semana: 12 })).c, false);                           // (c) semana vieja
    assert.equal(estado([...itemsOk, { ...itemsOk[1], id: 'z', nombre: 'papa' }]).d, false);   // (d) duplicado
    assert.equal(estado(mod(idDe('garbanzos'), { categoria: 'Limpieza' })).e, false);          // (e) categoría
    assert.equal(estado(mod('a', { cantidad_actual: 0 })).f, false);                           // (f) stock tocado
    assert.equal(evaluar({ ...base, scraped: scraped.slice(0, 3), scraped_raw_count: 3 }, itemsOk)[0].ok, false); // (a) < 5
  });

  describe('(g) líneas descartadas por el parser', () => {
    const g = (raw, parseadas) => evaluar({ ...base, scraped_raw_count: raw, scraped: Array(parseadas).fill(scraped[0]) }, itemsOk)
      .find(r => r.id === 'g').ok;
    test('PASS si no se descartó nada o poco', () => {
      assert.equal(g(53, 53), true);
      assert.equal(g(53, 50), true);   // 3 líneas = 5.7%
      assert.equal(g(30, 27), true);   // 3 líneas = 10% justo
    });
    test('FAIL con más de 3 líneas aunque sea < 10%', () => {
      assert.equal(g(53, 49), false);  // 4 líneas = 7.5%
    });
    test('FAIL con más del 10% aunque sean <= 3 líneas', () => {
      assert.equal(g(20, 17), false);  // 3 líneas = 15%
      assert.equal(g(6, 5), false);    // 1 línea = 16.7%
    });
    test('FAIL si el reporte no trae scraped_raw_count', () => {
      const { scraped_raw_count, ...sinRaw } = base;
      assert.equal(estado(itemsOk, sinRaw).g, false);
    });
  });

  describe('(h) paulina_* en la DB = lo planificado', () => {
    test('FAIL si difiere el texto, la cantidad o la unidad', () => {
      assert.equal(estado(mod('a', { paulina_texto: '3 limones' })).h, false);
      assert.equal(estado(mod('a', { paulina_cantidad: 3 })).h, false);
      assert.equal(estado(mod('a', { paulina_unidad: 'kg' })).h, false);
      assert.equal(estado(mod(idDe('aceite de oliva'), { paulina_cantidad: 1 })).h, false); // null planificado
    });
    test('numeric de Postgres como string no es falso positivo', () => {
      assert.equal(estado(mod('a', { paulina_cantidad: '4' })).h, true);
    });
    test('FAIL si un insertado planificado no quedó marcado', () => {
      const sinGarbanzos = itemsOk.filter(i => i.id !== idDe('garbanzos'));
      assert.equal(estado(sinGarbanzos).h, false);
    });
    test('FAIL si el reporte no trae planificados', () => {
      const { planificados, ...sinPlan } = base;
      assert.equal(estado(itemsOk, sinPlan).h, false);
    });
  });
});
