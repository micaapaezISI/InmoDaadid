-- =====================================================================
-- PATRICIA DAADIN — Fase 4 del panel CRM: Gastos y Liquidación a propietarios
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- 001-006 (schema, inmuebles/personas, contratos, sus arreglos y Cobranzas).
--
-- Puerto de reglas-negocio-liquidacion.md de InmoGestion (src/liquidacion/
-- generar.js + pago.js): una liquidación es por una persona propietaria y
-- un período (AAAA-MM); cada copropietario se liquida en un registro
-- independiente, con la reconciliación de redondeo documentada en la
-- sección 5 de las reglas (el responsable de gastos absorbe el remanente
-- de centavos para que la suma de las partes cierre exacto); los gastos
-- pendientes de una propiedad se descuentan completos de quien figure
-- como contacto principal (o mayor porcentaje); la liquidación garantizada
-- (contrato.liquidacion_garantizada) adelanta al propietario cuotas que el
-- inquilino todavía no pagó, pasado el mismo umbral que dispara el
-- punitorio.
--
-- Simplificación deliberada frente a InmoGestion: sin movimiento de Caja
-- diaria (todavía no existe ese módulo acá — Caja, cuando se construya,
-- va a LEER de "gastos"/"liquidaciones", mismo criterio que Cobranzas).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Gastos de una propiedad
-- ---------------------------------------------------------------------

create table if not exists public.gastos (
  id bigint generated always as identity primary key,
  propiedad_id bigint not null references public.propiedades(id),
  fecha date not null,
  concepto text not null,
  monto bigint not null,
  comprobante text,
  liquidado boolean not null default false,
  liquidacion_id bigint,
  anulado boolean not null default false,
  creado_en timestamptz not null default now()
);

create index if not exists idx_gastos_propiedad on public.gastos (propiedad_id);
create index if not exists idx_gastos_liquidado on public.gastos (liquidado);

alter table public.gastos enable row level security;
create policy "Authenticated all gastos" on public.gastos for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Liquidaciones a propietarios
-- ---------------------------------------------------------------------

create table if not exists public.liquidaciones (
  id bigint generated always as identity primary key,
  persona_id bigint not null references public.personas(id),
  periodo text not null,
  fecha_emision date not null default current_date,
  total_cobrado bigint not null default 0,
  total_comision bigint not null default 0,
  total_gastos bigint not null default 0,
  total_neto bigint not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  fecha_pago date,
  medio_pago text,
  recibo_id bigint references public.recibos(id),
  observaciones text,
  creado_en timestamptz not null default now()
);

create index if not exists idx_liquidaciones_persona on public.liquidaciones (persona_id);
create index if not exists idx_liquidaciones_periodo on public.liquidaciones (periodo);

alter table public.gastos add constraint gastos_liquidacion_id_fkey
  foreign key (liquidacion_id) references public.liquidaciones(id);

create table if not exists public.liquidacion_detalle (
  id bigint generated always as identity primary key,
  liquidacion_id bigint not null references public.liquidaciones(id) on delete cascade,
  propiedad_id bigint references public.propiedades(id),
  cuota_id bigint references public.cuotas(id),
  concepto text not null,
  tipo text not null default 'cobro' check (tipo in ('cobro', 'comision', 'gasto')),
  monto bigint not null,
  porcentaje_prop numeric default 100
);

create index if not exists idx_liq_detalle_liquidacion on public.liquidacion_detalle (liquidacion_id);

alter table public.liquidaciones enable row level security;
alter table public.liquidacion_detalle enable row level security;
create policy "Authenticated all liquidaciones" on public.liquidaciones for all to authenticated using (true) with check (true);
create policy "Authenticated all liquidacion_detalle" on public.liquidacion_detalle for all to authenticated using (true) with check (true);

