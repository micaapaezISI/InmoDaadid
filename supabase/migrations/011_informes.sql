-- =====================================================================
-- PATRICIA DAADIN — Fase 8 del panel CRM: Informes
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- 001-010 (schema, inmuebles/personas, contratos, Cobranzas, Liquidación,
-- Caja diaria, Ventas, Agenda).
--
-- Puerto de reglas-negocio-informes.md / src/informes/consultas.js de
-- InmoGestion (14 informes). Todas estas funciones son de SOLO LECTURA
-- (`stable`, sin `security definer`): no escriben nada, así que alcanza
-- con que la RLS de las tablas de base (todas "authenticated") proteja el
-- acceso, igual criterio que cuotas_pendientes_cobro (migración 006).
--
-- Simplificaciones deliberadas frente a InmoGestion:
--   - Sin exportación a PDF/Excel: se muestran en pantalla, con
--     impresión del navegador si hace falta (mismo criterio que el
--     recibo de Cobranzas). Sin librerías nuevas.
--   - 3.10 (listado de inmuebles) y 3.13 (listado de liquidaciones) NO
--     se duplican acá: ya son su propia pantalla completa en Inmuebles y
--     Liquidaciones respectivamente.
--   - 3.1, 3.8, 3.9 y 3.11 no necesitan función propia: son lecturas
--     directas de una tabla sin cálculo, se arman en el cliente
--     (js/admin-informes.js), igual criterio que el resto de los
--     listados simples del panel.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('dias_aviso_vencimiento_contrato', '60', 'Días de anticipación para avisar que un contrato está por vencer')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- 3.2 — Inquilinos morosos, agrupado por persona (no una fila por cuota).
-- ---------------------------------------------------------------------

create or replace function public.informe_morosos(p_dias_min int default 0)
returns table (persona_id bigint, nombre text, telefono text, cantidad_cuotas bigint, desde date, saldo_total bigint)
language plpgsql
stable
as $$
begin
  return query
  select ct.inquilino_id, pe.nombre, pe.telefono,
    count(*)::bigint as cantidad_cuotas,
    min(cu.fecha_vencimiento) as desde,
    sum(
      cu.monto_alquiler + cu.monto_expensas + cu.monto_otros - cu.bonificacion
      + public.calcular_punitorio(cu.monto_alquiler, cu.fecha_vencimiento, current_date,
          coalesce(ct.punitorio_diario_pct, public.config_numero('punitorio_diario_pct', 0)),
          coalesce(ct.dias_gracia_mora, public.config_numero('dias_gracia_mora', 0)::int))
    ) as saldo_total
  from public.cuotas cu
  join public.contratos ct on ct.id = cu.contrato_id
  join public.personas pe on pe.id = ct.inquilino_id
  where cu.estado = 'pendiente'
    and cu.fecha_vencimiento < current_date
    and (current_date - cu.fecha_vencimiento) >= p_dias_min
  group by ct.inquilino_id, pe.nombre, pe.telefono
  order by saldo_total desc;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.3 — Deudas a propietarios AHORA MISMO: cobros todavía no volcados a
-- ninguna liquidación + liquidaciones ya generadas pero pendientes de
-- pago. Reusa bruto_propietario/comision_pct_para (migración 007) para
-- no desincronizarse de generar_liquidacion(). Solo pesos — un contrato
-- en USD sin liquidar aparece igual, marcado con aviso_usd.
-- ---------------------------------------------------------------------

