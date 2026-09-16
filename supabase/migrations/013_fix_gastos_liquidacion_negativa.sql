-- =============================================================================
-- Arregla generar_liquidacion(): los gastos pendientes se descontaban del
-- propietario aunque ese periodo no se le hubiera cobrado nada al inquilino,
-- dejando liquidaciones en negativo (el propietario "debiendo" plata por un
-- gasto de mantenimiento). Confirmado con la clienta que eso esta mal.
--
-- Ahora los gastos se descuentan solo hasta cubrir lo que realmente entro
-- este periodo (cobrado - comision), en orden de fecha (mas viejo primero).
-- El primer gasto que no entre entero deja el resto pendiente para la
-- proxima liquidacion que tenga cobros para compensarlo — nunca se genera
-- una liquidacion en rojo por un gasto solo.
-- =============================================================================

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
  v_disponible bigint;
  v_filas int;
  v_gasto record;
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

  select coalesce(sum(monto), 0) into v_total_cobrado from public.liquidacion_detalle where liquidacion_id = v_liquidacion_id and tipo = 'cobro';
  select coalesce(sum(monto), 0) into v_total_comision from public.liquidacion_detalle where liquidacion_id = v_liquidacion_id and tipo = 'comision';
  v_disponible := v_total_cobrado - v_total_comision;

  -- Gastos pendientes a cargo de esta persona (responsable de la propiedad),
  -- pero solo hasta cubrir lo disponible de este período — en orden de
  -- fecha, más viejo primero. El primer gasto que no entre entero corta el
  -- descuento ahí: el resto queda pendiente para una próxima liquidación
  -- que sí tenga cobros para compensarlo.
  for v_gasto in
    select g.* from public.gastos g
    where g.liquidado = false and g.anulado = false
      and exists (select 1 from public.propiedad_propietario pp where pp.propiedad_id = g.propiedad_id and pp.persona_id = p_persona_id)
      and public.responsable_gastos_propiedad(g.propiedad_id) = p_persona_id
    order by g.fecha, g.id
  loop
    exit when v_gasto.monto > v_disponible;
    insert into public.liquidacion_detalle (liquidacion_id, propiedad_id, cuota_id, concepto, tipo, monto, porcentaje_prop)
    values (v_liquidacion_id, v_gasto.propiedad_id, null, v_gasto.concepto, 'gasto', v_gasto.monto, 100);
    update public.gastos set liquidado = true, liquidacion_id = v_liquidacion_id where id = v_gasto.id;
    v_disponible := v_disponible - v_gasto.monto;
  end loop;

  select count(*) into v_filas from public.liquidacion_detalle where liquidacion_id = v_liquidacion_id;
  if v_filas = 0 then
    delete from public.liquidaciones where id = v_liquidacion_id;
    return jsonb_build_object('generada', false, 'motivo', 'No hay cobros ni gastos pendientes de liquidar para esta persona en este período.');
  end if;

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