-- El pago a un propietario también puede repartirse en varios medios —
-- medio_pago_detalle ya existe (migración 006), le falta la pata de
-- liquidacion_id (dejada afuera a propósito en esa migración, con nota de
-- que se sumaba acá).
alter table public.medio_pago_detalle add column if not exists liquidacion_id bigint references public.liquidaciones(id) on delete cascade;
alter table public.medio_pago_detalle alter column pago_id drop not null;
alter table public.medio_pago_detalle add constraint medio_pago_detalle_uno_solo
  check ((pago_id is not null)::int + (liquidacion_id is not null)::int = 1);
create index if not exists idx_mpd_liquidacion on public.medio_pago_detalle (liquidacion_id);

-- Comisión de administración por defecto de la instalación (mismo orden de
-- prioridad que en InmoGestion: contrato → propiedad → config).
insert into public.config (clave, valor, descripcion) values
  ('comision_admin_pct', '10', 'Comisión de administración por defecto (%)')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Helpers de cálculo (reglas-negocio-liquidacion.md, secciones 5 y 6)
-- ---------------------------------------------------------------------

-- Un gasto no se puede partir entre copropietarios: se descuenta completo
-- de quien figure como contacto principal, o de quien tenga mayor
-- porcentaje si nadie está marcado así.
create or replace function public.responsable_gastos_propiedad(p_propiedad_id bigint)
returns bigint
language sql
stable
as $$
  select persona_id from public.propiedad_propietario
  where propiedad_id = p_propiedad_id
  order by es_contacto_principal desc, porcentaje desc
  limit 1;
$$;

-- La parte bruta de CADA copropietario, calculada de forma independiente
-- — pero el responsable de gastos se lleva el remanente (monto_base menos
-- lo ya redondeado para los demás) en vez de su porcentaje literal, para
-- que la suma de las partes de todos cierre siempre exacto contra el
-- monto real cobrado, sin importar en qué orden se liquide a cada uno.
create or replace function public.bruto_propietario(p_propiedad_id bigint, p_persona_id bigint, p_monto_base bigint)
returns bigint
language plpgsql
stable
as $$
declare
  v_responsable bigint;
  v_otros bigint;
  v_propio numeric;
begin
  v_responsable := public.responsable_gastos_propiedad(p_propiedad_id);
  if p_persona_id = v_responsable then
    select coalesce(sum(round(p_monto_base * pp.porcentaje / 100)), 0) into v_otros
      from public.propiedad_propietario pp
      where pp.propiedad_id = p_propiedad_id and pp.persona_id <> p_persona_id;
    return p_monto_base - v_otros;
  end if;

  select porcentaje into v_propio from public.propiedad_propietario
    where propiedad_id = p_propiedad_id and persona_id = p_persona_id;
  return round(p_monto_base * v_propio / 100);
end;
$$;

-- comision_admin_pct sale de, en este orden: contrato → propiedad → config.
create or replace function public.comision_pct_para(p_comision_contrato numeric, p_comision_propiedad numeric)
returns numeric
language sql
stable
as $$
  select coalesce(p_comision_contrato, p_comision_propiedad, public.config_numero('comision_admin_pct', 0));
$$;

-- ---------------------------------------------------------------------
-- Anular un gasto (nunca DELETE) — bloqueado si ya se descontó en una
-- liquidación (esa liquidación se tiene que anular primero).
-- ---------------------------------------------------------------------

