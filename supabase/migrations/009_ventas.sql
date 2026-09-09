-- =====================================================================
-- PATRICIA DAADIN — Fase 6 del panel CRM: Ventas
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- 001-008 (schema, inmuebles/personas, contratos, Cobranzas, Liquidación,
-- Caja diaria).
--
-- Puerto de src/routes/ventas.js de InmoGestion: sin la trazabilidad fina
-- de Alquileres (no hay cuotas ni un ciclo de vida con reglas propias
-- documentadas) — el estado se edita libremente entre reserva → boleto →
-- escriturada / caida, sin un grafo de transiciones válidas como el de
-- los cheques en Cobranzas. Lo único que genera un movimiento de Caja es
-- cobrar la comisión.
--
-- Simplificación deliberada: sin el comprobante de reserva en PDF (mismo
-- criterio que el recibo de Cobranzas — se puede agregar después como
-- vista imprimible si hace falta).
-- =====================================================================

create table if not exists public.ventas (
  id bigint generated always as identity primary key,
  propiedad_id bigint not null references public.propiedades(id),
  comprador_id bigint references public.personas(id),
  fecha_reserva date,
  monto_reserva bigint,
  fecha_boleto date,
  fecha_escritura date,
  monto_operacion bigint not null,
  moneda text not null default 'USD' check (moneda in ('ARS', 'USD')),
  comision_pct numeric,
  comision_monto bigint,
  comision_cobrada boolean not null default false,
  estado text not null default 'reserva' check (estado in ('reserva', 'boleto', 'escriturada', 'caida')),
  notas text,
  creado_en timestamptz not null default now()
);

create index if not exists idx_ventas_propiedad on public.ventas (propiedad_id);
create index if not exists idx_ventas_estado on public.ventas (estado);

alter table public.ventas enable row level security;
create policy "Authenticated all ventas" on public.ventas for all to authenticated using (true) with check (true);

-- Caja diaria (migración 008) ya deja "comision_venta" en el catálogo de
-- categorías, a la espera de esta fase — falta la columna que la liga a
-- la operación.
alter table public.movimiento_caja add column if not exists operacion_id bigint references public.ventas(id);
create index if not exists idx_caja_operacion on public.movimiento_caja (operacion_id);

-- ---------------------------------------------------------------------
-- El estado del inmueble sigue a la operación de venta, mismo criterio
-- que un contrato de alquiler vigente (migración 003, crear_contrato):
-- si el inmueble ya tiene un contrato de alquiler vigente encima (caso
-- "ambas" — a la venta y alquilado a la vez), esa es la situación más
-- urgente y la venta no le pisa el estado.
-- ---------------------------------------------------------------------

create or replace function public.sincronizar_estado_propiedad_venta(p_propiedad_id bigint, p_estado_venta text)
returns void
language plpgsql
as $$
begin
  if p_estado_venta = 'escriturada' then
    update public.propiedades set estado = 'vendida', actualizado_en = now() where id = p_propiedad_id;
    return;
  end if;

  if exists (select 1 from public.contratos where propiedad_id = p_propiedad_id and estado = 'vigente') then
    return;
  end if;

  update public.propiedades
  set estado = case when p_estado_venta = 'caida' then 'disponible' else 'reservada' end, actualizado_en = now()
  where id = p_propiedad_id;
end;
$$;

