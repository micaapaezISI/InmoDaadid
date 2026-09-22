-- =============================================================================
-- Suma color y tipografía personalizables a cada texto editable, y separa
-- el título de la home en dos claves (antes era una sola): el título de la
-- home tiene una frase resaltada en rojo al final ("también las tuyas.")
-- que se perdía al editar el texto como un solo bloque, porque pisaba el
-- <span> que le daba ese color. Ver js/contenido.js y admin-contenido.js.
-- =============================================================================

alter table public.contenido_sitio
  add column if not exists color text,
  add column if not exists fuente text check (fuente is null or fuente in ('sora', 'mulish'));

insert into public.contenido_sitio (clave, valor, descripcion) values
  ('home_hero_titulo_resaltado', 'también las tuyas.', 'Home: frase resaltada en rojo al final del título')
on conflict (clave) do nothing;
