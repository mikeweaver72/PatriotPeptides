-- 99i (Nov 19 2026, Mike/Jeff): group orders for partners (Runners + Vendors).
-- Jeff sets an order date and a cutoff. Partners add kits from their own tier's price sheet until the cutoff (nothing is paid yet).
-- Jeff sees the combined totals, then submits: each partner's part becomes a normal partner order (awaiting payment).
-- Pricing privacy: a partner can only ever read their own lines, priced from their own tier. Nobody but owners sees other partners
-- or combined totals. All partner writes go through the security-definer functions below. Safe to re-run.

create table if not exists public.ppu_group_orders (
  id                 uuid primary key default gen_random_uuid(),
  title              text,
  order_date         date not null,
  cutoff_at          timestamptz not null,
  note               text,
  status             text not null default 'open' check (status in ('open','submitted','cancelled')),
  announced_at       timestamptz,
  reminded_at        timestamptz,
  submitted_at       timestamptz,
  submitted_by       uuid,
  supplier_vendor_id uuid,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create table if not exists public.ppu_group_members (
  group_id        uuid not null references public.ppu_group_orders(id) on delete cascade,
  partner_id      uuid not null references public.ppu_partners(id) on delete cascade,
  payment_method  text,
  notes           text,
  saved_at        timestamptz,
  order_id        uuid references public.orders(id) on delete set null,
  primary key (group_id, partner_id)
);
create table if not exists public.ppu_group_lines (
  group_id    uuid not null references public.ppu_group_orders(id) on delete cascade,
  partner_id  uuid not null references public.ppu_partners(id) on delete cascade,
  price_id    uuid not null references public.ppu_partner_prices(id),
  qty         integer not null check (qty between 1 and 9999),
  updated_at  timestamptz not null default now(),
  primary key (group_id, partner_id, price_id)
);
create index if not exists ppu_group_orders_status on public.ppu_group_orders(status, order_date desc);

alter table public.ppu_group_orders enable row level security;
alter table public.ppu_group_members enable row level security;
alter table public.ppu_group_lines enable row level security;
revoke all on public.ppu_group_orders, public.ppu_group_members, public.ppu_group_lines from anon;
grant select, insert, update, delete on public.ppu_group_orders, public.ppu_group_members, public.ppu_group_lines to authenticated;

drop policy if exists "owners manage group orders" on public.ppu_group_orders;
create policy "owners manage group orders" on public.ppu_group_orders for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
drop policy if exists "owners manage group members" on public.ppu_group_members;
create policy "owners manage group members" on public.ppu_group_members for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
drop policy if exists "owners manage group lines" on public.ppu_group_lines;
create policy "owners manage group lines" on public.ppu_group_lines for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
-- partners read nothing directly: they use ppu_group_mine() / ppu_group_save(), which only ever return their own part.

-- the signed-in partner (active, on a tier with a price sheet), or null
create or replace function public.ppu_group_me()
returns public.ppu_partners language sql stable security definer set search_path to '' as $$
  select p.* from public.ppu_partners p join public.ppu_partner_tiers t on t.id = p.tier
   where p.user_id = auth.uid() and p.status = 'active' and t.has_prices limit 1;
$$;
revoke all on function public.ppu_group_me() from public, anon;

-- open group orders (and the last 3 placed ones) with this partner's own lines, priced from their own tier
create or replace function public.ppu_group_mine()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare me public.ppu_partners;
begin
  me := public.ppu_group_me();
  if me.id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(g order by g->>'order_date') from (
    select jsonb_build_object('id', o.id, 'title', o.title, 'order_date', o.order_date, 'cutoff_at', o.cutoff_at, 'note', o.note,
      'status', o.status, 'open', o.status = 'open' and now() < o.cutoff_at,
      'saved_at', m.saved_at, 'payment_method', m.payment_method, 'notes', m.notes, 'order_id', m.order_id,
      'order_number', (select x.order_number from public.orders x where x.id = m.order_id),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('price_id', l.price_id, 'qty', l.qty, 'name', pr.name, 'amount', pr.amount, 'price', pr.price) order by pr.sort, pr.name)
        from public.ppu_group_lines l join public.ppu_partner_prices pr on pr.id = l.price_id and pr.tier = me.tier
        where l.group_id = o.id and l.partner_id = me.id), '[]'::jsonb)) g
    from public.ppu_group_orders o left join public.ppu_group_members m on m.group_id = o.id and m.partner_id = me.id
    where (o.status = 'open' and now() < o.cutoff_at + interval '7 days')
       or (o.status = 'submitted' and m.order_id is not null and o.submitted_at > now() - interval '30 days')
  ) s), '[]'::jsonb);
