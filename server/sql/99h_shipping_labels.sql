-- 99h (Nov 2026): Express shipping at checkout + buy and print shipping labels from the owner app (Shippo).
-- Safe to re-run. Apply after 99g.
--
-- 1. orders.shipping_service: "standard" or "express", set at checkout (Express is a flat $45, see CFG.expressRate).
-- 2. ppu_ship_settings: one row with the ship-from (return) address and the package presets the owner picks from.
-- 3. ppu_shipping_labels: every label bought through the ship-label edge function (rate, cost, tracking, PDF link, void status).
--
-- Labels are only ever bought by the ship-label edge function (service role). Owners can read them; nobody else can.

alter table public.orders add column if not exists shipping_service text not null default 'standard';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_shipping_service_check') then
    alter table public.orders add constraint orders_shipping_service_check check (shipping_service in ('standard','express'));
  end if;
end $$;
-- Orders placed before this column existed: mark Express from the checkout note, if any.
update public.orders set shipping_service = 'express'
 where shipping_service = 'standard' and customer_notes ilike 'Delivery method: Shipping · EXPRESS%';

create table if not exists public.ppu_ship_settings (
  id            smallint primary key default 1 check (id = 1),
  from_name     text,
  from_company  text default 'Patriot Peptides USA',
  from_street1  text,
  from_street2  text,
  from_city     text,
  from_state    text,
  from_zip      text,
  from_phone    text,
  from_email    text,
  -- package presets: [{ "name": "Small mailer", "length": 9, "width": 6, "height": 2, "weight_oz": 6 }, ...] (inches, ounces)
  packages      jsonb not null default '[
    {"name":"Padded mailer · 1–3 vials","length":9,"width":6,"height":2,"weight_oz":6},
    {"name":"Small box · 4–10 vials","length":8,"width":6,"height":4,"weight_oz":12},
    {"name":"10-vial kit box","length":10,"width":8,"height":4,"weight_oz":20}
  ]'::jsonb,
  label_format  text not null default 'PDF_4x6' check (label_format in ('PDF_4x6','PDF','PNG','ZPLII')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
insert into public.ppu_ship_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.ppu_shipping_labels (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  shippo_shipment  text,
  shippo_rate      text,
  shippo_txn       text unique,
  carrier          text not null,
  service          text not null,
  service_token    text,
  amount           numeric(10,2) not null default 0,
  currency         text not null default 'USD',
  tracking_number  text,
  tracking_url     text,
  label_url        text,
  package          jsonb,
  test_mode        boolean not null default false,
  status           text not null default 'purchased' check (status in ('purchased','void_pending','voided','void_rejected')),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  voided_at        timestamptz
);
create index if not exists ppu_shipping_labels_order on public.ppu_shipping_labels(order_id, created_at desc);

alter table public.ppu_ship_settings enable row level security;
alter table public.ppu_shipping_labels enable row level security;
revoke all on public.ppu_ship_settings from anon;
revoke all on public.ppu_shipping_labels from anon;
grant select, update on public.ppu_ship_settings to authenticated;
grant select on public.ppu_shipping_labels to authenticated;

drop policy if exists "Owners read ship settings" on public.ppu_ship_settings;
create policy "Owners read ship settings" on public.ppu_ship_settings for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)));
drop policy if exists "Owners edit ship settings" on public.ppu_ship_settings;
create policy "Owners edit ship settings" on public.ppu_ship_settings for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)));
drop policy if exists "Owners read labels" on public.ppu_shipping_labels;
create policy "Owners read labels" on public.ppu_shipping_labels for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)));

-- Nov 19 2026 (Mike): ship-from address and the usual box. Phone still to be added in the label settings (carriers require one).
update public.ppu_ship_settings set from_name = 'Patriot Peptides USA', from_company = 'Patriot Peptides USA',
  from_street1 = coalesce(from_street1, '13215 SE Mill Plain Blvd'), from_street2 = coalesce(from_street2, 'Ste C8 #1032'),
  from_city = coalesce(from_city, 'Vancouver'), from_state = coalesce(from_state, 'WA'), from_zip = coalesce(from_zip, '98684'),
  packages = case when packages::text like '%Usual box%' then packages else
    '[{"name":"Usual box · 7×7×3","length":7,"width":7,"height":3,"weight_oz":8}]'::jsonb || packages end,
  updated_at = now()
 where id = 1;
