-- =====================================================================
-- PATRICIA DAADIN — Arreglo de bugs en Informes (migración 011)
-- Correr en el SQL Editor de Supabase, después de la 011.
--
-- Encontrados probando en vivo:
-- 1) informe_morosos e informe_contratos_vencidos_deuda: sum() sobre
--    columnas bigint devuelve NUMERIC en Postgres, no bigint — quedaba
--    desajustado contra el RETURNS TABLE de la función. Se agrega el
--    cast explícito.
-- 2) informe_alarmas: "order by fecha" al final de una consulta con
--    UNION ALL no resuelve por nombre (las columnas de cada rama no
--    llevan alias) — hay que ordenar por posición ("order by 3").
-- =====================================================================

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
    )::bigint as saldo_total
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

create or replace function public.informe_contratos_vencidos_deuda()
returns table (contrato_id bigint, propiedad_codigo text, inquilino text, fecha_fin date, dias_vencido int, saldo bigint)
language plpgsql
stable
as $$
begin
  return query
  select ct.id, pr.codigo, pe.nombre, ct.fecha_fin, (current_date - ct.fecha_fin)::int,
    sum(cu.monto_alquiler + cu.monto_expensas + cu.monto_otros + cu.monto_punitorio - cu.bonificacion)::bigint
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

  order by 3;
end;
$$;
