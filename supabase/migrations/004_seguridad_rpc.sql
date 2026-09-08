-- =====================================================================
-- PATRICIA DAADIN — Arreglo de seguridad URGENTE
-- Correr esto lo antes posible en el SQL Editor de Supabase.
--
-- Qué pasaba: las funciones que crean/rescinden/renuevan contratos y la
-- que reemplaza propietarios son "security definer" (corren con
-- privilegios propios para poder tocar varias tablas de forma atómica,
-- como si fuera un db.transaction()). Eso las hace saltarse las
-- políticas de "solo usuarios logueados" (RLS) de las tablas que tocan
-- — y por default, Postgres deja que CUALQUIERA (sin login, con solo la
-- clave pública del sitio) las llame igual.
--
-- Verificado en vivo: se pudo invocar crear_contrato() sin sesión
-- iniciada, usando nada más que la clave pública que ya viaja en el
-- código del sitio (es normal que esa clave sea pública — el problema
-- es que estas funciones no revisaban quién las llamaba).
--
-- El arreglo: cada una de estas funciones ahora exige explícitamente
-- una sesión de usuario logueado antes de hacer cualquier cosa. Nada
-- más cambia — la lógica de cada una queda igual.
-- =====================================================================

create or replace function public.reemplazar_propietarios(
  p_propiedad_id bigint,
  p_propietarios jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  suma numeric;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

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

    exit when venc >= c.fecha_fin;
    venc := public.siguiente_vencimiento(venc, c.dia_vencimiento);
  end loop;

  return query select contador, detenido;
end;
$$;

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
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

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

create or replace function public.rescindir_contrato(p_contrato_id bigint, p_fecha_rescision date, p_motivo text)
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
  if auth.role() <> 'authenticated' then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

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