create or replace function public.anular_gasto(p_gasto_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gasto record;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  select * into v_gasto from public.gastos where id = p_gasto_id;
  if not found then raise exception 'No existe ese gasto.'; end if;
  if v_gasto.anulado then raise exception 'Ese gasto ya está anulado.'; end if;
  if v_gasto.liquidado then
    raise exception 'Este gasto ya se descontó en una liquidación al propietario. Anulá esa liquidación primero si hace falta corregirlo.';
  end if;
  update public.gastos set anulado = true where id = p_gasto_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Generar una liquidación: cobros reales del período (por fecha_pago, no
-- por período de la cuota), cuotas garantizadas, y gastos pendientes a
-- cargo de esta persona. Se puede correr más de una vez para el mismo
-- (persona, período): cada corrida solo toma lo que todavía no se
-- liquidó, vía el filtro anti-doble-conteo por (cuota, persona).
-- ---------------------------------------------------------------------

create or replace function public.generar_liquidacion(p_persona_id bigint, p_periodo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_persona record;
  v_desde date;
  v_hasta date;
  v_gracia_default int;
  v_liquidacion_id bigint;
  v_total_cobrado bigint;
  v_total_comision bigint;
  v_total_gastos bigint;
  v_total_neto bigint;
  v_filas int;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Cargá el período con formato AAAA-MM.';
  end if;

  select * into v_persona from public.personas where id = p_persona_id;
  if not found then raise exception 'No existe esa persona.'; end if;
  if not exists (select 1 from public.propiedad_propietario where persona_id = p_persona_id) then
    raise exception '% no figura como propietaria de ningún inmueble.', v_persona.nombre;
  end if;

  v_desde := (p_periodo || '-01')::date;
  v_hasta := v_desde + interval '1 month';
  v_gracia_default := public.config_numero('dias_gracia_mora', 0)::int;

  insert into public.liquidaciones (persona_id, periodo, fecha_emision)
  values (p_persona_id, p_periodo, current_date)
  returning id into v_liquidacion_id;

  -- Cobros reales: cuotas de propiedades de esta persona, cobradas dentro
  -- del período, todavía no liquidadas a ESTA persona.
  insert into public.liquidacion_detalle (liquidacion_id, propiedad_id, cuota_id, concepto, tipo, monto, porcentaje_prop)
  select
    v_liquidacion_id, ct.propiedad_id, cu.id, 'Alquiler cobrado', 'cobro',
    public.bruto_propietario(ct.propiedad_id, p_persona_id, cu.monto_alquiler),
    pp.porcentaje
  from public.cuotas cu
  join public.contratos ct on ct.id = cu.contrato_id
  join public.propiedad_propietario pp on pp.propiedad_id = ct.propiedad_id and pp.persona_id = p_persona_id
  join public.pago_imputacion pi on pi.cuota_id = cu.id and pi.concepto = 'alquiler'
  join public.pagos p on p.id = pi.pago_id and p.anulado = false
  where ct.moneda = 'ARS'
    and p.fecha_pago >= v_desde and p.fecha_pago < v_hasta
    and not exists (
      select 1 from public.liquidacion_detalle ld
      join public.liquidaciones l on l.id = ld.liquidacion_id
      where ld.cuota_id = cu.id and ld.tipo = 'cobro' and l.estado <> 'anulada' and l.persona_id = p_persona_id
    );

  -- Cuotas garantizadas: contratos con liquidacion_garantizada, impagas
  -- más allá de los días de gracia — se le pagan igual al propietario, la
  -- cuota del inquilino no se toca.
  insert into public.liquidacion_detalle (liquidacion_id, propiedad_id, cuota_id, concepto, tipo, monto, porcentaje_prop)
  select
    v_liquidacion_id, ct.propiedad_id, cu.id, 'Alquiler garantizado (todavía no cobrado al inquilino)', 'cobro',
    public.bruto_propietario(ct.propiedad_id, p_persona_id, cu.monto_alquiler),
    pp.porcentaje
  from public.cuotas cu
  join public.contratos ct on ct.id = cu.contrato_id
  join public.propiedad_propietario pp on pp.propiedad_id = ct.propiedad_id and pp.persona_id = p_persona_id
  where ct.moneda = 'ARS'
    and ct.liquidacion_garantizada = true
    and cu.estado not in ('pagada', 'anulada')
    and (current_date - cu.fecha_vencimiento) > coalesce(ct.dias_gracia_mora, v_gracia_default)
    and not exists (
      select 1 from public.liquidacion_detalle ld
      join public.liquidaciones l on l.id = ld.liquidacion_id
      where ld.cuota_id = cu.id and ld.tipo = 'cobro' and l.estado <> 'anulada' and l.persona_id = p_persona_id
    );

  -- Comisión sobre cada cobro recién insertado (real o garantizado).
  insert into public.liquidacion_detalle (liquidacion_id, propiedad_id, cuota_id, concepto, tipo, monto, porcentaje_prop)
  select ld.liquidacion_id, ld.propiedad_id, ld.cuota_id, 'Comisión de administración', 'comision',
         round(ld.monto * public.comision_pct_para(ct.comision_admin_pct, pr.comision_admin_pct) / 100),
         ld.porcentaje_prop
  from public.liquidacion_detalle ld
  join public.cuotas cu on cu.id = ld.cuota_id
  join public.contratos ct on ct.id = cu.contrato_id
  join public.propiedades pr on pr.id = ct.propiedad_id
  where ld.liquidacion_id = v_liquidacion_id and ld.tipo = 'cobro'
    and round(ld.monto * public.comision_pct_para(ct.comision_admin_pct, pr.comision_admin_pct) / 100) > 0;

  -- Gastos pendientes a cargo de esta persona (responsable de la propiedad).
  insert into public.liquidacion_detalle (liquidacion_id, propiedad_id, cuota_id, concepto, tipo, monto, porcentaje_prop)
  select v_liquidacion_id, g.propiedad_id, null, g.concepto, 'gasto', g.monto, 100
  from public.gastos g
  where g.liquidado = false and g.anulado = false
    and exists (select 1 from public.propiedad_propietario pp where pp.propiedad_id = g.propiedad_id and pp.persona_id = p_persona_id)
    and public.responsable_gastos_propiedad(g.propiedad_id) = p_persona_id;

  update public.gastos g
  set liquidado = true, liquidacion_id = v_liquidacion_id
  where g.liquidado = false and g.anulado = false
    and exists (select 1 from public.propiedad_propietario pp where pp.propiedad_id = g.propiedad_id and pp.persona_id = p_persona_id)
    and public.responsable_gastos_propiedad(g.propiedad_id) = p_persona_id;

  select count(*) into v_filas from public.liquidacion_detalle where liquidacion_id = v_liquidacion_id;
  if v_filas = 0 then
    delete from public.liquidaciones where id = v_liquidacion_id;
    return jsonb_build_object('generada', false, 'motivo', 'No hay cobros ni gastos pendientes de liquidar para esta persona en este período.');
  end if;

  select coalesce(sum(monto), 0) into v_total_cobrado from public.liquidacion_detalle where liquidacion_id = v_liquidacion_id and tipo = 'cobro';
  select coalesce(sum(monto), 0) into v_total_comision from public.liquidacion_detalle where liquidacion_id = v_liquidacion_id and tipo = 'comision';
  select coalesce(sum(monto), 0) into v_total_gastos from public.liquidacion_detalle where liquidacion_id = v_liquidacion_id and tipo = 'gasto';
  v_total_neto := v_total_cobrado - v_total_comision - v_total_gastos;

  update public.liquidaciones
  set total_cobrado = v_total_cobrado, total_comision = v_total_comision, total_gastos = v_total_gastos, total_neto = v_total_neto
  where id = v_liquidacion_id;

  return jsonb_build_object(
    'generada', true, 'liquidacion_id', v_liquidacion_id,
    'total_cobrado', v_total_cobrado, 'total_comision', v_total_comision,
    'total_gastos', v_total_gastos, 'total_neto', v_total_neto
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Pagar una liquidación: uno o varios medios de pago, genera recibo tipo
-- "propietario" — mismo patrón que registrar_cobro de Cobranzas.
-- ---------------------------------------------------------------------

create or replace function public.pagar_liquidacion(p_liquidacion_id bigint, p_fecha_pago date, p_medios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liq record;
  v_persona record;
  v_num_medios int;
  v_j int;
  v_medio jsonb;
  v_monto_medio bigint;
  v_suma bigint := 0;
  v_principal_idx int := 0;
  v_principal_monto bigint := -1;
  v_numero int;
  v_recibo_id bigint;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into v_liq from public.liquidaciones where id = p_liquidacion_id;
  if not found then raise exception 'No existe esa liquidación.'; end if;
  if v_liq.estado <> 'pendiente' then
    raise exception 'Esta liquidación está "%", no se puede marcar como pagada.', v_liq.estado;
  end if;
  if p_fecha_pago is null then raise exception 'Cargá la fecha de pago.'; end if;

  v_num_medios := jsonb_array_length(coalesce(p_medios, '[]'::jsonb));
  if v_num_medios = 0 then raise exception 'Elegí el medio de pago.'; end if;

  for v_j in 0..v_num_medios - 1 loop
    v_medio := p_medios->v_j;
    if v_medio->>'medio_pago' not in ('efectivo','transferencia','cheque','deposito','mercadopago','tarjeta','digital','otro') then
      raise exception 'Elegí un medio de pago válido.';
    end if;
    v_monto_medio := coalesce((v_medio->>'monto')::bigint, 0);
    if v_monto_medio <= 0 then
      raise exception 'Cargá el monto de cada medio de pago.';
    end if;
    v_suma := v_suma + v_monto_medio;
    if v_monto_medio > v_principal_monto then
      v_principal_monto := v_monto_medio;
      v_principal_idx := v_j;
    end if;
  end loop;

  if v_suma <> v_liq.total_neto then
    raise exception 'La suma de los medios de pago no coincide con el neto a pagar.';
  end if;

  select * into v_persona from public.personas where id = v_liq.persona_id;

  v_numero := public.config_numero('proximo_recibo', 1)::int;
  update public.config set valor = (v_numero + 1)::text where clave = 'proximo_recibo';

  insert into public.recibos (numero, tipo, fecha_emision, persona_id, total, concepto)
  values (v_numero, 'propietario', p_fecha_pago, v_liq.persona_id, v_liq.total_neto, 'Liquidación ' || v_liq.periodo || ' — ' || v_persona.nombre)
  returning id into v_recibo_id;

  update public.liquidaciones
  set estado = 'pagada', fecha_pago = p_fecha_pago, medio_pago = (p_medios->v_principal_idx)->>'medio_pago', recibo_id = v_recibo_id
  where id = p_liquidacion_id;

  for v_j in 0..v_num_medios - 1 loop
    v_medio := p_medios->v_j;
    insert into public.medio_pago_detalle (liquidacion_id, medio_pago, monto, referencia)
    values (p_liquidacion_id, v_medio->>'medio_pago', (v_medio->>'monto')::bigint, v_medio->>'referencia');
  end loop;

  return jsonb_build_object('recibo_id', v_recibo_id, 'recibo_numero', v_numero);
end;
$$;

-- ---------------------------------------------------------------------
-- Anular una liquidación: los gastos que se había llevado vuelven a estar
-- disponibles para la próxima corrida. Las cuotas del inquilino no se
-- tocan — lo que se anula es el pago al propietario.
-- ---------------------------------------------------------------------

create or replace function public.anular_liquidacion(p_liquidacion_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liq record;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  select * into v_liq from public.liquidaciones where id = p_liquidacion_id;
  if not found then raise exception 'No existe esa liquidación.'; end if;
  if v_liq.estado = 'anulada' then raise exception 'Esta liquidación ya está anulada.'; end if;
  if p_motivo is null or trim(p_motivo) = '' then raise exception 'Contá el motivo de la anulación.'; end if;

  update public.liquidaciones set estado = 'anulada', observaciones = coalesce(observaciones || ' / ', '') || 'Anulada: ' || p_motivo where id = p_liquidacion_id;
  update public.gastos set liquidado = false, liquidacion_id = null where liquidacion_id = p_liquidacion_id;
end;
$$;