create or replace function public.informe_deudas_propietarios()
returns table (persona_id bigint, nombre text, deuda_cobros_sin_liquidar bigint, deuda_liquidaciones_pendientes bigint, deuda_total bigint, aviso_usd boolean)
language plpgsql
stable
as $$
begin
  return query
  with propietarios as (
    select distinct pp.persona_id from public.propiedad_propietario pp
  ),
  cobros_pendientes as (
    select pp.persona_id as pid, sum(
      public.bruto_propietario(ct.propiedad_id, pp.persona_id, cu.monto_alquiler)
      - round(public.bruto_propietario(ct.propiedad_id, pp.persona_id, cu.monto_alquiler)
              * public.comision_pct_para(ct.comision_admin_pct, pr.comision_admin_pct) / 100)
    ) as monto
    from public.cuotas cu
    join public.contratos ct on ct.id = cu.contrato_id
    join public.propiedades pr on pr.id = ct.propiedad_id
    join public.propiedad_propietario pp on pp.propiedad_id = ct.propiedad_id
    join public.pago_imputacion pi on pi.cuota_id = cu.id and pi.concepto = 'alquiler'
    join public.pagos p on p.id = pi.pago_id and p.anulado = false
    where ct.moneda = 'ARS'
      and not exists (
        select 1 from public.liquidacion_detalle ld
        join public.liquidaciones l on l.id = ld.liquidacion_id
        where ld.cuota_id = cu.id and ld.tipo = 'cobro' and l.estado <> 'anulada' and l.persona_id = pp.persona_id
      )
    group by pp.persona_id
  ),
  liquidaciones_pendientes as (
    select li.persona_id as pid, sum(li.total_neto) as monto
    from public.liquidaciones li where li.estado = 'pendiente'
    group by li.persona_id
  ),
  aviso_usd as (
    select distinct pp.persona_id as pid
    from public.cuotas cu
    join public.contratos ct on ct.id = cu.contrato_id
    join public.propiedad_propietario pp on pp.propiedad_id = ct.propiedad_id
    join public.pago_imputacion pi on pi.cuota_id = cu.id and pi.concepto = 'alquiler'
    join public.pagos p on p.id = pi.pago_id and p.anulado = false
    where ct.moneda = 'USD'
      and not exists (
        select 1 from public.liquidacion_detalle ld
        join public.liquidaciones l on l.id = ld.liquidacion_id
        where ld.cuota_id = cu.id and ld.tipo = 'cobro' and l.estado <> 'anulada' and l.persona_id = pp.persona_id
      )
  )
  select pe.id, pe.nombre,
    coalesce(cp.monto, 0)::bigint, coalesce(lp.monto, 0)::bigint,
    (coalesce(cp.monto, 0) + coalesce(lp.monto, 0))::bigint,
    (au.pid is not null)
  from propietarios prop
  join public.personas pe on pe.id = prop.persona_id
  left join cobros_pendientes cp on cp.pid = prop.persona_id
  left join liquidaciones_pendientes lp on lp.pid = prop.persona_id
  left join aviso_usd au on au.pid = prop.persona_id
  where coalesce(cp.monto, 0) + coalesce(lp.monto, 0) > 0 or au.pid is not null
  order by pe.nombre;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.4 — Contratos próximos a vencer (con piso en hoy: uno ya vencido no
-- es "por vencer", eso es 3.7).
-- ---------------------------------------------------------------------

create or replace function public.informe_contratos_por_vencer()
returns table (contrato_id bigint, propiedad_codigo text, inquilino text, fecha_fin date, dias_restantes int)
language plpgsql
stable
as $$
declare
  v_dias int;
begin
  v_dias := public.config_numero('dias_aviso_vencimiento_contrato', 60)::int;
  return query
  select ct.id, pr.codigo, pe.nombre, ct.fecha_fin, (ct.fecha_fin - current_date)::int
  from public.contratos ct
  join public.propiedades pr on pr.id = ct.propiedad_id
  join public.personas pe on pe.id = ct.inquilino_id
  where ct.estado = 'vigente'
    and ct.fecha_fin >= current_date
    and ct.fecha_fin <= current_date + v_dias
  order by ct.fecha_fin;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.5 — Contratos vigentes cuyo propietario todavía no tiene liquidación
-- generada para el período dado (falta generarla, no que esté sin pagar).
-- ---------------------------------------------------------------------

create or replace function public.informe_liquidaciones_pendientes_generar(p_periodo text)
returns table (contrato_id bigint, propiedad_codigo text, propietario text, persona_id bigint)
language plpgsql
stable
as $$
begin
  return query
  select distinct ct.id, pr.codigo, pe.nombre, pe.id
  from public.contratos ct
  join public.propiedades pr on pr.id = ct.propiedad_id
  join public.propiedad_propietario pp on pp.propiedad_id = ct.propiedad_id
  join public.personas pe on pe.id = pp.persona_id
  where ct.estado = 'vigente'
    and not exists (select 1 from public.liquidaciones li where li.persona_id = pe.id and li.periodo = p_periodo)
  order by pr.codigo;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.6 — Contratos con pagos garantizados pendientes: lo que debe el
-- inquilino vs. lo que la inmobiliaria ya le adelantó al propietario —
-- dos deudas distintas, en direcciones distintas.
-- ---------------------------------------------------------------------

create or replace function public.informe_garantizados_pendientes()
returns table (
  contrato_id bigint, propiedad_codigo text, inquilino text, propietarios text,
  periodo text, fecha_vencimiento date, deuda_inquilino bigint, adelanto_propietario bigint
)
language plpgsql
stable
as $$
begin
  return query
  select ct.id, pr.codigo, pe_inq.nombre,
    (select string_agg(pe_prop.nombre, ', ') from public.propiedad_propietario pp
      join public.personas pe_prop on pe_prop.id = pp.persona_id where pp.propiedad_id = ct.propiedad_id),
    cu.periodo, cu.fecha_vencimiento,
    (cu.monto_alquiler + cu.monto_expensas + cu.monto_otros - cu.bonificacion),
    cu.monto_alquiler
  from public.cuotas cu
  join public.contratos ct on ct.id = cu.contrato_id
  join public.propiedades pr on pr.id = ct.propiedad_id
  join public.personas pe_inq on pe_inq.id = ct.inquilino_id
  where ct.liquidacion_garantizada = true
    and cu.estado = 'pendiente'
    and (current_date - cu.fecha_vencimiento) > coalesce(ct.dias_gracia_mora, public.config_numero('dias_gracia_mora', 0)::int)
  order by cu.fecha_vencimiento;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.7 — Contratos vencidos con deuda: "vencido" a mano, o "vigente" con
