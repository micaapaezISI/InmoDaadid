-- =====================================================================
-- PATRICIA DAADIN — Fase 5 del panel CRM: Caja diaria
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- 001-007 (schema, inmuebles/personas, contratos, Cobranzas, Liquidación).
--
-- Puerto de src/routes/caja.js + src/caja/registrar.js de InmoGestion:
-- "Cobranzas es la fuente de verdad, Caja solo lee/agrega" (ya anotado en
-- las migraciones 006 y 007). En vez de tocar registrar_cobro,
-- pagar_liquidacion o el alta de gastos (funciones ya probadas), acá se
-- engancha con TRIGGERS sobre las tablas que esas funciones ya escriben
-- (medio_pago_detalle, gastos) — así Caja queda automáticamente
-- sincronizada sin arriesgar nada de lo ya construido.
--
-- Un movimiento con origen automático (pago_id/liquidacion_id/gasto_id)
-- nunca se anula desde Caja: se anula desde su propio módulo, y un
-- trigger espeja esa anulación acá. Los movimientos manuales (sueldos,
-- retiros, ajustes) sí se cargan y anulan directo desde Caja.
--
-- Simplificación deliberada: sin operacion_id (Ventas todavía no existe
-- en el port) — se suma esa columna cuando llegue esa fase, mismo
-- criterio que medio_pago_detalle.liquidacion_id se sumó recién acá.
-- =====================================================================

-- InmoGestion no guarda el medio de pago en la fila de "gasto" (solo lo
-- usa al momento de generar el movimiento de caja) — acá sí, es más
-- simple que pasarlo aparte y no cambia ninguna regla de negocio.
alter table public.gastos add column if not exists medio_pago text not null default 'efectivo'
  check (medio_pago in ('efectivo','transferencia','cheque','deposito','mercadopago','tarjeta','digital','otro'));

create table if not exists public.movimiento_caja (
  id bigint generated always as identity primary key,
  fecha date not null,
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  categoria text not null check (categoria in (
    'cobro_alquiler', 'cobro_expensas', 'comision_alquiler', 'comision_venta',
    'liquidacion_propietario', 'gasto_propiedad', 'gasto_operativo',
    'sueldo', 'impuesto', 'aporte', 'retiro', 'ajuste', 'otro'
  )),
  concepto text not null,
  monto bigint not null,
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  medio_pago text not null default 'efectivo',
  pago_id bigint references public.pagos(id),
  liquidacion_id bigint references public.liquidaciones(id),
  gasto_id bigint references public.gastos(id),
  persona_id bigint references public.personas(id),
  propiedad_id bigint references public.propiedades(id),
  observaciones text,
  anulado boolean not null default false,
  creado_en timestamptz not null default now()
);

create index if not exists idx_caja_fecha on public.movimiento_caja (fecha);
create index if not exists idx_caja_pago on public.movimiento_caja (pago_id);
create index if not exists idx_caja_liquidacion on public.movimiento_caja (liquidacion_id);
create index if not exists idx_caja_gasto on public.movimiento_caja (gasto_id);

alter table public.movimiento_caja enable row level security;
create policy "Authenticated all movimiento_caja" on public.movimiento_caja for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Triggers: un cobro (por cada medio de pago) o el pago de una
-- liquidación deja su movimiento solo — no hace falta tocar
-- registrar_cobro ni pagar_liquidacion, que ya insertan en
-- medio_pago_detalle.
-- ---------------------------------------------------------------------

create or replace function public.fn_movimiento_desde_pago()
returns trigger
language plpgsql
as $$
declare
  v_pago record;
  v_propiedad_id bigint;
begin
  select * into v_pago from public.pagos where id = new.pago_id;
  select propiedad_id into v_propiedad_id from public.contratos where id = v_pago.contrato_id;

  insert into public.movimiento_caja (fecha, tipo, categoria, concepto, monto, moneda, medio_pago, pago_id, persona_id, propiedad_id, observaciones)
  values (
    v_pago.fecha_pago, 'ingreso', 'cobro_alquiler', 'Cobro de alquiler',
    new.monto, v_pago.moneda, new.medio_pago, new.pago_id, v_pago.persona_id, v_propiedad_id, v_pago.observaciones
  );
  return new;
