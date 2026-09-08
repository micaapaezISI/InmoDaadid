-- =====================================================================
-- PATRICIA DAADIN — Arreglo: generar_cuotas_pendientes generaba una
-- cuota de más, pasado el fin del contrato.
--
-- Qué pasaba: la condición de corte comparaba la fecha de vencimiento
-- exacta contra fecha_fin ("exit when venc >= c.fecha_fin"). Si el día
-- de vencimiento (ej: 10) es menor al día de fecha_fin (ej: 31/12), la
-- cuota del último mes del contrato (10/12) no cumple esa condición
-- todavía, así que el generador arma UNA cuota más, ya en el mes
-- siguiente al contrato (10/01 del año que viene).
--
-- Verificado en vivo: contrato de 2026-01-01 a 2026-12-31, vencimiento
-- día 10 → generó 13 cuotas (hasta enero 2027) en vez de 12.
--
-- El arreglo: cortar por mes/año de la fecha de vencimiento contra el
-- mes/año de fecha_fin, no por la fecha exacta. Nada más cambia.
-- =====================================================================

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
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into c from public.contratos where id = p_contrato_id;
  if not found then
    raise exception 'No existe ese contrato.';
  end if;

  select max(fecha_vencimiento) into ultima_venc
  from public.cuotas where contrato_id = p_contrato_id and estado <> 'anulada';

  if ultima_venc is not null then
    venc := public.siguiente_vencimiento(ultima_venc, c.dia_vencimiento);
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

  -- Si ya se generó la cuota del último mes del contrato (o más allá),
  -- no hay nada que hacer.
  if date_trunc('month', venc) > date_trunc('month', c.fecha_fin) then
    return query select 0, false;
    return;
  end if;

  loop
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
            nuevo_monto := null;
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

    -- Corta por mes, no por fecha exacta: si el día de vencimiento es
    -- menor al día de fecha_fin, la cuota del último mes del contrato
    -- igual tiene que ser la última (ver cabecera de este archivo).
    exit when date_trunc('month', venc) >= date_trunc('month', c.fecha_fin);
    venc := public.siguiente_vencimiento(venc, c.dia_vencimiento);
  end loop;

  return query select contador, detenido;
end;
$$;
