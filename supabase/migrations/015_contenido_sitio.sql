-- =============================================================================
-- Textos del sitio editables desde el panel admin (sin tocar código).
-- Cada fila es un bloque de texto de la web pública, identificado por una
-- clave fija que el HTML referencia con data-content-key="...". El sitio
-- público puede LEER todo (para mostrarlo), pero solo el/la admin logueado
-- puede editar — mismo patrón que la tabla "config" (006_cobranzas.sql).
-- Si una clave no tiene fila o está vacía, el HTML muestra el texto por
-- defecto que ya trae escrito (fallback), así que nunca queda en blanco.
-- =============================================================================

create table if not exists public.contenido_sitio (
  clave text primary key,
  valor text not null,
  descripcion text,
  actualizado_en timestamptz not null default now()
);

insert into public.contenido_sitio (clave, valor, descripcion) values
  ('home_hero_titulo', '25 años administrando propiedades ajenas. Ahora, también las tuyas.', 'Home: título grande de la portada'),
  ('home_hero_texto', 'Matrícula MP 421. Venta, alquiler y administración gestionados por la misma persona de principio a fin — sin equipo de ventas ni intermediarios de por medio.', 'Home: texto debajo del título de la portada'),
  ('nosotros_historia_p1', 'Trabajo en el rubro administración hace más de 25 años. Empecé como secretaria en Caballero Propiedades, y ahí fue donde aprendí el oficio desde adentro. Me recibí como martillera hace 13 años, pero recién el año pasado obtuve mi matrícula profesional (MP 421) y retomé la actividad de forma independiente.', 'Nosotros: primer párrafo de "Mi historia"'),
  ('nosotros_historia_p2', 'Además de la actividad inmobiliaria, llevo adelante otros emprendimientos: una pinturería y la administración de mis propios alquileres temporarios. También presto servicios a empresas mineras y otras compañías, ya que estoy inscripta como proveedora. Esa experiencia de gestión diversa es la que aplico a cada operación inmobiliaria que manejo.', 'Nosotros: segundo párrafo de "Mi historia"')
on conflict (clave) do nothing;

alter table public.contenido_sitio enable row level security;

-- Cualquier visitante puede leer los textos (para que se muestren en la web).
create policy "Public read contenido_sitio"
  on public.contenido_sitio for select
  to anon, authenticated
  using (true);

-- Solo el/la admin logueado puede editarlos.
create policy "Authenticated write contenido_sitio"
  on public.contenido_sitio for all
  to authenticated
  using (true)
  with check (true);

-- Refresca automáticamente "actualizado_en" en cada edición.
create or replace function public.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

drop trigger if exists trg_contenido_sitio_actualizado_en on public.contenido_sitio;
create trigger trg_contenido_sitio_actualizado_en
  before update on public.contenido_sitio
  for each row
  execute function public.tocar_actualizado_en();