-- fecha_fin ya pasada (nada pone el estado en 'vencido' solo hoy).
-- ---------------------------------------------------------------------

create or replace function public.informe_contratos_vencidos_deuda()
returns table (contrato_id bigint, propiedad_codigo text, inquilino text, fecha_fin date, dias_vencido int, saldo bigint)
language plpgsql
stable
as $$
begin
  return query
  select ct.id, pr.codigo, pe.nombre, ct.fecha_fin, (current_date - ct.fecha_fin)::int,
    sum(cu.monto_alquiler + cu.monto_expensas + cu.monto_otros + cu.monto_punitorio - cu.bonificacion)
  from public.contratos ct
  join public.propiedades pr on pr.id = ct.propiedad_id
  join public.personas pe on pe.id = ct.inquilino_id
  join public.cuotas cu on cu.contrato_id = ct.id and cu.estado = 'pendiente'
  where (ct.estado = 'vencido' or (ct.estado = 'vigente' and ct.fecha_fin < current_date))
  group by ct.id, pr.codigo, pe.nombre, ct.fecha_fin
  having sum(cu.monto_alquiler + cu.monto_expensas + cu.monto_otros + cu.monto_punitorio - cu.bonificacion) > 0
  order by dias_vencido desc;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.12 — Alarmas activas: vencimientos calculados al vuelo (contratos
-- por vencer, cuotas en mora, cheques en cartera vencidos) más
-- recordatorios manuales pendientes — cada fila dice de dónde viene.
-- ---------------------------------------------------------------------

create or replace function public.informe_alarmas()
returns table (origen text, descripcion text, fecha date, detalle text)
language plpgsql
stable
as $$
declare
  v_dias_aviso int;
begin
  v_dias_aviso := public.config_numero('dias_aviso_vencimiento_contrato', 60)::int;
  return query
  select 'Contrato por vencer'::text, pr.codigo || ' — ' || pe.nombre, ct.fecha_fin,
    ('Vence en ' || (ct.fecha_fin - current_date) || ' día(s)')::text
  from public.contratos ct
  join public.propiedades pr on pr.id = ct.propiedad_id
  join public.personas pe on pe.id = ct.inquilino_id
  where ct.estado = 'vigente' and ct.fecha_fin >= current_date and ct.fecha_fin <= current_date + v_dias_aviso

  union all

  select 'Cuota en mora'::text, pr.codigo || ' — ' || pe.nombre, cu.fecha_vencimiento,
    ('Período ' || cu.periodo || ', ' || (current_date - cu.fecha_vencimiento) || ' día(s) de atraso')::text
  from public.cuotas cu
  join public.contratos ct on ct.id = cu.contrato_id
  join public.propiedades pr on pr.id = ct.propiedad_id
  join public.personas pe on pe.id = ct.inquilino_id
  where cu.estado = 'pendiente'
    and (current_date - cu.fecha_vencimiento) > coalesce(ct.dias_gracia_mora, public.config_numero('dias_gracia_mora', 0)::int)

  union all

  select 'Cheque en cartera vencido'::text, coalesce(pe.nombre, 'Sin persona'), pc.fecha_cheque,
    ('Cheque Nº ' || coalesce(pc.numero, '-') || ', banco ' || coalesce(pc.banco, '-'))::text
  from public.pago_cheque pc
  join public.pagos pg on pg.id = pc.pago_id
  left join public.personas pe on pe.id = pg.persona_id
  where pc.estado = 'en_cartera' and pc.fecha_cheque is not null and pc.fecha_cheque < current_date

  union all

  select 'Recordatorio pendiente'::text, ev.titulo, ev.fecha, coalesce(ev.descripcion, '')::text
  from public.eventos ev
  where ev.estado = 'pendiente' and ev.tipo <> 'vencimiento'

  order by fecha;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.14 — Inquilinos por propietario: propietario → inmueble → inquilino
-- del contrato vigente, aplanado en filas.
-- ---------------------------------------------------------------------

create or replace function public.informe_inquilinos_por_propietario()
returns table (propietario text, propiedad_codigo text, propiedad_direccion text, inquilino text, contrato_id bigint)
language plpgsql
stable
as $$
begin
  return query
  select pe_prop.nombre, pr.codigo, trim(coalesce(pr.calle, '') || ' ' || coalesce(pr.numero, '')),
    pe_inq.nombre, ct.id
  from public.propiedad_propietario pp
  join public.personas pe_prop on pe_prop.id = pp.persona_id
  join public.propiedades pr on pr.id = pp.propiedad_id
  left join public.contratos ct on ct.propiedad_id = pr.id and ct.estado = 'vigente'
  left join public.personas pe_inq on pe_inq.id = ct.inquilino_id
  order by pe_prop.nombre, pr.codigo;
end;
$$;
