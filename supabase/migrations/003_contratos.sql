-- =====================================================================
-- PATRICIA DAADIN — Fase 2 del panel CRM: Contratos y alquileres
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- 001 (schema.sql) y 002 (inmuebles_personas.sql).
--
-- Puerto de reglas-negocio-alquileres.md de InmoGestion a Postgres:
-- las cuotas se generan TODAS por adelantado, sin prorratear la primera
-- ni la última, con ajuste por porcentaje fijo o por índice BCRA
-- (coeficiente). El módulo de Cobranzas (cobrar una cuota) es la fase
-- siguiente — acá solo se arma el contrato y su calendario de cuotas.
--
-- Simplificaciones deliberadas frente a InmoGestion (documentadas, no
-- son un olvido):
--   - Índice tipo "variación" (IPC): la fórmula de composición mensual
--     queda pendiente en el propio InmoGestion ("no se preguntó en esa
--     sesión") — acá se comporta igual: la generación se detiene en el
--     primer ajuste que la necesite, resumible más adelante.
--   - El valor de índice para un ajuste se busca "el más reciente en o
--     antes" de la fecha, no una coincidencia exacta — no hay import
--     automático del BCRA todavía, así que exigir fecha exacta haría
--     esto impracticable con carga manual.
--   - Al rescindir, la propiedad siempre vuelve a 'disponible' (el caso
--     "operación 'ambas' con una venta en curso" depende del módulo de
--     Ventas, que todavía no existe).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Índices de ajuste (catálogo + valores históricos)
-- ---------------------------------------------------------------------
create table if not exists public.indices (
  codigo text primary key,
  nombre text not null,
  descripcion text,
  tipo_calculo text not null default 'coeficiente' check (tipo_calculo in ('coeficiente','variacion')),
  activo boolean not null default true
);

insert into public.indices (codigo, nombre, tipo_calculo, descripcion) values
  ('ICL', 'Índice para Contratos de Locación', 'coeficiente', 'BCRA. Combina 50% salarios (RIPTE) y 50% inflación (IPC).'),
  ('IPC', 'Índice de Precios al Consumidor', 'variacion', 'INDEC.'),
  ('UVA', 'Unidad de Valor Adquisitivo', 'coeficiente', 'BCRA.'),
  ('CER', 'Coeficiente de Estabilización de Referencia', 'coeficiente', 'BCRA.'),
  ('CASA_PROPIA', 'Índice Casa Propia', 'coeficiente', 'Menor entre variación salarial y de inflación.')
on conflict (codigo) do nothing;

create table if not exists public.indice_valores (
  id bigint generated always as identity primary key,
  indice_codigo text not null references public.indices(codigo),
  fecha date not null,
  valor numeric not null,
  origen text not null default 'manual' check (origen in ('manual','api_bcra','importado')),
  creado_en timestamptz not null default now(),
  unique (indice_codigo, fecha)
);

create index if not exists idx_indice_valores_fecha on public.indice_valores (indice_codigo, fecha);

alter table public.indices enable row level security;
alter table public.indice_valores enable row level security;

-- El catálogo de índices se puede leer en público (no tiene datos sensibles
-- y no cuesta nada); los valores cargados y el resto quedan solo para el admin.
create policy "Public select indices" on public.indices for select using (true);
create policy "Authenticated select indice_valores" on public.indice_valores for select to authenticated using (true);
create policy "Authenticated insert indice_valores" on public.indice_valores for insert to authenticated with check (true);
create policy "Authenticated update indice_valores" on public.indice_valores for update to authenticated using (true) with check (true);
create policy "Authenticated delete indice_valores" on public.indice_valores for delete to authenticated using (true);

-- ---------------------------------------------------------------------
-- Contratos
-- ---------------------------------------------------------------------
create table if not exists public.contratos (
  id bigint generated always as identity primary key,
  propiedad_id bigint not null references public.propiedades(id),
  inquilino_id bigint not null references public.personas(id),

  tipo_contrato text not null default 'vivienda' check (tipo_contrato in ('vivienda','comercial','cochera','temporal','otro')),
  fecha_inicio date not null,
  fecha_fin date not null,
  dia_vencimiento int not null default 10 check (dia_vencimiento between 1 and 31),

  monto_inicial bigint not null,       -- centavos
  moneda text not null default 'ARS' check (moneda in ('ARS','USD')),
  deposito bigint default 0,           -- centavos

  ajuste_tipo text not null default 'porcentaje' check (ajuste_tipo in ('sin_ajuste','porcentaje','indice')),
  ajuste_meses int default 6,
  ajuste_valor numeric,
  indice_codigo text references public.indices(codigo),
  indice_valor_base numeric,

  -- Contrato que ya estaba en curso al cargarlo en el sistema (firmado
  -- hace tiempo): si se completan los dos, la generación de cuotas
  -- arranca acá en vez de en fecha_inicio/monto_inicial, para no cobrar
  -- ni liquidar de nuevo meses que la inmobiliaria ya cobró a mano antes
  -- de tener el sistema.
  fecha_inicio_generacion date,
  monto_actual bigint,                 -- centavos

  comision_admin_pct numeric,
  liquidacion_garantizada boolean not null default false,

  estado text not null default 'vigente' check (estado in ('vigente','vencido','rescindido','renovado')),
  fecha_rescision date,
  motivo_rescision text,
  contrato_origen_id bigint references public.contratos(id),
  notas text,
  creado_en timestamptz not null default now()
);

create index if not exists idx_contratos_estado on public.contratos (estado);
create index if not exists idx_contratos_propiedad on public.contratos (propiedad_id);
create index if not exists idx_contratos_inquilino on public.contratos (inquilino_id);

alter table public.contratos enable row level security;
create policy "Authenticated select contratos" on public.contratos for select to authenticated using (true);
create policy "Authenticated insert contratos" on public.contratos for insert to authenticated with check (true);
create policy "Authenticated update contratos" on public.contratos for update to authenticated using (true) with check (true);

create table if not exists public.contrato_garantes (
  id bigint generated always as identity primary key,
  contrato_id bigint not null references public.contratos(id) on delete cascade,
  persona_id bigint not null references public.personas(id),
  tipo_garantia text default 'personal' check (tipo_garantia in ('personal','propietaria','seguro_caucion','recibo_sueldo')),
  detalle text,
  unique (contrato_id, persona_id)
);

alter table public.contrato_garantes enable row level security;
create policy "Authenticated all contrato_garantes" on public.contrato_garantes
  for all to authenticated using (true) with check (true);

create table if not exists public.contrato_ajustes (
  id bigint generated always as identity primary key,
  contrato_id bigint not null references public.contratos(id) on delete cascade,
  fecha_vigencia date not null,
  monto_anterior bigint not null,
  monto_nuevo bigint not null,
  indice_tipo text,
  indice_valor numeric,
  observaciones text,
  creado_en timestamptz not null default now()
);

alter table public.contrato_ajustes enable row level security;
create policy "Authenticated all contrato_ajustes" on public.contrato_ajustes
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Cuotas (el cobro en sí — módulo Cobranzas — es la fase siguiente)
-- ---------------------------------------------------------------------
create table if not exists public.cuotas (
  id bigint generated always as identity primary key,
  contrato_id bigint not null references public.contratos(id) on delete cascade,
  periodo text not null,               -- 'AAAA-MM'
  fecha_vencimiento date not null,
  monto_alquiler bigint not null,      -- centavos
  monto_expensas bigint not null default 0,
  monto_otros bigint not null default 0,
  monto_punitorio bigint not null default 0,
  detalle_otros text,
  estado text not null default 'pendiente' check (estado in ('pendiente','parcial','pagada','anulada')),
  creado_en timestamptz not null default now(),
  unique (contrato_id, periodo)
);

create index if not exists idx_cuotas_vencimiento on public.cuotas (fecha_vencimiento);
create index if not exists idx_cuotas_estado on public.cuotas (estado);

alter table public.cuotas enable row level security;
create policy "Authenticated all cuotas" on public.cuotas
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Helpers de fecha: sumar un mes "con clamp" (si el día no existe en el
-- mes destino, cae en el último día de ese mes — ej: 31 de enero + 1 mes
-- con día 31 pedido cae en 28/29 de febrero).
-- ---------------------------------------------------------------------
create or replace function public.fecha_con_dia_clamp(anio int, mes int, dia int)
returns date
language plpgsql
immutable
as $$
declare
  ultimo_dia int;
begin
  ultimo_dia := extract(day from (make_date(anio, mes, 1) + interval '1 month - 1 day'))::int;
  return make_date(anio, mes, least(dia, ultimo_dia));
end;
$$;

create or replace function public.siguiente_vencimiento(actual date, dia int)
returns date
language plpgsql
immutable
as $$
declare
  base date;
begin
  base := actual + interval '1 month';
  return public.fecha_con_dia_clamp(extract(year from base)::int, extract(month from base)::int, dia);
end;
$$;

-- Valor de índice más reciente en o antes de la fecha pedida (no exige
-- coincidencia exacta: sin importación automática del BCRA, cargar el
-- valor de cada día exacto es impracticable a mano).
create or replace function public.valor_indice_en_o_antes(p_codigo text, p_fecha date)
returns numeric
language sql
stable
as $$
  select valor from public.indice_valores
  where indice_codigo = p_codigo and fecha <= p_fecha
  order by fecha desc limit 1;
$$;

-- ---------------------------------------------------------------------
-- Generación de cuotas — resumible: genera las que falten a partir de
-- la última existente (o desde el inicio si el contrato no tiene
-- ninguna todavía). Se detiene si necesita un valor de índice que
-- todavía no está cargado, dejando el contrato listo para retomar
-- cuando se cargue ese valor.
-- ---------------------------------------------------------------------
create or replace function public.generar_cuotas_pendientes(p_contrato_id bigint)
returns table (generadas int, detenido_por_indice boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  venc date;
  ultima_venc date;
  monto_vigente bigint;
  ultimo_ajuste_fecha date;
  meses_desde_ajuste int;
  nuevo_monto bigint;
  valor_indice numeric;
  contador int := 0;
  detenido boolean := false;
begin
  select * into c from public.contratos where id = p_contrato_id;
  if not found then
    raise exception 'No existe ese contrato.';
  end if;

  select max(fecha_vencimiento) into ultima_venc
  from public.cuotas where contrato_id = p_contrato_id and estado <> 'anulada';

  if ultima_venc is not null then
    venc := public.siguiente_vencimiento(ultima_venc, c.dia_vencimiento);
    -- Retoma el monto y la fecha de referencia del último ajuste aplicado
    -- (o del monto/fecha de inicio si todavía no se aplicó ninguno).
    select monto_nuevo, fecha_vigencia into monto_vigente, ultimo_ajuste_fecha
    from public.contrato_ajustes where contrato_id = p_contrato_id
    order by fecha_vigencia desc limit 1;
    if monto_vigente is null then
      monto_vigente := coalesce(c.monto_actual, c.monto_inicial);
      ultimo_ajuste_fecha := coalesce(c.fecha_inicio_generacion, c.fecha_inicio);
    end if;
  else
    declare
      inicio date := coalesce(c.fecha_inicio_generacion, c.fecha_inicio);
    begin
      venc := public.fecha_con_dia_clamp(extract(year from inicio)::int, extract(month from inicio)::int, c.dia_vencimiento);
      if venc < inicio then
        venc := public.siguiente_vencimiento(venc, c.dia_vencimiento);
      end if;
    end;
    monto_vigente := coalesce(c.monto_actual, c.monto_inicial);
    ultimo_ajuste_fecha := coalesce(c.fecha_inicio_generacion, c.fecha_inicio);
  end if;

  loop
    -- ¿Corresponde un ajuste antes de esta cuota?
    if c.ajuste_tipo <> 'sin_ajuste' and c.ajuste_meses is not null and c.ajuste_meses > 0 then
      meses_desde_ajuste := (extract(year from venc) - extract(year from ultimo_ajuste_fecha)) * 12
                           + (extract(month from venc) - extract(month from ultimo_ajuste_fecha));
      if meses_desde_ajuste >= c.ajuste_meses then
        nuevo_monto := null;
        valor_indice := null;

        if c.ajuste_tipo = 'porcentaje' then
          nuevo_monto := round(monto_vigente * (1 + coalesce(c.ajuste_valor, 0) / 100));
        elsif c.ajuste_tipo = 'indice' then
          if (select tipo_calculo from public.indices where codigo = c.indice_codigo) = 'variacion' then
            nuevo_monto := null; -- fórmula de composición mensual no implementada (ver cabecera)
          else
            valor_indice := public.valor_indice_en_o_antes(c.indice_codigo, venc);
            if valor_indice is not null and c.indice_valor_base is not null and c.indice_valor_base <> 0 then
              nuevo_monto := round(c.monto_inicial * valor_indice / c.indice_valor_base);
            end if;
          end if;
        end if;

        if nuevo_monto is null then
          detenido := true;
          exit;
        end if;

        insert into public.contrato_ajustes (contrato_id, fecha_vigencia, monto_anterior, monto_nuevo, indice_tipo, indice_valor)
        values (p_contrato_id, venc, monto_vigente, nuevo_monto, case when c.ajuste_tipo = 'indice' then c.indice_codigo end, valor_indice);

        monto_vigente := nuevo_monto;
        ultimo_ajuste_fecha := venc;
      end if;
    end if;

    insert into public.cuotas (contrato_id, periodo, fecha_vencimiento, monto_alquiler)
    values (p_contrato_id, to_char(venc, 'YYYY-MM'), venc, monto_vigente)
    on conflict (contrato_id, periodo) do nothing;
    contador := contador + 1;

    exit when venc >= c.fecha_fin;
    venc := public.siguiente_vencimiento(venc, c.dia_vencimiento);
  end loop;

  return query select contador, detenido;
end;
$$;

-- ---------------------------------------------------------------------
-- Alta de contrato: valida el inmueble, valida que no tenga otro
-- contrato vigente encima, inserta contrato + garantes, pasa la
-- propiedad a 'alquilada' y genera las cuotas — todo en una transacción.
-- ---------------------------------------------------------------------
create or replace function public.crear_contrato(p_datos jsonb, p_garantes jsonb default '[]'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_propiedad record;
  v_contrato_id bigint;
  g jsonb;
begin
  select * into v_propiedad from public.propiedades where id = (p_datos->>'propiedad_id')::bigint;
  if not found then
    raise exception 'No existe esa propiedad.';
  end if;
  if v_propiedad.estado not in ('disponible', 'alquilada') then
    raise exception 'Ese inmueble está "%", no se le puede armar un contrato de alquiler.', v_propiedad.estado;
  end if;
  if exists (select 1 from public.contratos where propiedad_id = v_propiedad.id and estado = 'vigente') then
    raise exception 'Ese inmueble ya tiene un contrato vigente.';
  end if;

  insert into public.contratos (
    propiedad_id, inquilino_id, tipo_contrato, fecha_inicio, fecha_fin, dia_vencimiento,
    monto_inicial, moneda, deposito, ajuste_tipo, ajuste_meses, ajuste_valor,
    indice_codigo, indice_valor_base, fecha_inicio_generacion, monto_actual,
    comision_admin_pct, liquidacion_garantizada, notas
  ) values (
    v_propiedad.id, (p_datos->>'inquilino_id')::bigint,
    coalesce(p_datos->>'tipo_contrato', 'vivienda'),
    (p_datos->>'fecha_inicio')::date, (p_datos->>'fecha_fin')::date,
    coalesce((p_datos->>'dia_vencimiento')::int, 10),
    (p_datos->>'monto_inicial')::bigint, coalesce(p_datos->>'moneda', 'ARS'),
    coalesce((p_datos->>'deposito')::bigint, 0),
    coalesce(p_datos->>'ajuste_tipo', 'porcentaje'),
    (p_datos->>'ajuste_meses')::int, (p_datos->>'ajuste_valor')::numeric,
    p_datos->>'indice_codigo', (p_datos->>'indice_valor_base')::numeric,
    (p_datos->>'fecha_inicio_generacion')::date, (p_datos->>'monto_actual')::bigint,
    (p_datos->>'comision_admin_pct')::numeric,
    coalesce((p_datos->>'liquidacion_garantizada')::boolean, false),
    p_datos->>'notas'
  ) returning id into v_contrato_id;

  for g in select * from jsonb_array_elements(coalesce(p_garantes, '[]'::jsonb)) loop
    insert into public.contrato_garantes (contrato_id, persona_id, tipo_garantia, detalle)
    values (v_contrato_id, (g->>'persona_id')::bigint, coalesce(g->>'tipo_garantia', 'personal'), g->>'detalle');
  end loop;

  update public.propiedades set estado = 'alquilada', actualizado_en = now() where id = v_propiedad.id;

  perform public.generar_cuotas_pendientes(v_contrato_id);

  return v_contrato_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Rescisión: nunca se borra nada. Anula las cuotas futuras (pendientes)
-- y libera el inmueble.
-- ---------------------------------------------------------------------
create or replace function public.rescindir_contrato(p_contrato_id bigint, p_fecha_rescision date, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public.contratos where id = p_contrato_id;
  if not found then raise exception 'No existe ese contrato.'; end if;
  if c.estado <> 'vigente' then raise exception 'Ese contrato no está vigente.'; end if;
  if p_fecha_rescision <= c.fecha_inicio or p_fecha_rescision >= c.fecha_fin then
    raise exception 'La fecha de rescisión tiene que estar dentro del período del contrato.';
  end if;

  update public.contratos
  set estado = 'rescindido', fecha_rescision = p_fecha_rescision, motivo_rescision = p_motivo
  where id = p_contrato_id;

  update public.cuotas
  set estado = 'anulada'
  where contrato_id = p_contrato_id and fecha_vencimiento > p_fecha_rescision and estado <> 'pagada';

  if not exists (select 1 from public.contratos where propiedad_id = c.propiedad_id and estado = 'vigente') then
    update public.propiedades set estado = 'disponible', actualizado_en = now() where id = c.propiedad_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Renovación: el contrato original no se edita — se marca 'renovado' y
-- se crea uno nuevo enlazado, con sus propias cuotas.
-- ---------------------------------------------------------------------
create or replace function public.renovar_contrato(p_contrato_origen_id bigint, p_cambios jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_nuevo_id bigint;
  v_datos jsonb;
begin
  select * into o from public.contratos where id = p_contrato_origen_id;
  if not found then raise exception 'No existe ese contrato.'; end if;
  if o.estado <> 'vigente' then raise exception 'Ese contrato no está vigente.'; end if;
  if not (p_cambios ? 'monto_inicial') then
    raise exception 'El monto se renegocia en cada renovación — cargalo.';
  end if;
  if o.ajuste_tipo = 'indice' and not (p_cambios ? 'indice_valor_base') then
    raise exception 'Este contrato ajusta por índice — cargá el valor base para la renovación.';
  end if;

  v_datos := jsonb_build_object(
    'propiedad_id', o.propiedad_id,
    'inquilino_id', o.inquilino_id,
    'tipo_contrato', o.tipo_contrato,
    'fecha_inicio', coalesce(p_cambios->>'fecha_inicio', o.fecha_fin::text),
    'fecha_fin', p_cambios->>'fecha_fin',
    'dia_vencimiento', o.dia_vencimiento,
    'moneda', o.moneda,
    'deposito', o.deposito,
    'ajuste_tipo', o.ajuste_tipo,
    'ajuste_meses', o.ajuste_meses,
    'ajuste_valor', o.ajuste_valor,
    'indice_codigo', o.indice_codigo,
    'comision_admin_pct', o.comision_admin_pct,
    'liquidacion_garantizada', o.liquidacion_garantizada
  ) || p_cambios;

  update public.contratos set estado = 'renovado' where id = p_contrato_origen_id;

  insert into public.contratos (
    propiedad_id, inquilino_id, tipo_contrato, fecha_inicio, fecha_fin, dia_vencimiento,
    monto_inicial, moneda, deposito, ajuste_tipo, ajuste_meses, ajuste_valor,
    indice_codigo, indice_valor_base, comision_admin_pct, liquidacion_garantizada, contrato_origen_id
  ) values (
    (v_datos->>'propiedad_id')::bigint, (v_datos->>'inquilino_id')::bigint,
    v_datos->>'tipo_contrato', (v_datos->>'fecha_inicio')::date, (v_datos->>'fecha_fin')::date,
    (v_datos->>'dia_vencimiento')::int, (v_datos->>'monto_inicial')::bigint, v_datos->>'moneda',
    coalesce((v_datos->>'deposito')::bigint, 0), v_datos->>'ajuste_tipo', (v_datos->>'ajuste_meses')::int,
    (v_datos->>'ajuste_valor')::numeric, v_datos->>'indice_codigo', (v_datos->>'indice_valor_base')::numeric,
    (v_datos->>'comision_admin_pct')::numeric, coalesce((v_datos->>'liquidacion_garantizada')::boolean, false),
    p_contrato_origen_id
  ) returning id into v_nuevo_id;

  update public.propiedades set estado = 'alquilada', actualizado_en = now() where id = (v_datos->>'propiedad_id')::bigint;

  perform public.generar_cuotas_pendientes(v_nuevo_id);

  return v_nuevo_id;
end;
$$;
