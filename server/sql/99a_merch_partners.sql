-- 99a: Merch and the Partner program (Promoter / Runner / Vendor). Oct 31, 2026.
-- Additive only. Safe to re-run.

-- ============ MERCH ============
-- Merch lives in product_catalog / product_inventory like everything else (one row per color + size),
-- so the bag, checkout, orders, stock and sales all work as they do today. category = 'Merch'.
alter table public.product_catalog add column if not exists merch_color text;
alter table public.product_catalog add column if not exists merch_size text;
alter table public.product_catalog add column if not exists merch_desc text;
alter table public.product_catalog add column if not exists photo_url text;
alter table public.product_catalog add column if not exists merch_sort integer;
alter table public.product_catalog add column if not exists merch_retired boolean not null default false; -- an option (color/size) he removed: stays for past orders, never comes back on by itself

insert into storage.buckets (id, name, public) values ('merch-photos', 'merch-photos', true) on conflict (id) do nothing;
drop policy if exists "merch photos are public" on storage.objects;
create policy "merch photos are public" on storage.objects for select using (bucket_id = 'merch-photos');
drop policy if exists "owner uploads merch photos" on storage.objects;
create policy "owner uploads merch photos" on storage.objects for insert to authenticated with check (bucket_id = 'merch-photos' and public.ppu_is_owner());
drop policy if exists "owner replaces merch photos" on storage.objects;
create policy "owner replaces merch photos" on storage.objects for update to authenticated using (bucket_id = 'merch-photos' and public.ppu_is_owner());
drop policy if exists "owner removes merch photos" on storage.objects;
create policy "owner removes merch photos" on storage.objects for delete to authenticated using (bucket_id = 'merch-photos' and public.ppu_is_owner());