end $$;
revoke all on function public.ppu_group_mine() from public, anon;
grant execute on function public.ppu_group_mine() to authenticated;

-- save (replace) this partner's part of an open group order. p_lines = [{id: price_id, qty}]; an empty list takes them out.
create or replace function public.ppu_group_save(p_group uuid, p_lines jsonb, p_payment text, p_notes text default '')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me public.ppu_partners; g public.ppu_group_orders; l record; v_q integer; n integer := 0;
begin
  me := public.ppu_group_me();
  if me.id is null then raise exception 'This account isn''t an active partner with a price sheet.' using errcode = 'P0001'; end if;
  select * into g from public.ppu_group_orders where id = p_group;
  if not found or g.status <> 'open' then raise exception 'This group order isn''t open.' using errcode = 'P0001'; end if;
  if now() >= g.cutoff_at then raise exception 'Changes for this group order closed %.', to_char(g.cutoff_at at time zone 'America/Los_Angeles', 'Mon DD "at" FMHH12:MI AM "Pacific"') using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 200 then raise exception 'Check your lines.' using errcode = 'P0001'; end if;
  for l in select (e ->> 'id') as pid, (e ->> 'qty') as q from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e loop
    v_q := case when l.q ~ '^\d{1,4}$' then l.q::integer else -1 end;
    if v_q < 0 then raise exception 'Check the quantities.' using errcode = 'P0001'; end if;
    if l.pid !~* '^[0-9a-f-]{36}$' or not exists (select 1 from public.ppu_partner_prices pr where pr.id = l.pid::uuid and pr.tier = me.tier and pr.active)
      then raise exception 'An item isn''t on your price sheet anymore. Refresh and try again.' using errcode = 'P0001'; end if;
  end loop;
  delete from public.ppu_group_lines where group_id = g.id and partner_id = me.id;
  insert into public.ppu_group_lines (group_id, partner_id, price_id, qty)
    select g.id, me.id, (e ->> 'id')::uuid, sum((e ->> 'qty')::integer) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
     where (e ->> 'qty')::integer > 0 group by (e ->> 'id')::uuid;
  get diagnostics n = row_count;
  if n = 0 then
    delete from public.ppu_group_members where group_id = g.id and partner_id = me.id;
  else
    if p_payment is null or btrim(p_payment) = '' then raise exception 'Choose how you''ll pay when the order is placed.' using errcode = 'P0001'; end if;
    insert into public.ppu_group_members (group_id, partner_id, payment_method, notes, saved_at)
      values (g.id, me.id, left(btrim(p_payment), 60), nullif(left(btrim(coalesce(p_notes, '')), 500), ''), now())
      on conflict (group_id, partner_id) do update set payment_method = excluded.payment_method, notes = excluded.notes, saved_at = now();
  end if;
  return jsonb_build_object('lines', n, 'cutoff_at', g.cutoff_at, 'order_date', g.order_date);
end $$;
revoke all on function public.ppu_group_save(uuid, jsonb, text, text) from public, anon;
grant execute on function public.ppu_group_save(uuid, jsonb, text, text) to authenticated;

