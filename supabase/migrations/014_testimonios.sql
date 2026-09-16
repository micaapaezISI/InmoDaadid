-- =============================================================================
-- Testimonios/comentarios públicos, con moderación desde el panel admin.
-- Mismo patrón que contact_messages (insert público, lectura restringida)
-- pero acá además hace falta que el público pueda LEER los ya aprobados
-- (para mostrarlos en la home) sin poder leer los pendientes de otros.
-- =============================================================================

create table if not exists public.testimonios (
  id bigint generated always as identity primary key,
  nombre text not null check (char_length(nombre) between 1 and 100),
  comentario text not null check (char_length(comentario) between 1 and 600),
  aprobado boolean not null default false,
  creado_en timestamptz not null default now()
);

alter table public.testimonios enable row level security;

-- Cualquier visitante puede dejar un comentario, siempre sin auto-aprobarse.
create policy "Public insert testimonios"
  on public.testimonios for insert
  to anon, authenticated
  with check (aprobado = false);

-- Cualquiera puede leer los ya aprobados (para mostrarlos en la home).
create policy "Public read approved testimonios"
  on public.testimonios for select
  to anon, authenticated
  using (aprobado = true);

-- El/la admin logueado ve todos, incluidos los pendientes de moderar.
create policy "Authenticated read all testimonios"
  on public.testimonios for select
  to authenticated
  using (true);

-- El/la admin aprueba o edita.
create policy "Authenticated update testimonios"
  on public.testimonios for update
  to authenticated
  using (true)
  with check (true);

-- El/la admin rechaza (borra) un comentario.
create policy "Authenticated delete testimonios"
  on public.testimonios for delete
  to authenticated
  using (true);

create index if not exists testimonios_aprobado_idx on public.testimonios (aprobado, creado_en desc);
