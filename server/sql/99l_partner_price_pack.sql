-- 99l (Nov 19 2026): partner price-sheet items can sell each (auto pens, cartridges) instead of a kit of 10.
-- Applied as migration ppu_partner_price_pack: adds ppu_partner_prices.pack (10 = kit of 10, 1 = each), ppu_pack_label(),
-- and swaps the hard-coded 'kit of 10' in ppu_partner_place_order / ppu_group_submit for ppu_pack_label(pack);
-- ppu_group_mine returns pack; ppu_partner_stats no longer counts "each" items toward the Tier 2 kit minimum.
alter table public.ppu_partner_prices add column if not exists pack integer not null default 10 check (pack between 1 and 100);
create or replace function public.ppu_pack_label(p integer) returns text language sql immutable set search_path to '' as $$
  select case when coalesce(p, 10) <= 1 then 'each' else 'kit of ' || p end $$;
update public.ppu_partner_prices set pack = 1 where name ~* 'auto ?pen|cartridge';
-- (function bodies were patched in place with replace(pg_get_functiondef(...)); see the migration for the exact patterns)
