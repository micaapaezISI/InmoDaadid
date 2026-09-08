-- =====================================================================
-- PATRICIA DAADIN — Fase 3 del panel CRM: Cobranzas
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- 001-005 (schema.sql, inmuebles_personas, contratos y sus arreglos).
--
-- Puerto de reglas-negocio-cobranzas.md de InmoGestion (mora por
-- contrato/instalación, medios de pago múltiples por cobro, circuito de
-- cheque, bonificaciones puntuales, excepciones de cobro por acuerdos
-- informales, recibos) — ver ese archivo y src/routes/cobranzas.js para
-- el detalle de cada regla. Simplificaciones deliberadas frente a
-- InmoGestion (documentadas, no un olvido):
--   - Sin usuario_id en ninguna tabla: un solo admin, no hace falta
--     rastrear "quién" hizo cada cosa (mismo criterio ya usado en
--     Personas/Inmuebles/Contratos).
--   - Sin PDF de recibo, sin adjuntar comprobante al cobro, sin
--     movimiento de Caja diaria (todavía no existe ese módulo — Caja,
--     cuando se construya, va a LEER de "pagos", no duplicar el
--     registro), sin múltiples series de recibo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ajustes a tablas existentes
-- ---------------------------------------------------------------------

alter table public.contratos add column if not exists punitorio_diario_pct numeric;
alter table public.contratos add column if not exists dias_gracia_mora int;

alter table public.cuotas add column if not exists bonificacion bigint not null default 0;
alter table public.cuotas add column if not exists motivo_bonificacion text;

-- ---------------------------------------------------------------------
-- Configuración de la instalación (mora default, próximo número de recibo)
-- ---------------------------------------------------------------------

create table if not exists public.config (
  clave text primary key,
  valor text,
  descripcion text
);

insert into public.config (clave, valor, descripcion) values
  ('punitorio_diario_pct', '0.1', 'Interés punitorio diario por mora (%)'),
  ('dias_gracia_mora', '5', 'Días de gracia antes de aplicar punitorios'),
  ('proximo_recibo', '1', 'Próximo número de recibo a emitir')
on conflict (clave) do nothing;

alter table public.config enable row level security;
create policy "Authenticated all config" on public.config for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Excepciones de cobro por acuerdos informales (sección 7 de las reglas)
-- Viven aparte del contrato: nunca tocan contratos ni contrato_ajustes.
-- ---------------------------------------------------------------------

create table if not exists public.contrato_excepcion_cobro (
  id bigint generated always as identity primary key,
  contrato_id bigint not null references public.contratos(id) on delete cascade,
  tipo text not null default 'pausar_ajuste' check (tipo in ('pausar_ajuste')),
  fecha_desde date not null,
  fecha_hasta date not null,
  monto_congelado bigint not null,
  motivo text not null,
  anulada boolean not null default false,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  check (fecha_hasta > fecha_desde)
);

create index if not exists idx_excepcion_contrato on public.contrato_excepcion_cobro (contrato_id);

alter table public.contrato_excepcion_cobro enable row level security;
create policy "Authenticated all contrato_excepcion_cobro" on public.contrato_excepcion_cobro
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Recibos, pagos y su detalle
-- ---------------------------------------------------------------------

create table if not exists public.recibos (
  id bigint generated always as identity primary key,
  numero int not null unique,
  tipo text not null default 'inquilino' check (tipo in ('inquilino', 'propietario', 'vario')),
  fecha_emision date not null,
  persona_id bigint not null references public.personas(id),
  total bigint not null,
  concepto text,
  detalle jsonb,
  creado_en timestamptz not null default now()
);

create table if not exists public.pagos (
  id bigint generated always as identity primary key,
  persona_id bigint not null references public.personas(id),
  contrato_id bigint references public.contratos(id),
  fecha_pago date not null,
  monto bigint not null,
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  medio_pago text not null check (medio_pago in ('efectivo', 'transferencia', 'cheque', 'deposito', 'mercadopago', 'tarjeta', 'digital', 'otro')),
  comision_monto bigint not null default 0,
  referencia text,
  recibo_id bigint references public.recibos(id),
  observaciones text,
  anulado boolean not null default false,
  motivo_anulacion text,
  creado_en timestamptz not null default now()
);

