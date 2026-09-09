-- =====================================================================
-- PATRICIA DAADIN — Fase 7 del panel CRM: Agenda
-- Correr UNA VEZ, en el mismo proyecto de Supabase donde ya corriste
-- 001-009 (schema, inmuebles/personas, contratos, Cobranzas, Liquidación,
-- Caja diaria, Ventas).
--
-- Puerto de src/routes/eventos.js + src/agenda/eventos.js de InmoGestion.
-- Igual que Caja diaria (migración 008), los eventos de "vencimiento" que
-- nacen solos de un contrato/cuota se enganchan con TRIGGERS sobre
-- contratos/cuotas — sin tocar crear_contrato, generar_cuotas_pendientes,
-- rescindir_contrato ni registrar_cobro (funciones ya probadas). El resto
-- (visita, llamado, tasación, firma, recordatorio, otro) es alta/edición
-- simple, sin necesidad de ninguna función nueva — va directo por
-- supabase-js, protegido por la RLS de siempre.
-- =====================================================================

create table if not exists public.eventos (
  id bigint generated always as identity primary key,
  tipo text not null default 'visita' check (tipo in ('visita', 'llamado', 'vencimiento', 'tasacion', 'firma', 'recordatorio', 'otro')),
  titulo text not null,
  descripcion text,
  fecha date not null,
  hora text,
  propiedad_id bigint references public.propiedades(id),
  persona_id bigint references public.personas(id),
  contrato_id bigint references public.contratos(id),
  cuota_id bigint references public.cuotas(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'realizado', 'cancelado')),
  resultado text,
  creado_en timestamptz not null default now()
);

create index if not exists idx_eventos_fecha on public.eventos (fecha);
create index if not exists idx_eventos_contrato on public.eventos (contrato_id);
create index if not exists idx_eventos_cuota on public.eventos (cuota_id);

alter table public.eventos enable row level security;
create policy "Authenticated all eventos" on public.eventos for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Un contrato nuevo deja un evento por su fecha de fin, y cada cuota que
-- se genere deja el suyo por su vencimiento — la usuaria quiere las dos
-- cosas (el cartel de cuotas por cobrar Y el recordatorio en agenda).
-- ---------------------------------------------------------------------

create or replace function public.fn_evento_vencimiento_contrato()
returns trigger
language plpgsql
as $$
begin
  insert into public.eventos (tipo, titulo, fecha, propiedad_id, persona_id, contrato_id, estado)
  values ('vencimiento', 'Vencimiento de contrato', new.fecha_fin, new.propiedad_id, new.inquilino_id, new.id, 'pendiente');
  return new;
end;
$$;

create trigger trg_evento_vencimiento_contrato
after insert on public.contratos
for each row
execute function public.fn_evento_vencimiento_contrato();

create or replace function public.fn_evento_vencimiento_cuota()
returns trigger
language plpgsql
as $$
declare
  v_contrato record;
begin
  select * into v_contrato from public.contratos where id = new.contrato_id;
  insert into public.eventos (tipo, titulo, fecha, propiedad_id, persona_id, contrato_id, cuota_id, estado)
  values (
    'vencimiento', 'Vencimiento de cuota (' || new.periodo || ')', new.fecha_vencimiento,
    v_contrato.propiedad_id, v_contrato.inquilino_id, new.contrato_id, new.id, 'pendiente'
  );
  return new;
end;
$$;

create trigger trg_evento_vencimiento_cuota
after insert on public.cuotas
for each row
execute function public.fn_evento_vencimiento_cuota();

-- Refleja en el evento de una cuota puntual lo que le pasó a la cuota:
-- cobrada, anulada, o vuelta a deberse (por ejemplo al anular un cobro).
create or replace function public.fn_sincronizar_evento_cuota()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'pagada' then
    update public.eventos set estado = 'realizado', resultado = 'Cuota cobrada.' where cuota_id = new.id and tipo = 'vencimiento';
  elsif new.estado = 'anulada' then
    update public.eventos set estado = 'cancelado', resultado = 'Cuota anulada.' where cuota_id = new.id and tipo = 'vencimiento';
  else
    update public.eventos set estado = 'pendiente', resultado = null where cuota_id = new.id and tipo = 'vencimiento';
  end if;
  return new;
end;
$$;

create trigger trg_sincronizar_evento_cuota
after update of estado on public.cuotas
for each row when (new.estado is distinct from old.estado)
execute function public.fn_sincronizar_evento_cuota();

-- Rescindir o renovar deja obsoleto el recordatorio de fin de contrato
-- (los de cada cuota se sincronizan aparte, arriba — una rescisión puede
-- dejar cuotas ya cobradas intactas y solo anular las futuras).
create or replace function public.fn_cancelar_vencimiento_contrato()
returns trigger
language plpgsql
as $$
begin
  update public.eventos
  set estado = 'cancelado', resultado = 'Contrato dado de baja (rescindido o renovado).'
  where contrato_id = new.id and tipo = 'vencimiento' and cuota_id is null and estado = 'pendiente';
  return new;
end;
$$;

create trigger trg_cancelar_vencimiento_contrato
after update of estado on public.contratos
for each row when (new.estado in ('rescindido', 'renovado') and old.estado not in ('rescindido', 'renovado'))
execute function public.fn_cancelar_vencimiento_contrato();
