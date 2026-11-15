-- Esquema compartilhado do beta Despensa. Rode no SQL Editor do Supabase.
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (household_id, email)
);

create table if not exists public.household_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  state jsonb not null default jsonb_build_object('pilotStart', current_date::text, 'pilotDays', 35, 'receipts', '[]'::jsonb),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null default '',
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_household_created_idx on public.audit_events (household_id, created_at desc);

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.household_members m where m.household_id = target_household and m.user_id = auth.uid()); $$;

create or replace function public.is_household_admin(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.household_members m where m.household_id = target_household and m.user_id = auth.uid() and m.role = 'admin'); $$;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_admin(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_admin(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_state enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists households_read_member on public.households;
create policy households_read_member on public.households for select to authenticated using (public.is_household_member(id));

drop policy if exists members_read_self_or_admin on public.household_members;
create policy members_read_self_or_admin on public.household_members for select to authenticated using (user_id = auth.uid() or public.is_household_admin(household_id));

drop policy if exists state_read_member on public.household_state;
create policy state_read_member on public.household_state for select to authenticated using (public.is_household_member(household_id));
drop policy if exists state_update_member on public.household_state;
create policy state_update_member on public.household_state for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists audit_read_admin on public.audit_events;
create policy audit_read_admin on public.audit_events for select to authenticated using (public.is_household_admin(household_id));

create or replace function public.audit_household_state_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  before_count integer;
  after_count integer;
  added_ids jsonb;
  changed_ids jsonb;
  removed_ids jsonb;
begin
  before_count := case when jsonb_typeof(old.state->'receipts') = 'array' then jsonb_array_length(old.state->'receipts') else 0 end;
  after_count := case when jsonb_typeof(new.state->'receipts') = 'array' then jsonb_array_length(new.state->'receipts') else 0 end;
  new.updated_at := now();
  new.updated_by := auth.uid();
  select coalesce(jsonb_agg(n.item->>'id'), '[]'::jsonb) into added_ids
    from jsonb_array_elements(coalesce(new.state->'receipts', '[]'::jsonb)) as n(item)
    where n.item->>'id' is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(old.state->'receipts', '[]'::jsonb)) as o(item)
      where o.item->>'id' = n.item->>'id'
    );
  select coalesce(jsonb_agg(n.item->>'id'), '[]'::jsonb) into changed_ids
    from jsonb_array_elements(coalesce(new.state->'receipts', '[]'::jsonb)) as n(item)
    join jsonb_array_elements(coalesce(old.state->'receipts', '[]'::jsonb)) as o(item)
      on o.item->>'id' = n.item->>'id'
    where n.item is distinct from o.item;
  select coalesce(jsonb_agg(o.item->>'id'), '[]'::jsonb) into removed_ids
    from jsonb_array_elements(coalesce(old.state->'receipts', '[]'::jsonb)) as o(item)
    where o.item->>'id' is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(new.state->'receipts', '[]'::jsonb)) as n(item)
      where n.item->>'id' = o.item->>'id'
    );
  insert into public.audit_events (household_id, actor_id, actor_email, action, details)
  values (
    new.household_id,
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    'compras.atualizadas',
    jsonb_build_object('notas_antes', before_count, 'notas_depois', after_count,
      'notas_adicionadas', added_ids, 'notas_alteradas', changed_ids, 'notas_removidas', removed_ids)
  );
  return new;
end;
$$;

drop trigger if exists household_state_audit_update on public.household_state;
create trigger household_state_audit_update before update on public.household_state
for each row execute function public.audit_household_state_update();

grant select on public.households, public.household_members, public.household_state, public.audit_events to authenticated;
grant update on public.household_state to authenticated;

-- Permite que a outra pessoa veja novas compras enquanto mantém o site aberto.
do $$
begin
  execute 'alter publication supabase_realtime add table public.household_state';
exception
  when duplicate_object then null;
end $$;


