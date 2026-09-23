-- Actualiza los 3 textos pedidos por la clienta el 23/09/2026 (hero + "Mi historia").
-- Correr una sola vez en el SQL Editor de Supabase.

update public.contenido_sitio
set valor = 'Matrícula MP 421. Venta, alquiler y administración gestionados por la misma persona de principio a fin.'
where clave = 'home_hero_texto';

update public.contenido_sitio
set valor = 'Trabajo en el rubro administración hace más de 25 años. Empecé como secretaria en una inmobiliaria, y ahí fue donde aprendí el oficio desde adentro. Me recibí como martillera hace 13 años, y cuento con matrícula profesional (MP 421) para ejercer la actividad de forma independiente.'
where clave = 'nosotros_historia_p1';

update public.contenido_sitio
set valor = 'Además de la actividad inmobiliaria, llevo adelante otros emprendimientos propios y presto servicios administrativos a empresas de diversos rubros, en mi carácter de proveedora inscripta. Esa experiencia de gestión diversa es la que aplico a cada operación inmobiliaria que manejo.'
where clave = 'nosotros_historia_p2';
