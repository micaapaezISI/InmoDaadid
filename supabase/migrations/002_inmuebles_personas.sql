-- =====================================================================
-- PATRICIA DAADIN — Fase 1 del panel CRM: Personas + Inmuebles
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- supabase/schema.sql — Supabase Dashboard → SQL Editor → New query.
--
-- Qué hace:
--   1. Crea "personas" (propietarios/inquilinos/garantes — todavía solo
--      se usan como propietarios, hasta que exista el módulo Contratos).
--   2. Crea "propiedades" (reemplaza a "properties", con muchos más
--      campos) + "propiedad_propietario" + "propiedad_foto".
--   3. Migra las propiedades que ya tengas cargadas en "properties" a la
--      tabla nueva (no borra "properties": queda como respaldo, se puede
--      eliminar a mano más adelante una vez que confirmes que todo
--      anduvo bien).
--
-- Convención heredada de InmoGestion: los precios se guardan en
-- centavos (bigint), nunca en decimales — evita errores de redondeo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------
create table if not exists public.personas (
  id bigint generated always as identity primary key,
  tipo_persona text not null default 'fisica' check (tipo_persona in ('fisica','juridica')),
  nombre text not null,
  documento_tipo text default 'DNI' check (documento_tipo in ('DNI','CUIT','CUIL','LE','LC','PAS')),
  documento text,
  telefono text,
  telefono_alt text,
  email text,
  domicilio text,
  localidad text,
  provincia text,
  fecha_nacimiento date,
  ocupacion text,
  cbu text,
  banco text,
  condicion_iva text default 'consumidor_final' check (condicion_iva in
    ('responsable_inscripto','monotributista','exento','consumidor_final','no_categorizado')),
  notas text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz
);

create index if not exists idx_personas_nombre on public.personas (nombre);
create index if not exists idx_personas_documento on public.personas (documento);

alter table public.personas enable row level security;

create policy "Authenticated select personas" on public.personas
  for select to authenticated using (true);
create policy "Authenticated insert personas" on public.personas
  for insert to authenticated with check (true);
create policy "Authenticated update personas" on public.personas
  for update to authenticated using (true) with check (true);
create policy "Authenticated delete personas" on public.personas
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------
-- Propiedades (reemplaza a "properties")
-- ---------------------------------------------------------------------
create table if not exists public.propiedades (
  id bigint generated always as identity primary key,
  codigo text unique,

  tipo text not null default 'casa' check (tipo in
    ('casa','departamento','local','oficina','terreno','galpon','cochera','campo','otro')),
  -- 'temporal' (alquiler temporario/turístico) es un agregado propio de este
  -- sitio: InmoGestion solo contempla 'alquiler' | 'venta' | 'ambas'.
  operacion text not null default 'alquiler' check (operacion in ('alquiler','venta','ambas','temporal')),
  estado text not null default 'disponible' check (estado in
    ('disponible','reservada','alquilada','vendida','suspendida')),

  calle text,
  numero text,
  piso text,
  departamento text,
  barrio text,
  localidad text default 'San Salvador de Jujuy',
  provincia text default 'Jujuy',

  superficie_total numeric,
  superficie_cubierta numeric,
  ambientes int,
  dormitorios int default 0,
  banos int default 0,
  cocheras int default 0,
  antiguedad int,
  descripcion text,

  precio_alquiler bigint,             -- centavos
  moneda_alquiler text default 'ARS' check (moneda_alquiler in ('ARS','USD')),
  precio_venta bigint,                -- centavos
  moneda_venta text default 'USD' check (moneda_venta in ('ARS','USD')),
  expensas bigint,                    -- centavos
  comision_admin_pct numeric,

  publicar_web boolean not null default false,
  titulo_publico text,
  descripcion_publica text,
  ocultar_direccion boolean not null default false,

  -- Agregados propios de este sitio (no existen en InmoGestion):
  amenities text[] not null default '{}',   -- lista de características para la ficha pública
  featured boolean not null default false,  -- aparece en "Propiedades destacadas" de la home

  notas text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz
);

create index if not exists idx_propiedades_estado on public.propiedades (estado);
create index if not exists idx_propiedades_operacion on public.propiedades (operacion);
create index if not exists idx_propiedades_barrio on public.propiedades (barrio);
create index if not exists idx_propiedades_activo on public.propiedades (activo);
create index if not exists idx_propiedades_publicar_web on public.propiedades (publicar_web);

alter table public.propiedades enable row level security;

-- El público solo ve lo publicado y activo; el admin logueado ve todo.
create policy "Public select propiedades publicadas" on public.propiedades
  for select using (publicar_web = true and activo = true);
create policy "Authenticated select propiedades" on public.propiedades
  for select to authenticated using (true);
create policy "Authenticated insert propiedades" on public.propiedades
  for insert to authenticated with check (true);
create policy "Authenticated update propiedades" on public.propiedades
  for update to authenticated using (true) with check (true);
create policy "Authenticated delete propiedades" on public.propiedades
  for delete to authenticated using (true);

-- Código autogenerado tipo PR-0001 — sobre el máximo numérico existente,
-- no sobre el último id (si se borró o se cargó un código a mano, el
-- correlativo sigue bien). Mismo criterio que siguienteCodigo() de InmoGestion.
create or replace function public.siguiente_codigo_propiedad()
returns text
language plpgsql
as $$
declare
  maximo int;