-- ============ PARTNER PROGRAM ============
-- Not to be confused with public.vendors (Jeff's SUPPLIERS). Partners are the people he sells to:
-- Tier 1 Promoter (discount code), Tier 2 Runner and Tier 3 Vendor (their own price sheets).
create table if not exists public.ppu_partner_tiers (
  id integer primary key check (id between 1 and 9),
  name text not null,
  has_prices boolean not null default true,
  blurb text,
  updated_at timestamptz not null default now()
);
insert into public.ppu_partner_tiers (id, name, has_prices, blurb) values
  (1, 'Promoter', false, 'Promotes the site with an assigned 10% discount code.'),
  (2, 'Runner', true, 'Business runner: 5+ kits a month.'),
  (3, 'Vendor', true, 'Vendor partner: $1,000+ a month.')
on conflict (id) do nothing;

create table if not exists public.ppu_partners (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  name text,
  company text,
  phone text,
  tier integer not null references public.ppu_partner_tiers(id),
  status text not null default 'active' check (status in ('active', 'paused')),
  discount_code text,
  notes text,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ppu_partners_email_uq on public.ppu_partners (lower(email));
create index if not exists ppu_partners_user_idx on public.ppu_partners (user_id);

create table if not exists public.ppu_partner_prices (
  id uuid primary key default gen_random_uuid(),
  tier integer not null references public.ppu_partner_tiers(id),
  sku text not null,
  name text not null,
  amount text,
  price numeric(10,2) not null check (price >= 0),
  product_key text,
  active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (tier, sku)
);

alter table public.ppu_partner_tiers enable row level security;
alter table public.ppu_partners enable row level security;
alter table public.ppu_partner_prices enable row level security;

-- the partner row for whoever is signed in (a direct lookup, so the policies below never recurse)
create or replace function public.ppu_partner_tier_for(p_uid uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select p.tier from public.ppu_partners p where p.user_id = p_uid and p.status = 'active' limit 1;
$$;
revoke all on function public.ppu_partner_tier_for(uuid) from public, anon;
grant execute on function public.ppu_partner_tier_for(uuid) to authenticated;

drop policy if exists "owner manages tiers" on public.ppu_partner_tiers;
create policy "owner manages tiers" on public.ppu_partner_tiers for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
drop policy if exists "partners read tiers" on public.ppu_partner_tiers;
create policy "partners read tiers" on public.ppu_partner_tiers for select to authenticated using (public.ppu_partner_tier_for(auth.uid()) is not null);

drop policy if exists "owner manages partners" on public.ppu_partners;
create policy "owner manages partners" on public.ppu_partners for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
drop policy if exists "partner reads own row" on public.ppu_partners;
create policy "partner reads own row" on public.ppu_partners for select to authenticated using (user_id = auth.uid());

-- Price sheets: the owner, or an ACTIVE partner reading their OWN tier's live rows. Nobody else, ever.
drop policy if exists "owner manages partner prices" on public.ppu_partner_prices;
create policy "owner manages partner prices" on public.ppu_partner_prices for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
drop policy if exists "partner reads own tier prices" on public.ppu_partner_prices;
create policy "partner reads own tier prices" on public.ppu_partner_prices for select to authenticated using (active and tier = public.ppu_partner_tier_for(auth.uid()));
revoke all on public.ppu_partner_prices from anon;
revoke all on public.ppu_partners from anon;
revoke all on public.ppu_partner_tiers from anon;

-- Who am I in the program? Links the account on first sign-in by verified email. Returns null for non-partners.
create or replace function public.ppu_my_partner()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v public.ppu_partners%rowtype; v_t public.ppu_partner_tiers%rowtype;
begin
  if v_uid is null then return null; end if;
  select * into v from public.ppu_partners where user_id = v_uid limit 1;
  if not found and v_email <> '' then
    select * into v from public.ppu_partners where lower(email) = v_email and user_id is null limit 1;
    if found then
      update public.ppu_partners set user_id = v_uid, joined_at = coalesce(joined_at, now()), updated_at = now() where id = v.id returning * into v;
    end if;
  end if;
  if v.id is null then return null; end if;
  select * into v_t from public.ppu_partner_tiers where id = v.tier;
  return jsonb_build_object('id', v.id, 'name', v.name, 'company', v.company, 'email', v.email, 'tier', v.tier, 'tier_name', v_t.name,
    'has_prices', v_t.has_prices, 'status', v.status, 'discount_code', v.discount_code);
end $$;
revoke all on function public.ppu_my_partner() from public, anon;
grant execute on function public.ppu_my_partner() to authenticated;

-- Partner orders skip the 24-hour hold and shelf-stock reservation (Jeff orders these from his supplier).
-- Only ppu_partner_place_order can turn this on: it sets a transaction-local flag.
create or replace function public.pst_order_set_payment_deadline()
 returns trigger language plpgsql set search_path to '' as $function$
declare v_other boolean := lower(btrim(coalesce(new.payment_method, ''))) = 'other method';
begin
  if coalesce(current_setting('ppu.partner_order', true), '') = 'on' then
    new.payment_deadline_at := null;
    return new;
  end if;
  if v_other and not public.ppu_is_owner() then
    if not exists (select 1 from public.customer_profiles p where p.user_id = coalesce(new.user_id, new.customer_id) and p.other_payment_enabled) then
      raise exception 'Other method isn''t available on this account. Please choose Venmo or Cash App.' using errcode = 'P0001';
    end if;
  end if;
  if v_other then
    new.payment_deadline_at := null;  -- the team arranges payment by hand, so no 24-hour hold
  elsif new.payment_deadline_at is null and lower(coalesce(new.payment_status,'pending')) not in ('paid','refunded') then
    new.payment_deadline_at := coalesce(new.created_at, now()) + interval '24 hours';
  end if;
  return new;
end $function$;

-- Place a partner order. Prices, shipping and totals are worked out HERE from the partner's own tier,
-- never trusted from the browser. Prices are per 10-vial kit; quantity = kits. Shipping is billed later (split with the group).
create or replace function public.ppu_partner_place_order(p_lines jsonb, p_payment text, p_notes text default '')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid(); v public.ppu_partners%rowtype; c public.customer_profiles%rowtype;
  v_sub numeric := 0; v_ship numeric; v_st text; v_id uuid := gen_random_uuid(); v_no text; v_n integer := 0;
  l record; pr public.ppu_partner_prices%rowtype; v_now timestamptz := now(); v_name text; v_q integer;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  select * into v from public.ppu_partners where user_id = v_uid and status = 'active' limit 1;
  if not found then raise exception 'This account isn''t an active partner.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.ppu_partner_tiers t where t.id = v.tier and t.has_prices) then raise exception 'Your tier orders through the main shop.' using errcode = 'P0001'; end if;
  if p_payment is null or btrim(p_payment) = '' then raise exception 'Choose how you''ll pay.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Your order is empty.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'Too many lines in one order.' using errcode = 'P0001'; end if;
  select * into c from public.customer_profiles where user_id = v_uid;
  if coalesce(btrim(c.shipping_address), '') = '' or coalesce(btrim(c.shipping_state), '') = '' then
    raise exception 'Add your shipping address to your account first.' using errcode = 'P0001';
  end if;
  v_st := upper(btrim(c.shipping_state));
  v_ship := 0; -- Jeff (Oct 31): supplier shipping is split across the group buy, so it's billed after the block ships
  v_name := nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '');

  for l in select (e ->> 'id') as pid, (e ->> 'qty') as q from jsonb_array_elements(p_lines) e loop
    v_q := case when l.q ~ '^\d{1,4}$' then l.q::integer else 0 end;
    if v_q < 1 or v_q > 9999 then raise exception 'Check the quantities.' using errcode = 'P0001'; end if;
    if l.pid !~* '^[0-9a-f-]{36}$' then raise exception 'Check your order lines.' using errcode = 'P0001'; end if;
    select * into pr from public.ppu_partner_prices where id = l.pid::uuid and tier = v.tier and active;
    if not found then raise exception 'An item on your order is no longer on your price sheet. Refresh and try again.' using errcode = 'P0001'; end if;
    v_sub := v_sub + round(pr.price * v_q, 2);
  end loop;

  perform set_config('ppu.partner_order', 'on', true);
  insert into public.orders (id, customer_id, user_id, status, order_status, payment_status, payment_method, subtotal, subtotal_before_discount,
    discount_amount, shipping, tax, total, shipping_name, shipping_email, shipping_phone, shipping_address_line1, shipping_city, shipping_state, shipping_zip,
    customer_email, customer_notes, storefront, created_at, updated_at)
  values (v_id, v_uid, v_uid, 'pending', 'pending', 'pending', btrim(p_payment), v_sub, v_sub, 0, v_ship, 0, v_sub + v_ship,
    coalesce(v_name, v.name, v.email), lower(v.email), coalesce(c.phone, v.phone), c.shipping_address, c.shipping_city, v_st, c.shipping_zip,
    lower(v.email), concat_ws(E'\n', 'Partner order: Tier ' || v.tier || coalesce(' ' || (select t.name from public.ppu_partner_tiers t where t.id = v.tier), '') || coalesce(' · ' || nullif(v.company, ''), ''),
      'Shipping: billed after the block ships (split with the group) · ' || v_st, nullif(btrim(coalesce(p_notes, '')), '')),
    'partner_portal', v_now, v_now) returning order_number into v_no;

  for l in select (e ->> 'id')::uuid as pid, (e ->> 'qty')::integer as q from jsonb_array_elements(p_lines) e loop
    select * into pr from public.ppu_partner_prices where id = l.pid and tier = v.tier and active;
    v_q := l.q;
    insert into public.order_items (order_id, product_id, product_key, product_name, product_strength, product_category, quantity, unit_price, line_total, created_at)
    values (v_id, null, coalesce(pr.product_key, 'PTR-' || pr.sku), pr.name, concat_ws(' · ', nullif(pr.amount, ''), 'kit of 10'), 'Partner', v_q, pr.price, round(pr.price * v_q, 2), v_now);
    v_n := v_n + 1;
  end loop;

  perform set_config('ppu.partner_order', '', true);
  return jsonb_build_object('id', v_id, 'order_number', v_no, 'subtotal', v_sub, 'shipping', v_ship, 'total', v_sub + v_ship, 'lines', v_n,
    'name', coalesce(v_name, v.name, ''), 'email', lower(v.email), 'created_at', v_now);
end $$;
revoke all on function public.ppu_partner_place_order(jsonb, text, text) from public, anon;
grant execute on function public.ppu_partner_place_order(jsonb, text, text) to authenticated;

-- Jeff doesn't count peptide stock, so ppu_stock_floor pins every product at 1000. Merch is the exception:
-- he keeps real counts per size, so merch rows are left alone.
create or replace function public.ppu_stock_floor()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if coalesce(new.category, '') ~* '^\s*merch\s*$' then return new; end if;
  if public.ppu_inventory_untracked() and coalesce(new.current_inventory, 0) < 1000 then new.current_inventory := 1000; end if;
  return new;
end $function$;

-- ============ PROMOTER EARNINGS + MONTHLY MINIMUMS (Jeff, Oct 31) ============
-- Checkout records which code an order used (orders.ppu_code). A promoter earns the discount their code gave (10%),
-- on paid orders. Jeff records payouts as cash or product; balance = earned - paid.
alter table public.orders add column if not exists ppu_code text;
create index if not exists orders_ppu_code_idx on public.orders (lower(ppu_code)) where ppu_code is not null;

create table if not exists public.ppu_partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.ppu_partners(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  kind text not null default 'cash' check (kind in ('cash', 'product')),
  note text,
  paid_at date not null default ((now() at time zone 'America/Los_Angeles')::date),
  created_at timestamptz not null default now()
);
alter table public.ppu_partner_payouts enable row level security;
drop policy if exists "owner manages payouts" on public.ppu_partner_payouts;
create policy "owner manages payouts" on public.ppu_partner_payouts for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
drop policy if exists "partner reads own payouts" on public.ppu_partner_payouts;
create policy "partner reads own payouts" on public.ppu_partner_payouts for select to authenticated using (exists (select 1 from public.ppu_partners p where p.id = partner_id and p.user_id = auth.uid()));
revoke all on public.ppu_partner_payouts from anon;

-- One row per partner: promoter earnings and this/last month's progress toward the minimum.
-- Months are Jeff's calendar months (Pacific). Only paid, not-cancelled orders count. Water doesn't count toward kits.
-- Owner sees everyone; a partner sees only their own row.
create or replace function public.ppu_partner_stats()
returns table (partner_id uuid, tier integer, earned numeric, earned_month numeric, code_orders integer, paid_out numeric, balance numeric,
  kits_month integer, spend_month numeric, kits_last integer, spend_last numeric, minimum_kits integer, minimum_spend numeric, short_month boolean, short_last boolean)
language sql stable security definer set search_path to '' as $$
  with me as (select public.ppu_is_owner() as owner, auth.uid() as uid),
  m as (select date_trunc('month', now() at time zone 'America/Los_Angeles') as cur),
  b as (select m.cur, m.cur - interval '1 month' as prev from m),
  pt as (select p.* from public.ppu_partners p, me where me.owner or p.user_id = me.uid),
  ok as (select o.* from public.orders o where lower(coalesce(o.payment_status, '')) = 'paid'
           and lower(coalesce(o.order_status, o.status, '')) not in ('cancelled', 'canceled', 'rejected', 'refunded')),
  codes as (select pt.id, sum(coalesce(o.discount_code_amount, 0)) as earned, count(o.id)::integer as n,
              sum(coalesce(o.discount_code_amount, 0)) filter (where (o.created_at at time zone 'America/Los_Angeles') >= (select cur from b)) as earned_month
            from pt join ok o on pt.discount_code is not null and lower(o.ppu_code) = lower(pt.discount_code) group by pt.id),
  paid as (select partner_id, sum(amount) as amt from public.ppu_partner_payouts where partner_id in (select id from pt) group by partner_id),
  vol as (select pt.id,
      coalesce(sum(i.quantity) filter (where o.created_at at time zone 'America/Los_Angeles' >= (select cur from b) and i.product_name !~* 'water'), 0)::integer as kits_m,
      coalesce(sum(i.line_total) filter (where o.created_at at time zone 'America/Los_Angeles' >= (select cur from b)), 0) as spend_m,
      coalesce(sum(i.quantity) filter (where o.created_at at time zone 'America/Los_Angeles' >= (select prev from b) and o.created_at at time zone 'America/Los_Angeles' < (select cur from b) and i.product_name !~* 'water'), 0)::integer as kits_l,
      coalesce(sum(i.line_total) filter (where o.created_at at time zone 'America/Los_Angeles' >= (select prev from b) and o.created_at at time zone 'America/Los_Angeles' < (select cur from b)), 0) as spend_l
    from pt join ok o on o.customer_id = pt.user_id and o.storefront = 'partner_portal' join public.order_items i on i.order_id = o.id group by pt.id)
  select pt.id, pt.tier, coalesce(c.earned, 0), coalesce(c.earned_month, 0), coalesce(c.n, 0), coalesce(pd.amt, 0), coalesce(c.earned, 0) - coalesce(pd.amt, 0),
    coalesce(v.kits_m, 0), coalesce(v.spend_m, 0), coalesce(v.kits_l, 0), coalesce(v.spend_l, 0),
    case when pt.tier = 2 then 5 end, case when pt.tier = 3 then 1000::numeric end,
    case pt.tier when 2 then coalesce(v.kits_m, 0) < 5 when 3 then coalesce(v.spend_m, 0) < 1000 else false end,
    case pt.tier when 2 then coalesce(v.kits_l, 0) < 5 when 3 then coalesce(v.spend_l, 0) < 1000 else false end
  from pt left join codes c on c.id = pt.id left join paid pd on pd.partner_id = pt.id left join vol v on v.id = pt.id;
$$;
revoke all on function public.ppu_partner_stats() from public, anon;
grant execute on function public.ppu_partner_stats() to authenticated;

-- Partner orders use storefront 'partner_portal' (applied Oct 31 as ppu_orders_storefront_partner)
alter table public.orders drop constraint if exists orders_storefront_allowed;
alter table public.orders add constraint orders_storefront_allowed check (storefront = any (array['peptides'::text, 'supplies'::text, 'partner_portal'::text])) not valid;