end;
$$;

create trigger trg_movimiento_desde_pago
after insert on public.medio_pago_detalle
for each row when (new.pago_id is not null)
execute function public.fn_movimiento_desde_pago();

create or replace function public.fn_movimiento_desde_liquidacion()
returns trigger
language plpgsql
as $$
declare
  v_liq record;
begin
  select * into v_liq from public.liquidaciones where id = new.liquidacion_id;
  insert into public.movimiento_caja (fecha, tipo, categoria, concepto, monto, moneda, medio_pago, liquidacion_id, persona_id)
  values (
    coalesce(v_liq.fecha_pago, current_date), 'egreso', 'liquidacion_propietario', 'Liquidación ' || v_liq.periodo,
    new.monto, 'ARS', new.medio_pago, new.liquidacion_id, v_liq.persona_id
  );
  return new;
end;
$$;

create trigger trg_movimiento_desde_liquidacion
after insert on public.medio_pago_detalle
for each row when (new.liquidacion_id is not null)
execute function public.fn_movimiento_desde_liquidacion();

create or replace function public.fn_movimiento_desde_gasto()
returns trigger
language plpgsql
as $$
begin
  insert into public.movimiento_caja (fecha, tipo, categoria, concepto, monto, moneda, medio_pago, gasto_id, propiedad_id)
  values (new.fecha, 'egreso', 'gasto_propiedad', new.concepto, new.monto, 'ARS', new.medio_pago, new.id, new.propiedad_id);
  return new;
end;
$$;

create trigger trg_movimiento_desde_gasto
after insert on public.gastos
for each row
execute function public.fn_movimiento_desde_gasto();

-- ---------------------------------------------------------------------
-- Espejo de las anulaciones: el movimiento se anula solo cuando se anula
-- el pago/liquidación/gasto que lo originó.
-- ---------------------------------------------------------------------

create or replace function public.fn_anular_movimientos_de_pago()
returns trigger
language plpgsql
as $$
begin
  update public.movimiento_caja set anulado = true where pago_id = new.id and anulado = false;
  return new;
end;
$$;

create trigger trg_anular_movimientos_de_pago
after update of anulado on public.pagos
for each row when (new.anulado = true and old.anulado = false)
execute function public.fn_anular_movimientos_de_pago();

create or replace function public.fn_anular_movimientos_de_liquidacion()
returns trigger
language plpgsql
as $$
begin
  update public.movimiento_caja set anulado = true where liquidacion_id = new.id and anulado = false;
  return new;
end;
$$;

create trigger trg_anular_movimientos_de_liquidacion
after update of estado on public.liquidaciones
for each row when (new.estado = 'anulada' and old.estado <> 'anulada')
execute function public.fn_anular_movimientos_de_liquidacion();

create or replace function public.fn_anular_movimientos_de_gasto()
returns trigger
language plpgsql
as $$
begin
  update public.movimiento_caja set anulado = true where gasto_id = new.id and anulado = false;
  return new;
end;
$$;

create trigger trg_anular_movimientos_de_gasto
after update of anulado on public.gastos
for each row when (new.anulado = true and old.anulado = false)
execute function public.fn_anular_movimientos_de_gasto();

-- ---------------------------------------------------------------------
-- Anular un movimiento MANUAL (nunca uno con origen automático — ese se
-- anula desde su propio módulo, para no desincronizar la cuota/el gasto
-- liquidado/etc.).
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
  if v_mov.pago_id is not null or v_mov.liquidacion_id is not null or v_mov.gasto_id is not null then
    raise exception 'Este movimiento viene de un cobro, una liquidación o un gasto: anulalo desde ese módulo, no desde Caja.';
  end if;

  update public.movimiento_caja set anulado = true where id = p_id;
end;
$$;