create index if not exists idx_pagos_fecha on public.pagos (fecha_pago);
create index if not exists idx_pagos_persona on public.pagos (persona_id);

create table if not exists public.pago_imputacion (
  id bigint generated always as identity primary key,
  pago_id bigint not null references public.pagos(id) on delete cascade,
  cuota_id bigint not null references public.cuotas(id),
  concepto text not null default 'alquiler' check (concepto in ('alquiler', 'expensas', 'punitorio', 'otros')),
  monto bigint not null
);

create index if not exists idx_imputacion_cuota on public.pago_imputacion (cuota_id);
create index if not exists idx_imputacion_pago on public.pago_imputacion (pago_id);

create table if not exists public.pago_cheque (
  id bigint generated always as identity primary key,
  pago_id bigint not null unique references public.pagos(id) on delete cascade,
  banco text,
  numero text,
  fecha_cheque date,
  estado text not null default 'en_cartera' check (estado in ('en_cartera', 'depositado', 'acreditado', 'rechazado')),
  fecha_deposito date,
  fecha_acreditacion date,
  motivo_rechazo text,
  creado_en timestamptz not null default now()
);

create table if not exists public.medio_pago_detalle (
  id bigint generated always as identity primary key,
  pago_id bigint not null references public.pagos(id) on delete cascade,
  medio_pago text not null check (medio_pago in ('efectivo', 'transferencia', 'cheque', 'deposito', 'mercadopago', 'tarjeta', 'digital', 'otro')),
  monto bigint not null,
  referencia text,
  comision_monto bigint not null default 0
);

create index if not exists idx_mpd_pago on public.medio_pago_detalle (pago_id);

alter table public.recibos enable row level security;
alter table public.pagos enable row level security;
alter table public.pago_imputacion enable row level security;
alter table public.pago_cheque enable row level security;
alter table public.medio_pago_detalle enable row level security;

create policy "Authenticated all recibos" on public.recibos for all to authenticated using (true) with check (true);
create policy "Authenticated all pagos" on public.pagos for all to authenticated using (true) with check (true);
create policy "Authenticated all pago_imputacion" on public.pago_imputacion for all to authenticated using (true) with check (true);
create policy "Authenticated all pago_cheque" on public.pago_cheque for all to authenticated using (true) with check (true);
create policy "Authenticated all medio_pago_detalle" on public.medio_pago_detalle for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Helpers de cálculo (puros, sin tocar la base) — compartidos entre
-- cuotas_pendientes_cobro() y registrar_cobro() para que la fórmula de
-- mora/bonificación no se pueda desincronizar entre las dos.
-- ---------------------------------------------------------------------

create or replace function public.config_numero(p_clave text, p_default numeric)
returns numeric
language sql
stable
as $$
  select coalesce((select valor::numeric from public.config where clave = p_clave), p_default);
$$;

-- El punitorio se calcula siempre sobre el alquiler solo (nunca sobre
-- expensas u otros conceptos), con los días de gracia restados de los
-- días de atraso.
create or replace function public.calcular_punitorio(
  p_monto_alquiler bigint, p_fecha_vencimiento date, p_fecha_calculo date,
  p_pct numeric, p_gracia int
)
returns bigint
language plpgsql
immutable
as $$
declare
  dias_atraso int;
begin
  if p_pct is null or p_pct = 0 then return 0; end if;
  dias_atraso := (p_fecha_calculo - p_fecha_vencimiento) - coalesce(p_gracia, 0);
  if dias_atraso <= 0 then return 0; end if;
  return round(p_monto_alquiler * (p_pct / 100) * dias_atraso);
end;
$$;

-- Si la cuota ya tiene una bonificación manual, esa gana. Si no, y el
-- período cae dentro de una excepción de cobro vigente, la diferencia
-- contra el monto congelado se cobra como bonificación con el motivo de
-- la excepción — la cuota real (monto_alquiler) no se toca nunca.
create or replace function public.calcular_bonificacion(
  p_bonificacion_manual bigint, p_motivo_manual text,
  p_monto_alquiler bigint, p_excepcion_monto_congelado bigint, p_excepcion_motivo text
)
returns table (monto bigint, motivo text)
language plpgsql
immutable
as $$
declare
  v_monto bigint;
