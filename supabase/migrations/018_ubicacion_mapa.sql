-- =====================================================================
-- PATRICIA DAADIN — Ubicación exacta de cada inmueble en el mapa
-- Correr UNA VEZ en el SQL Editor de Supabase.
--
-- Hasta ahora el mapa de la ficha se armaba buscando el texto de la
-- dirección en Google Maps, lo que falla con barrios privados, calles
-- sin numeración o nombres genéricos ("Countries / Barrios cerrados").
-- Con estas dos columnas, desde el panel se marca el punto exacto (tocando
-- el mapa o pegando un link de Google Maps) y la ficha muestra ese punto.
-- Si quedan vacías, se sigue usando la búsqueda por dirección de antes.
-- =====================================================================

alter table public.propiedades add column if not exists latitud numeric;
alter table public.propiedades add column if not exists longitud numeric;
