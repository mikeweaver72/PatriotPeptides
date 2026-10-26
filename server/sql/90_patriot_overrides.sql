-- Patriot Peptides USA · overrides on top of the PST schema (run after 08_cron_jobs.sql, before 95_seed_catalog.sql)
-- Everything here is idempotent. Placeholders (__PPU_*) are filled by tools/configure.py.

-- 1. Order / customer number prefixes: PST-O → PP-O, PST-C → PP-C ------------------------------
create or replace function public.generate_order_number()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.order_sequence_number is null then
    new.order_sequence_number := nextval('public.order_number_seq');
  end if;
  if new.order_number is null or new.order_number !~ '^PP-O[0-9]+$' then
    if new.legacy_order_number is null and new.order_number is not null then
      new.legacy_order_number := new.order_number;
    end if;
    new.order_number := 'PP-O' || new.order_sequence_number::text;
  end if;
  return new;
end;
$function$;

-- admin_create_manual_order builds the customer number string inline; swap the literal in place
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_create_manual_order';
  if src is not null and position('''PST-C''' in src) > 0 then
    execute replace(src, '''PST-C''', '''PP-C''');
  end if;
end $$;

-- incoming purchase orders: PST-PO → PP-PO
create or replace function public.next_incoming_po_number()
returns text language plpgsql security definer set search_path to '' as $function$
begin
  return 'PP-PO' || lpad(nextval('public.incoming_purchase_order_number_seq')::text, 6, '0');
end;
$function$;

-- Start numbering at 100100 so Patriot numbers never look like old WooCommerce order IDs (#1xxx)
select setval('public.order_number_seq', greatest(100100, (select coalesce(max(order_sequence_number), 0) from public.orders)), true);
select setval('public.customer_number_seq', greatest(100100, (select coalesce(max(customer_number), 0) from public.customer_profiles)), true);

-- 2. Payment options shown at checkout ------------------------------------------------------------
insert into public.site_payment_options (id, payment_methods, venmo_enabled, venmo_handle, venmo_note, updated_at)
values (1,
  '[{"id":"venmo","label":"Venmo","enabled":true,"sort":1,"account":"@Patriot-peptides-USA","accountLabel":"Send to","instructions":"Put your order number (PP-O…) in the Venmo note so we can match it fast.","discountPercent":0},
    {"id":"cashapp","label":"Cash App","enabled":true,"sort":2,"account":"$inkfreak69","accountLabel":"Send to","instructions":"Put your order number (PP-O…) in the Cash App note.","discountPercent":0}]'::jsonb,
  true, 'Patriot-peptides-USA', 'Put your order number (PP-O…) in the Venmo note so we can match it fast.', now())
on conflict (id) do update set
  payment_methods = excluded.payment_methods, venmo_enabled = excluded.venmo_enabled,
  venmo_handle = excluded.venmo_handle, venmo_note = excluded.venmo_note, updated_at = now();

-- 3. Storefront default and PST-only seeds ---------------------------------------------------------
-- orders.storefront stays 'peptides' (it is a sales channel, checked by orders_storefront_allowed; 'supplies' is the other)
update public.product_catalog set home_feature_rank = null where product_key like 'PSTP%';
delete from public.product_key_aliases where migration_label = 'pstp_item_number_migration';

-- 4. Admins: Jeff (owner@) and Mike. admin_users needs an auth user, so enrol by email the moment they sign up.
create table if not exists public.ppu_admin_allowlist (email text primary key, note text, created_at timestamptz not null default now());
insert into public.ppu_admin_allowlist (email, note) values
  ('owner@patriotpeptides-usa.com', 'Jeff · owner'),
  ('patriotpepps@gmail.com', 'Jeff · owner (day-to-day email)'),
  ('mike.weaver2013@gmail.com', 'Mike · build/support')
on conflict (email) do nothing;
alter table public.ppu_admin_allowlist enable row level security;

create or replace function public.ppu_enrol_admin_on_signup()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if exists (select 1 from public.ppu_admin_allowlist a where lower(a.email) = lower(new.email)) then
    insert into public.admin_users (user_id, email, is_active) values (new.id, lower(new.email), true)
    on conflict (user_id) do update set is_active = true, email = excluded.email;
  end if;
  return new;
exception when others then
  raise warning 'ppu_enrol_admin_on_signup skipped: %', sqlerrm; return new;
end;
$function$;
drop trigger if exists ppu_enrol_admin_on_signup on auth.users;
create trigger ppu_enrol_admin_on_signup after insert on auth.users
  for each row execute function public.ppu_enrol_admin_on_signup();
-- catch anyone who signed up before this ran
insert into public.admin_users (user_id, email, is_active)
select u.id, lower(u.email), true from auth.users u join public.ppu_admin_allowlist a on lower(a.email) = lower(u.email)
on conflict (user_id) do update set is_active = true;

-- 5. Rewards / shipping settings used by the owner app ------------------------------------------------
-- (tables are created by 01_migrations; rows are keyed id=1 like PST)
do $$
begin
  if to_regclass('public.pst_sms_settings') is not null then
    insert into public.pst_sms_settings (id) values (1) on conflict do nothing;
  end if;
  if to_regclass('public.pst_rewards_settings') is not null then
    insert into public.pst_rewards_settings (id) values (1) on conflict do nothing;
  end if;
end $$;

-- 6. Push + alert hooks call edge functions by URL inside the DB; point them at this project ------
-- (the schema files are run through tools/configure.py, which rewrites __PPU_SUPABASE_REF__ before you paste them)
do $$
declare r record; src text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%ndpfnerhvawbavkotinh.supabase.co%' loop
    src := replace(pg_get_functiondef(r.oid), 'ndpfnerhvawbavkotinh.supabase.co', '__PPU_SUPABASE_REF__.supabase.co');
    execute src;
  end loop;
end $$;

-- 7. Timezone: the owner app and emails use America/Los_Angeles (Jeff ships from Oregon). It lives in
--    js/pst-owner-mkt.js and server/functions/send-order-email + send-sms-blast, not in the DB.