begin
  if p_bonificacion_manual > 0 then
    return query select p_bonificacion_manual, p_motivo_manual;
    return;
  end if;
  if p_excepcion_monto_congelado is not null then
    v_monto := greatest(0, least(p_monto_alquiler, p_monto_alquiler - p_excepcion_monto_congelado));
    if v_monto > 0 then
      return query select v_monto, ('Excepción de cobro: ' || p_excepcion_motivo);
      return;
    end if;
  end if;
  return query select 0::bigint, null::text;
end;
$$;

-- ---------------------------------------------------------------------
-- Cuotas pendientes de cobro, con mora y bonificación calculadas a hoy.
-- Sin "security definer": es de solo lectura, la RLS de las tablas de
-- base (todas "authenticated") ya protege el acceso.
-- ---------------------------------------------------------------------

create or replace function public.cuotas_pendientes_cobro(
  p_persona_id bigint default null,
  p_contrato_id bigint default null,
  p_q text default null
)
returns table (
  id bigint, contrato_id bigint, periodo text, fecha_vencimiento date,
  monto_alquiler bigint, monto_expensas bigint, monto_otros bigint,
  bonificacion bigint, estado text,
  inquilino_id bigint, inquilino_nombre text, telefono text,
  moneda text, propiedad_id bigint, propiedad_codigo text, direccion text,
  dias_atraso int, punitorio_hoy bigint,
  bonificacion_aplicada bigint, motivo_bonificacion_aplicada text,
  total_a_cobrar bigint
)
language plpgsql
stable
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  return query
  select
    cu.id, cu.contrato_id, cu.periodo, cu.fecha_vencimiento,
    cu.monto_alquiler, cu.monto_expensas, cu.monto_otros,
    cu.bonificacion, cu.estado,
    ct.inquilino_id, pe.nombre, pe.telefono,
    ct.moneda, ct.propiedad_id, pr.codigo,
    trim(coalesce(pr.calle, '') || ' ' || coalesce(pr.numero, '')),
    greatest(0, (current_date - cu.fecha_vencimiento))::int,
    public.calcular_punitorio(
      cu.monto_alquiler, cu.fecha_vencimiento, current_date,
      coalesce(ct.punitorio_diario_pct, public.config_numero('punitorio_diario_pct', 0)),
      coalesce(ct.dias_gracia_mora, public.config_numero('dias_gracia_mora', 0)::int)
    ),
    b.monto,
    b.motivo,
    (cu.monto_alquiler - b.monto + cu.monto_expensas + cu.monto_otros
      + public.calcular_punitorio(
          cu.monto_alquiler, cu.fecha_vencimiento, current_date,
          coalesce(ct.punitorio_diario_pct, public.config_numero('punitorio_diario_pct', 0)),
          coalesce(ct.dias_gracia_mora, public.config_numero('dias_gracia_mora', 0)::int)
        ))
  from public.cuotas cu
  join public.contratos ct on ct.id = cu.contrato_id
  join public.personas pe on pe.id = ct.inquilino_id
  join public.propiedades pr on pr.id = ct.propiedad_id
  left join public.contrato_excepcion_cobro ec on ec.contrato_id = ct.id and ec.anulada = false
    and ec.tipo = 'pausar_ajuste' and cu.fecha_vencimiento between ec.fecha_desde and ec.fecha_hasta,
  lateral (select * from public.calcular_bonificacion(cu.bonificacion, cu.motivo_bonificacion, cu.monto_alquiler, ec.monto_congelado, ec.motivo)) as b
  where cu.estado = 'pendiente'
    and (p_persona_id is null or ct.inquilino_id = p_persona_id)
    and (p_contrato_id is null or cu.contrato_id = p_contrato_id)
    and (p_q is null or p_q = '' or pe.nombre ilike '%' || p_q || '%' or pr.calle ilike '%' || p_q || '%')
  order by cu.fecha_vencimiento
  limit 500;
