-- McDash · Configuración de la base de datos en Supabase
-- Pegá TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede correr una sola vez en un proyecto nuevo.

create extension if not exists pg_trgm;

-- ───────── Pedidos de PedidosYa ─────────
create table public.pedidos (
  id          uuid primary key default gen_random_uuid(),
  creado      timestamptz not null default now(),
  numero      text not null default '',
  turno       text not null check (turno in ('Apertura', 'Medio', 'Cierre')),
  responsable text not null,
  foto        text not null,   -- ruta de la foto grande en Storage
  miniatura   text not null,   -- ruta de la foto chica (para la galería)
  creado_por  uuid default auth.uid()
);

create index pedidos_creado_idx on public.pedidos (creado desc);
create index pedidos_numero_idx on public.pedidos using gin (numero gin_trgm_ops);

-- ───────── Pases de turno ─────────
create table public.pases (
  id          uuid primary key default gen_random_uuid(),
  creado      timestamptz not null default now(),
  turno       text not null check (turno in ('Apertura', 'Medio', 'Cierre')),
  responsable text not null,
  notas       text not null default '',
  fotos       jsonb not null default '{}',  -- { tph: {foto, mini}, rating: {...}, ... }
  creado_por  uuid default auth.uid()
);

create index pases_creado_idx on public.pases (creado desc);

-- ───────── Permisos: solo usuarios con sesión iniciada ─────────
alter table public.pedidos enable row level security;
alter table public.pases   enable row level security;

create policy "equipo usa pedidos" on public.pedidos
  for all to authenticated using (true) with check (true);

create policy "equipo usa pases" on public.pases
  for all to authenticated using (true) with check (true);

-- ───────── Lugar donde se guardan las fotos (privado) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 5242880, array['image/jpeg']);

create policy "equipo ve fotos" on storage.objects
  for select to authenticated using (bucket_id = 'fotos');

create policy "equipo sube fotos" on storage.objects
  for insert to authenticated with check (bucket_id = 'fotos');

create policy "equipo borra fotos" on storage.objects
  for delete to authenticated using (bucket_id = 'fotos');

-- ───────── Que la app se actualice sola cuando otro carga algo ─────────
alter publication supabase_realtime add table public.pedidos, public.pases;
