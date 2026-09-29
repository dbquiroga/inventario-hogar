-- Marca de origen para ítems que vienen del menú semanal de Paulina Cocina.
-- Correr una sola vez en Supabase → SQL Editor.
alter table items
  add column if not exists origen           text,         -- 'paulina' si el ítem lo creó la sync
  add column if not exists paulina_semana   int,          -- semana del menú vigente; null = no está en el menú actual
  add column if not exists paulina_cantidad numeric,      -- cantidad que pide la lista de Paulina
  add column if not exists paulina_unidad   text,
  add column if not exists paulina_texto    text,         -- línea original tal cual la publica Paulina
  add column if not exists paulina_sync_at  timestamptz;  -- cuándo se sincronizó