create or replace function public.crear_venta(p_datos jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_propiedad record;
  v_venta_id bigint;
  v_monto_operacion bigint;
  v_comision_pct numeric;
  v_comision_monto bigint;
  v_estado text;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into v_propiedad from public.propiedades where id = (p_datos->>'propiedad_id')::bigint and activo = true;
  if not found then raise exception 'No existe ese inmueble.'; end if;

  v_monto_operacion := (p_datos->>'monto_operacion')::bigint;
  if v_monto_operacion is null or v_monto_operacion <= 0 then
    raise exception 'Cargá el monto de la operación.';
  end if;

  v_comision_pct := (p_datos->>'comision_pct')::numeric;
  if v_comision_pct is not null and (v_comision_pct < 0 or v_comision_pct > 100) then
    raise exception 'Cargá un porcentaje de comisión entre 0 y 100.';
  end if;

  v_comision_monto := (p_datos->>'comision_monto')::bigint;
  if v_comision_monto is null and v_comision_pct is not null then
    v_comision_monto := round(v_monto_operacion * v_comision_pct / 100);
  end if;

  v_estado := coalesce(p_datos->>'estado', 'reserva');

  insert into public.ventas (
    propiedad_id, comprador_id, fecha_reserva, monto_reserva, fecha_boleto, fecha_escritura,
    monto_operacion, moneda, comision_pct, comision_monto, estado, notas
  ) values (
    v_propiedad.id, (p_datos->>'comprador_id')::bigint,
    (p_datos->>'fecha_reserva')::date, (p_datos->>'monto_reserva')::bigint,
    (p_datos->>'fecha_boleto')::date, (p_datos->>'fecha_escritura')::date,
    v_monto_operacion, coalesce(p_datos->>'moneda', 'USD'),
    v_comision_pct, v_comision_monto, v_estado, p_datos->>'notas'
  ) returning id into v_venta_id;

  perform public.sincronizar_estado_propiedad_venta(v_propiedad.id, v_estado);

  return v_venta_id;
end;
$$;

create or replace function public.actualizar_venta(p_venta_id bigint, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual record;
  v_monto_operacion bigint;
  v_comision_pct numeric;
  v_comision_monto bigint;
  v_estado text;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into v_actual from public.ventas where id = p_venta_id;
  if not found then raise exception 'No existe esa operación.'; end if;
  if v_actual.comision_cobrada then
    raise exception 'La comisión de esta operación ya está cobrada, no se puede editar. Corregilo desde Caja si hace falta.';
  end if;

  v_monto_operacion := (p_datos->>'monto_operacion')::bigint;
  if v_monto_operacion is null or v_monto_operacion <= 0 then
    raise exception 'Cargá el monto de la operación.';
  end if;

  v_comision_pct := (p_datos->>'comision_pct')::numeric;
  if v_comision_pct is not null and (v_comision_pct < 0 or v_comision_pct > 100) then
    raise exception 'Cargá un porcentaje de comisión entre 0 y 100.';
  end if;

  v_comision_monto := (p_datos->>'comision_monto')::bigint;
  if v_comision_monto is null and v_comision_pct is not null then
    v_comision_monto := round(v_monto_operacion * v_comision_pct / 100);
  end if;

  v_estado := coalesce(p_datos->>'estado', v_actual.estado);

  update public.ventas set
    propiedad_id = coalesce((p_datos->>'propiedad_id')::bigint, propiedad_id),
    comprador_id = (p_datos->>'comprador_id')::bigint,
    fecha_reserva = (p_datos->>'fecha_reserva')::date,
    monto_reserva = (p_datos->>'monto_reserva')::bigint,
    fecha_boleto = (p_datos->>'fecha_boleto')::date,
    fecha_escritura = (p_datos->>'fecha_escritura')::date,
    monto_operacion = v_monto_operacion,
    moneda = coalesce(p_datos->>'moneda', moneda),
    comision_pct = v_comision_pct,
    comision_monto = v_comision_monto,
    estado = v_estado,
    notas = p_datos->>'notas'
  where id = p_venta_id;

  perform public.sincronizar_estado_propiedad_venta(coalesce((p_datos->>'propiedad_id')::bigint, v_actual.propiedad_id), v_estado);
end;
$$;

-- ---------------------------------------------------------------------
-- anular_movimiento_caja (migración 008) todavía no conocía operacion_id
-- — se redefine acá para que también bloquee anular desde Caja un
-- movimiento que viene de cobrar una comisión de venta.
-- ---------------------------------------------------------------------

create or replace function public.anular_movimiento_caja(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov record;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into v_mov from public.movimiento_caja where id = p_id;
  if not found then raise exception 'No existe ese movimiento.'; end if;
  if v_mov.anulado then raise exception 'Ese movimiento ya está anulado.'; end if;
  if v_mov.pago_id is not null or v_mov.liquidacion_id is not null or v_mov.gasto_id is not null or v_mov.operacion_id is not null then
    raise exception 'Este movimiento viene de un cobro, una liquidación, un gasto o una venta: anulalo desde ese módulo, no desde Caja.';
  end if;

  update public.movimiento_caja set anulado = true where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Cobrar la comisión: deja el movimiento de ingreso en Caja diaria.
-- ---------------------------------------------------------------------

create or replace function public.cobrar_comision_venta(p_venta_id bigint, p_fecha date, p_medio_pago text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta record;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into v_venta from public.ventas where id = p_venta_id;
  if not found then raise exception 'No existe esa operación.'; end if;
  if v_venta.comision_cobrada then raise exception 'La comisión de esta operación ya está cobrada.'; end if;
  if v_venta.comision_monto is null or v_venta.comision_monto <= 0 then
    raise exception 'Cargá el monto de la comisión antes de cobrarla.';
  end if;
  if p_fecha is null then raise exception 'Cargá la fecha de cobro.'; end if;
  if p_medio_pago not in ('efectivo','transferencia','cheque','deposito','mercadopago','tarjeta','digital','otro') then
    raise exception 'Elegí el medio de pago.';
  end if;

  update public.ventas set comision_cobrada = true where id = p_venta_id;

  insert into public.movimiento_caja (fecha, tipo, categoria, concepto, monto, moneda, medio_pago, operacion_id, propiedad_id, persona_id)
  values (
    p_fecha, 'ingreso', 'comision_venta',
    'Comisión de venta, inmueble ' || v_venta.propiedad_id,
    v_venta.comision_monto, v_venta.moneda, p_medio_pago,
    v_venta.id, v_venta.propiedad_id, v_venta.comprador_id
  );
end;
$$;
