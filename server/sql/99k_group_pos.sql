-- 99k (Nov 19 2026): Group buy POs. The combined supplier PO for a placed group order is saved here, apart from the store's
-- incoming_inventory POs, so it never feeds shelf stock, reorder suggestions or cost/margin numbers. Owners only.
create table if not exists public.ppu_group_pos (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.ppu_group_orders(id) on delete set null,
  po_number    text not null unique,
  vendor_id    uuid,
  vendor_name  text,
  lines        jsonb not null default '[]'::jsonb, -- [{sku, name, amount, kits, kit_cost}]
  shipping     numeric(10,2) not null default 0,
  status       text not null default 'ordered' check (status in ('ordered', 'shipped', 'arrived', 'cancelled')),
  carrier      text,
  tracking     text,
  notes        text,
  ordered_at   date not null default current_date,
  shipped_at   timestamptz,
  arrived_at   timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists ppu_group_pos_group on public.ppu_group_pos (group_id) where group_id is not null;
alter table public.ppu_group_pos enable row level security;
drop policy if exists "owners manage group pos" on public.ppu_group_pos;
create policy "owners manage group pos" on public.ppu_group_pos for all to authenticated using (public.ppu_is_owner()) with check (public.ppu_is_owner());