end;
$$;

-- ---------------------------------------------------------------------
-- Bonificación puntual sobre una cuota (sección 3): no es un pago
-- parcial — se descuenta antes de cobrar, el cobro sigue siendo el 100%
-- del monto ya bonificado.
-- ---------------------------------------------------------------------

create or replace function public.bonificar_cuota(p_cuota_id bigint, p_monto bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into c from public.cuotas where id = p_cuota_id;
  if not found then raise exception 'No existe esa cuota.'; end if;
  if c.estado <> 'pendiente' then
    raise exception 'Esa cuota ya está % y no se puede bonificar.', c.estado;
  end if;
  if p_monto > 0 and (p_motivo is null or trim(p_motivo) = '') then
    raise exception 'Contá el motivo de la bonificación.';
  end if;
  if p_monto < 0 or p_monto > c.monto_alquiler then
    raise exception 'La bonificación no puede superar el monto del alquiler de la cuota.';
  end if;

  update public.cuotas
  set bonificacion = p_monto, motivo_bonificacion = case when p_monto > 0 then p_motivo else null end
  where id = p_cuota_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Registrar un cobro: una o varias cuotas completas (pago adelantado),
-- repartidas entre uno o varios medios de pago. Todo en una transacción:
-- recibo + un pago por cuota + su imputación + cheque/medios + marca las
-- cuotas pagadas. Nunca pagos parciales.
-- ---------------------------------------------------------------------

create or replace function public.registrar_cobro(p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_persona_id bigint;
  v_fecha_pago date;
  v_observaciones text;
  v_cuota_ids bigint[];
  v_medios jsonb;
  v_num_medios int;
  v_num_cheques int;
  v_numero int;
  v_recibo_id bigint;
  v_total_recibo bigint := 0;
  v_suma_medios bigint := 0;
  v_pago_ids bigint[] := '{}';
  v_periodos text[] := '{}';

  v_cuota record;
  v_pct numeric; v_gracia int;
  v_punitorio bigint; v_bonif_monto bigint; v_bonif_motivo text;
  v_monto_alquiler_neto bigint; v_total_item bigint;

  v_j int; v_medio jsonb; v_monto_medio bigint; v_es_ultimo boolean;
  v_repartido bigint; v_porcion bigint; v_porciones bigint[];
  v_principal_idx int; v_principal_monto bigint;
  v_pago_id bigint;
  v_comision_total bigint; v_comision_porcion bigint;
  v_cheque jsonb;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  v_persona_id := (p_datos->>'persona_id')::bigint;
  if v_persona_id is null then raise exception 'Elegí quién paga.'; end if;

  v_fecha_pago := coalesce((p_datos->>'fecha_pago')::date, current_date);
  v_observaciones := p_datos->>'observaciones';

  select array_agg(distinct value::bigint) into v_cuota_ids
  from jsonb_array_elements_text(coalesce(p_datos->'cuota_ids', '[]'::jsonb)) as value;
  if v_cuota_ids is null or array_length(v_cuota_ids, 1) = 0 then
    raise exception 'Elegí al menos una cuota para cobrar.';
  end if;

  v_medios := coalesce(p_datos->'medios', '[]'::jsonb);
  v_num_medios := jsonb_array_length(v_medios);
  if v_num_medios = 0 then raise exception 'Elegí el medio de pago.'; end if;

  v_num_cheques := 0;
  for v_j in 0..v_num_medios - 1 loop
    v_medio := v_medios->v_j;
    if v_medio->>'medio_pago' not in ('efectivo','transferencia','cheque','deposito','mercadopago','tarjeta','digital','otro') then
      raise exception 'Elegí un medio de pago válido.';
    end if;
    if coalesce((v_medio->>'monto')::bigint, 0) <= 0 then
      raise exception 'Cargá el monto de cada medio de pago.';
    end if;
    if v_medio->>'medio_pago' = 'cheque' then
      v_num_cheques := v_num_cheques + 1;
      if coalesce(v_medio->'cheque'->>'numero', '') = '' then
        raise exception 'Cargá el número de cheque.';
      end if;
    end if;
  end loop;
  if v_num_cheques > 1 then
    raise exception 'Un cobro no puede repartirse entre dos cheques distintos.';
  end if;

  -- Traer las cuotas con su contrato y la excepción de cobro vigente (si
  -- la hay) para calcular punitorio y bonificación con la misma fórmula
  -- que cuotas_pendientes_cobro().
  if (select count(*) from public.cuotas where id = any(v_cuota_ids)) <> array_length(v_cuota_ids, 1) then
    raise exception 'Alguna de las cuotas no existe.';
  end if;
  if exists (select 1 from public.cuotas where id = any(v_cuota_ids) and estado <> 'pendiente') then
    raise exception 'Alguna de esas cuotas ya no está pendiente.';
  end if;

  -- Total a cobrar (recorre las cuotas primero solo para el total, sin
  -- escribir nada todavía — necesitamos el total antes de repartirlo).
  for v_cuota in
    select cu.*, ct.moneda, ct.punitorio_diario_pct, ct.dias_gracia_mora,
           ec.monto_congelado as excepcion_monto_congelado, ec.motivo as excepcion_motivo
    from public.cuotas cu
    join public.contratos ct on ct.id = cu.contrato_id
    left join public.contrato_excepcion_cobro ec on ec.contrato_id = ct.id and ec.anulada = false
      and ec.tipo = 'pausar_ajuste' and cu.fecha_vencimiento between ec.fecha_desde and ec.fecha_hasta
    where cu.id = any(v_cuota_ids)
  loop
    v_pct := coalesce(v_cuota.punitorio_diario_pct, public.config_numero('punitorio_diario_pct', 0));
    v_gracia := coalesce(v_cuota.dias_gracia_mora, public.config_numero('dias_gracia_mora', 0)::int);
    v_punitorio := public.calcular_punitorio(v_cuota.monto_alquiler, v_cuota.fecha_vencimiento, v_fecha_pago, v_pct, v_gracia);
    select monto, motivo into v_bonif_monto, v_bonif_motivo
      from public.calcular_bonificacion(v_cuota.bonificacion, v_cuota.motivo_bonificacion, v_cuota.monto_alquiler, v_cuota.excepcion_monto_congelado, v_cuota.excepcion_motivo);
    v_monto_alquiler_neto := v_cuota.monto_alquiler - v_bonif_monto;
    v_total_item := v_monto_alquiler_neto + v_cuota.monto_expensas + v_cuota.monto_otros + v_punitorio;
    v_total_recibo := v_total_recibo + v_total_item;
    v_periodos := array_append(v_periodos, v_cuota.periodo);
  end loop;

  for v_j in 0..v_num_medios - 1 loop
    v_suma_medios := v_suma_medios + ((v_medios->v_j)->>'monto')::bigint;
  end loop;
  if v_suma_medios <> v_total_recibo then
    raise exception 'La suma de los medios de pago no coincide con el total a cobrar.';
  end if;

  -- Ahora sí, todo dentro de la misma transacción de la función.
  v_numero := public.config_numero('proximo_recibo', 1)::int;
  update public.config set valor = (v_numero + 1)::text where clave = 'proximo_recibo';

  insert into public.recibos (numero, tipo, fecha_emision, persona_id, total, concepto, detalle)
  values (v_numero, 'inquilino', v_fecha_pago, v_persona_id, v_total_recibo, array_to_string(v_periodos, ', '), jsonb_build_object('cuota_ids', v_cuota_ids))
  returning id into v_recibo_id;

  for v_cuota in
    select cu.*, ct.moneda, ct.punitorio_diario_pct, ct.dias_gracia_mora,
           ec.monto_congelado as excepcion_monto_congelado, ec.motivo as excepcion_motivo
    from public.cuotas cu
    join public.contratos ct on ct.id = cu.contrato_id
    left join public.contrato_excepcion_cobro ec on ec.contrato_id = ct.id and ec.anulada = false
      and ec.tipo = 'pausar_ajuste' and cu.fecha_vencimiento between ec.fecha_desde and ec.fecha_hasta
    where cu.id = any(v_cuota_ids)
  loop
    v_pct := coalesce(v_cuota.punitorio_diario_pct, public.config_numero('punitorio_diario_pct', 0));
    v_gracia := coalesce(v_cuota.dias_gracia_mora, public.config_numero('dias_gracia_mora', 0)::int);
    v_punitorio := public.calcular_punitorio(v_cuota.monto_alquiler, v_cuota.fecha_vencimiento, v_fecha_pago, v_pct, v_gracia);
    select monto, motivo into v_bonif_monto, v_bonif_motivo
      from public.calcular_bonificacion(v_cuota.bonificacion, v_cuota.motivo_bonificacion, v_cuota.monto_alquiler, v_cuota.excepcion_monto_congelado, v_cuota.excepcion_motivo);
    v_monto_alquiler_neto := v_cuota.monto_alquiler - v_bonif_monto;
    v_total_item := v_monto_alquiler_neto + v_cuota.monto_expensas + v_cuota.monto_otros + v_punitorio;

    -- Reparte el total de esta cuota entre los medios de pago,
    -- proporcional al monto de cada medio sobre el total del recibo; el
    -- último medio absorbe el redondeo de los anteriores.
    v_repartido := 0;
    v_porciones := array_fill(0::bigint, array[v_num_medios]);
    v_principal_idx := 0;
    v_principal_monto := -1;
    for v_j in 0..v_num_medios - 1 loop
      v_medio := v_medios->v_j;
      v_monto_medio := (v_medio->>'monto')::bigint;
      v_es_ultimo := v_j = v_num_medios - 1;
      v_porcion := case when v_es_ultimo then v_total_item - v_repartido
                        else round(v_monto_medio * v_total_item::numeric / v_total_recibo)
                   end;
      v_repartido := v_repartido + v_porcion;
      v_porciones[v_j + 1] := v_porcion;
      if v_porcion > v_principal_monto then
        v_principal_monto := v_porcion;
        v_principal_idx := v_j;
      end if;
    end loop;

    insert into public.pagos (persona_id, contrato_id, fecha_pago, monto, moneda, medio_pago, referencia, recibo_id, observaciones)
    values (
      v_persona_id, v_cuota.contrato_id, v_fecha_pago, v_total_item, v_cuota.moneda,
      (v_medios->v_principal_idx)->>'medio_pago', (v_medios->v_principal_idx)->>'referencia',
      v_recibo_id, v_observaciones
    ) returning id into v_pago_id;
    v_pago_ids := array_append(v_pago_ids, v_pago_id);

    update public.cuotas
    set monto_punitorio = v_punitorio, bonificacion = v_bonif_monto, motivo_bonificacion = v_bonif_motivo, estado = 'pagada'
    where id = v_cuota.id;

    if v_monto_alquiler_neto > 0 then
      insert into public.pago_imputacion (pago_id, cuota_id, concepto, monto) values (v_pago_id, v_cuota.id, 'alquiler', v_monto_alquiler_neto);
    end if;
    if v_cuota.monto_expensas > 0 then
      insert into public.pago_imputacion (pago_id, cuota_id, concepto, monto) values (v_pago_id, v_cuota.id, 'expensas', v_cuota.monto_expensas);
    end if;
    if v_punitorio > 0 then
      insert into public.pago_imputacion (pago_id, cuota_id, concepto, monto) values (v_pago_id, v_cuota.id, 'punitorio', v_punitorio);
    end if;
    if v_cuota.monto_otros > 0 then
      insert into public.pago_imputacion (pago_id, cuota_id, concepto, monto) values (v_pago_id, v_cuota.id, 'otros', v_cuota.monto_otros);
    end if;

    v_comision_total := 0;
    for v_j in 0..v_num_medios - 1 loop
      v_porcion := v_porciones[v_j + 1];
      if v_porcion <= 0 then continue; end if;
      v_medio := v_medios->v_j;
      v_monto_medio := (v_medio->>'monto')::bigint;

      if v_medio->>'medio_pago' = 'cheque' then
        v_cheque := v_medio->'cheque';
        insert into public.pago_cheque (pago_id, banco, numero, fecha_cheque, estado)
        values (v_pago_id, v_cheque->>'banco', v_cheque->>'numero', (v_cheque->>'fecha_cheque')::date, 'en_cartera');
      end if;

      v_comision_porcion := 0;
      if coalesce((v_medio->>'comision_monto')::bigint, 0) > 0 then
        v_comision_porcion := round((v_medio->>'comision_monto')::bigint * v_porcion::numeric / v_monto_medio);
      end if;
      v_comision_total := v_comision_total + v_comision_porcion;

      insert into public.medio_pago_detalle (pago_id, medio_pago, monto, referencia, comision_monto)
      values (v_pago_id, v_medio->>'medio_pago', v_porcion, v_medio->>'referencia', v_comision_porcion);
    end loop;

    if v_comision_total > 0 then
      update public.pagos set comision_monto = v_comision_total where id = v_pago_id;
    end if;
  end loop;

  return jsonb_build_object('recibo_id', v_recibo_id, 'recibo_numero', v_numero, 'pago_ids', v_pago_ids, 'total', v_total_recibo);
end;
$$;

-- ---------------------------------------------------------------------
-- Anular un cobro (nunca se borra): la cuota vuelve al estado que le
-- corresponda según si queda algún pago vigente que la cubra.
-- ---------------------------------------------------------------------

create or replace function public.anular_cobro(p_pago_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago record;
  v_cuota_id bigint;
  v_total_cuota bigint;
  v_total_pagado bigint;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'Contá el motivo de la anulación.';
  end if;

  select * into v_pago from public.pagos where id = p_pago_id;
  if not found then raise exception 'No existe ese cobro.'; end if;
  if v_pago.anulado then raise exception 'Ese cobro ya está anulado.'; end if;

  update public.pagos set anulado = true, motivo_anulacion = p_motivo where id = p_pago_id;

  for v_cuota_id in select distinct cuota_id from public.pago_imputacion where pago_id = p_pago_id loop
    select (cu.monto_alquiler - cu.bonificacion + cu.monto_expensas + cu.monto_otros + cu.monto_punitorio)
      into v_total_cuota
      from public.cuotas cu where cu.id = v_cuota_id;

    select coalesce(sum(pi.monto), 0) into v_total_pagado
      from public.pago_imputacion pi
      join public.pagos p on p.id = pi.pago_id
      where pi.cuota_id = v_cuota_id and p.anulado = false;

    update public.cuotas
    set estado = case when v_total_pagado >= v_total_cuota then 'pagada' else 'pendiente' end
    where id = v_cuota_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Circuito del cheque: solo avanza hacia adelante.
-- ---------------------------------------------------------------------

create or replace function public.actualizar_estado_cheque(p_pago_id bigint, p_estado text, p_motivo_rechazo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cheque record;
  v_permitidas text[];
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_estado not in ('en_cartera','depositado','acreditado','rechazado') then
    raise exception 'Elegí un estado válido para el cheque.';
  end if;

  select * into v_cheque from public.pago_cheque where pago_id = p_pago_id;
  if not found then raise exception 'Ese cobro no tiene un cheque asociado.'; end if;

  v_permitidas := case v_cheque.estado
    when 'en_cartera' then array['depositado','rechazado']
    when 'depositado' then array['acreditado','rechazado']
    else array[]::text[]
  end;
  if not (p_estado = any(v_permitidas)) then
    raise exception 'Un cheque en estado "%" no puede pasar a "%".', v_cheque.estado, p_estado;
  end if;
  if p_estado = 'rechazado' and (p_motivo_rechazo is null or trim(p_motivo_rechazo) = '') then
    raise exception 'Contá el motivo del rechazo.';
  end if;

  update public.pago_cheque set
    estado = p_estado,
    fecha_deposito = case when p_estado = 'depositado' then current_date else fecha_deposito end,
    fecha_acreditacion = case when p_estado = 'acreditado' then current_date else fecha_acreditacion end,
    motivo_rechazo = case when p_estado = 'rechazado' then p_motivo_rechazo else motivo_rechazo end
  where pago_id = p_pago_id;
end;
$$;