begin
  select coalesce(max(substring(codigo from 4)::int), 0) into maximo
  from public.propiedades
  where codigo ~ '^PR-[0-9]+$';
  return 'PR-' || lpad((maximo + 1)::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------
-- Propietarios de cada propiedad (una propiedad puede tener varios,
-- con distinto porcentaje — habitual en herencias)
-- ---------------------------------------------------------------------
create table if not exists public.propiedad_propietario (
  id bigint generated always as identity primary key,
  propiedad_id bigint not null references public.propiedades(id) on delete cascade,
  persona_id bigint not null references public.personas(id),
  porcentaje numeric not null default 100,
  es_contacto_principal boolean not null default false,
  unique (propiedad_id, persona_id)
);

alter table public.propiedad_propietario enable row level security;

create policy "Authenticated select propiedad_propietario" on public.propiedad_propietario
  for select to authenticated using (true);
create policy "Authenticated insert propiedad_propietario" on public.propiedad_propietario
  for insert to authenticated with check (true);
create policy "Authenticated update propiedad_propietario" on public.propiedad_propietario
  for update to authenticated using (true) with check (true);
create policy "Authenticated delete propiedad_propietario" on public.propiedad_propietario
  for delete to authenticated using (true);

-- Reemplaza de una sola vez la lista de propietarios de una propiedad
-- (borra + reinserta dentro de la misma transacción de la función).
-- Valida que los porcentajes sumen 100, igual que normalizar() en
-- propiedades.js de InmoGestion.
create or replace function public.reemplazar_propietarios(
  p_propiedad_id bigint,
  p_propietarios jsonb  -- [{persona_id, porcentaje, es_contacto_principal}, ...]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  suma numeric;
begin
  if jsonb_array_length(coalesce(p_propietarios, '[]'::jsonb)) > 0 then
    select sum((p->>'porcentaje')::numeric) into suma
    from jsonb_array_elements(p_propietarios) p;

    if abs(suma - 100) > 0.01 then
      raise exception 'Los porcentajes suman %. Tienen que sumar 100%%.', suma;
    end if;
  end if;

  delete from public.propiedad_propietario where propiedad_id = p_propiedad_id;

  insert into public.propiedad_propietario (propiedad_id, persona_id, porcentaje, es_contacto_principal)
  select
    p_propiedad_id,
    (p->>'persona_id')::bigint,
    (p->>'porcentaje')::numeric,
    coalesce((p->>'es_contacto_principal')::boolean, ord = 1)
  from jsonb_array_elements(coalesce(p_propietarios, '[]'::jsonb)) with ordinality as t(p, ord);
end;
$$;

-- ---------------------------------------------------------------------
-- Fotos de cada propiedad (reemplaza el array "images" de "properties")
-- ---------------------------------------------------------------------
create table if not exists public.propiedad_foto (
  id bigint generated always as identity primary key,
  propiedad_id bigint not null references public.propiedades(id) on delete cascade,
  url text not null,
  orden int not null default 0,
  es_portada boolean not null default false
);

create index if not exists idx_propiedad_foto_propiedad on public.propiedad_foto (propiedad_id, orden);

alter table public.propiedad_foto enable row level security;

-- El público ve las fotos solo de propiedades publicadas.
create policy "Public select fotos de propiedades publicadas" on public.propiedad_foto
  for select using (
    exists (
      select 1 from public.propiedades p
      where p.id = propiedad_foto.propiedad_id
        and p.publicar_web = true and p.activo = true
    )
  );
create policy "Authenticated select propiedad_foto" on public.propiedad_foto
  for select to authenticated using (true);
create policy "Authenticated insert propiedad_foto" on public.propiedad_foto
  for insert to authenticated with check (true);
create policy "Authenticated update propiedad_foto" on public.propiedad_foto
  for update to authenticated using (true) with check (true);
create policy "Authenticated delete propiedad_foto" on public.propiedad_foto
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------
-- Migración de datos: "properties" (esquema viejo) → "propiedades"
-- No borra "properties" — queda de respaldo. Solo corre si "propiedades"
-- todavía está vacía, para no duplicar si este archivo se corre dos veces.
-- ---------------------------------------------------------------------
do $$
declare
  ya_migrado boolean;
  fila record;
  nuevo_id bigint;
  img text;
  i int;
begin
  select exists(select 1 from public.propiedades limit 1) into ya_migrado;
  if ya_migrado then
    raise notice 'propiedades ya tiene datos — se omite la migración desde properties.';
    return;
  end if;

  for fila in select * from public.properties loop
    insert into public.propiedades (
      codigo, tipo, operacion, estado,
      calle, barrio, localidad,
      dormitorios, banos, superficie_total,
      descripcion, descripcion_publica, titulo_publico,
      precio_alquiler, moneda_alquiler, precio_venta, moneda_venta,
      publicar_web, amenities, featured, activo, creado_en
    ) values (
      public.siguiente_codigo_propiedad(),
      case fila.type when 'terreno' then 'terreno' when 'local' then 'local'
                      when 'departamento' then 'departamento' else 'casa' end,
      fila.operation,
      'disponible',
      fila.address, fila.zone, coalesce(fila.zone, 'San Salvador de Jujuy'),
      fila.bedrooms, fila.bathrooms, fila.area,
      fila.description, fila.description, fila.title,
      case when fila.operation <> 'venta' then round(fila.price * 100) else null end,
      case when fila.operation <> 'venta' then fila.currency else 'ARS' end,
      case when fila.operation = 'venta' then round(fila.price * 100) else null end,
      case when fila.operation = 'venta' then fila.currency else 'USD' end,
      true, coalesce(fila.amenities, '{}'), fila.featured, fila.active, fila.created_at
    ) returning id into nuevo_id;

    if fila.images is not null then
      i := 0;
      foreach img in array fila.images loop
        insert into public.propiedad_foto (propiedad_id, url, orden, es_portada)
        values (nuevo_id, img, i, i = 0);
        i := i + 1;
      end loop;
    end if;
  end loop;
end $$;
