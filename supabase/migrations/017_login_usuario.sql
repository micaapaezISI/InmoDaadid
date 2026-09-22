-- =============================================================================
-- Login por "usuario" en vez de email.
-- ---------------------------------------------------------------------------
-- Supabase Auth sigue siendo por email por dentro (no hay forma de evitarlo
-- sin cambiar de proveedor de autenticación), pero se agrega una tabla que
-- mapea un "usuario" elegido a la cuenta real, y una función que lo traduce
-- al email antes de loguearse. El login sigue aceptando el email directo
-- también (compatibilidad: mientras no elija un usuario todavía, entra
-- igual que siempre) — así no hace falta saber su email desde acá para
-- migrarla, ella misma lo hace una vez logueada, desde el panel.
-- =============================================================================

create table if not exists public.admin_usuarios (
  usuario text primary key check (char_length(usuario) between 3 and 40),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  actualizado_en timestamptz not null default now()
);

alter table public.admin_usuarios enable row level security;

-- Cada admin logueado puede elegir/cambiar SU PROPIO usuario (no el de otra
-- cuenta, si en el futuro hay más de una).
create policy "Authenticated manage own usuario"
  on public.admin_usuarios for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Traduce un "usuario" al email real para poder loguearse. La tiene que
-- poder llamar cualquiera (todavía no hay sesión en ese momento), pero solo
-- devuelve el email si ese usuario existe — no expone nada más de la tabla.
create or replace function public.usuario_a_email(p_usuario text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select au.email
  from public.admin_usuarios u
  join auth.users au on au.id = u.user_id
  where lower(u.usuario) = lower(trim(p_usuario))
  limit 1;
$$;

revoke all on function public.usuario_a_email(text) from public;
grant execute on function public.usuario_a_email(text) to anon, authenticated;

create or replace function public.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_usuarios_actualizado_en on public.admin_usuarios;
create trigger trg_admin_usuarios_actualizado_en
  before update on public.admin_usuarios
  for each row
  execute function public.tocar_actualizado_en();
