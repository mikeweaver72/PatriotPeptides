-- 99l (Nov 19 2026): partner price-sheet items can sell each (auto pens, cartridges) instead of a kit of 10.
-- Applied as migration ppu_partner_price_pack: adds ppu_partner_prices.pack (10 = kit of 10, 1 = each), ppu_pack_label(),
-- and swaps the hard-coded 'kit of 10' in ppu_partner_place_order / ppu_group_submit for ppu_pack_label(pack);
-- ppu_group_mine returns pack; ppu_partner_stats no longer counts "each" items toward the Tier 2 kit minimum.
alter table public.ppu_partner_prices add column if not exists pack integer not null default 10 check (pack between 1 and 100);
create or replace function public.ppu_pack_label(p integer) returns text language sql immutable set search_path to '' as $$
  select case when coalesce(p, 10) <= 1 then 'each' else 'kit of ' || p end $$;
update public.ppu_partner_prices set pack = 1 where name ~* 'auto ?pen|cartridge';
-- (function bodies were patched in place with replace(pg_get_functiondef(...)); see the migration for the exact patterns)

-- ppu_group_linked (migration ppu_group_linked_orders, Nov 19 2026): a partner order placed on its own can ride with a group order.
create table if not exists public.ppu_group_linked (
  group_id  uuid not null references public.ppu_group_orders(id) on delete cascade,
  order_id  uuid not null references public.orders(id) on delete cascade,
  linked_by uuid,
  linked_at timestamptz not null default now(),
  primary key (group_id, order_id)
);
create unique index if not exists ppu_group_linked_one on public.ppu_group_linked (order_id);
alter table public.ppu_group_linked enable row level security;
drop policy if exists "owners manage linked orders" on public.ppu_group_linked;
create policy "owners manage linked orders" on public.ppu_group_linked for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
