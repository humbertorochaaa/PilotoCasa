-- Rode depois do schema.sql e depois de criar seu próprio usuário em
-- Authentication > Users no Supabase. Troque o e-mail abaixo pelo seu.
do $$
declare
  initial_admin_id uuid;
  new_household_id uuid;
  initial_admin_email text := lower('SEU_EMAIL_AQUI');
begin
  select id into initial_admin_id from auth.users where lower(email) = initial_admin_email limit 1;
  if initial_admin_id is null then
    raise exception 'Crie primeiro o usuário % em Authentication > Users.', initial_admin_email;
  end if;

  insert into public.households (name) values ('Piloto da casa') returning id into new_household_id;
  insert into public.household_members (household_id, user_id, email, role)
    select new_household_id, id, lower(email), 'admin' from auth.users where id = initial_admin_id;
  insert into public.household_state (household_id)
    values (new_household_id);
end $$;