-- owner: place the group order. Each partner's part becomes a normal partner order (same shape as ppu_partner_place_order:
-- storefront partner_portal, shipping billed later, awaiting payment). Prices are taken from the price sheet now, on the server.
create or replace function public.ppu_group_submit(p_group uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare g public.ppu_group_orders; m record; c public.customer_profiles%rowtype; l record;
  v_id uuid; v_no text; v_sub numeric; v_now timestamptz := now(); v_name text; v_st text; out jsonb := '[]'::jsonb; t_name text;
begin
  if not public.ppu_is_owner() then raise exception 'Owners only.' using errcode = 'P0001'; end if;
  select * into g from public.ppu_group_orders where id = p_group for update;
  if not found or g.status <> 'open' then raise exception 'This group order was already placed or cancelled.' using errcode = 'P0001'; end if;
  perform set_config('ppu.partner_order', 'on', true);
  for m in select gm.*, p.user_id, p.name pname, p.email pemail, p.phone pphone, p.company, p.tier
             from public.ppu_group_members gm join public.ppu_partners p on p.id = gm.partner_id
            where gm.group_id = g.id and gm.order_id is null and exists (select 1 from public.ppu_group_lines x where x.group_id = g.id and x.partner_id = gm.partner_id) loop
    select coalesce(sum(round(pr.price * gl.qty, 2)), 0) into v_sub from public.ppu_group_lines gl join public.ppu_partner_prices pr on pr.id = gl.price_id and pr.tier = m.tier
     where gl.group_id = g.id and gl.partner_id = m.partner_id;
    if v_sub <= 0 then continue; end if;
    c := null; if m.user_id is not null then select * into c from public.customer_profiles where user_id = m.user_id; end if;
    v_st := upper(btrim(coalesce(c.shipping_state, '')));
    v_name := nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '');
    select t.name into t_name from public.ppu_partner_tiers t where t.id = m.tier;
    v_id := gen_random_uuid();
    insert into public.orders (id, customer_id, user_id, status, order_status, payment_status, payment_method, subtotal, subtotal_before_discount,
      discount_amount, shipping, tax, total, shipping_name, shipping_email, shipping_phone, shipping_address_line1, shipping_city, shipping_state, shipping_zip,
      customer_email, customer_notes, storefront, created_at, updated_at)
    values (v_id, m.user_id, m.user_id, 'pending', 'pending', 'pending', coalesce(m.payment_method, 'Venmo'), v_sub, v_sub, 0, 0, 0, v_sub,
      coalesce(v_name, m.pname, m.pemail), lower(m.pemail), coalesce(c.phone, m.pphone), c.shipping_address, c.shipping_city, nullif(v_st, ''), c.shipping_zip,
      lower(m.pemail), concat_ws(E'\n', 'Partner order: Tier ' || m.tier || coalesce(' ' || t_name, '') || coalesce(' · ' || nullif(m.company, ''), ''),
        'Group order: ' || coalesce(nullif(g.title, '') || ' · ', '') || to_char(g.order_date, 'Mon DD, YYYY'),
        'Shipping: billed after the block ships (split with the group)' || coalesce(' · ' || nullif(v_st, ''), ''),
        case when coalesce(btrim(c.shipping_address), '') = '' then 'No shipping address on file yet.' end, m.notes),
      'partner_portal', v_now, v_now) returning order_number into v_no;
    for l in select gl.qty, pr.* from public.ppu_group_lines gl join public.ppu_partner_prices pr on pr.id = gl.price_id and pr.tier = m.tier
              where gl.group_id = g.id and gl.partner_id = m.partner_id order by pr.sort, pr.name loop
      insert into public.order_items (order_id, product_id, product_key, product_name, product_strength, product_category, quantity, unit_price, line_total, created_at)
      values (v_id, null, coalesce(l.product_key, 'PTR-' || l.sku), l.name, concat_ws(' · ', nullif(l.amount, ''), 'kit of 10'), 'Partner', l.qty, l.price, round(l.price * l.qty, 2), v_now);
    end loop;
    update public.ppu_group_members set order_id = v_id where group_id = g.id and partner_id = m.partner_id;
    out := out || jsonb_build_object('partner_id', m.partner_id, 'name', coalesce(v_name, m.pname, m.pemail), 'email', lower(m.pemail), 'order_id', v_id, 'order_number', v_no, 'total', v_sub);
  end loop;
  perform set_config('ppu.partner_order', '', true);
  update public.ppu_group_orders set status = 'submitted', submitted_at = v_now, submitted_by = auth.uid(), updated_at = v_now where id = g.id;
  return out;
end $$;
revoke all on function public.ppu_group_submit(uuid) from public, anon;
grant execute on function public.ppu_group_submit(uuid) to authenticated;
