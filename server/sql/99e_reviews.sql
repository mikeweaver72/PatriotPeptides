-- 99e (Nov 17 2026): order ratings. A customer can rate each shipped/delivered order on 4 things, 1–4 stars,
-- plus an optional comment. Jeff approves before anything shows on the homepage (More → Reviews).
create table if not exists public.ppu_reviews (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references public.orders(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text,
  accuracy      smallint not null check (accuracy between 1 and 4),
  shipping      smallint not null check (shipping between 1 and 4),
  packaging     smallint not null check (packaging between 1 and 4),
  service       smallint not null check (service between 1 and 4),
  comment       text check (comment is null or length(comment) <= 500),
  status        text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid
);
alter table public.ppu_reviews enable row level security;
revoke all on public.ppu_reviews from anon;
grant select, update on public.ppu_reviews to authenticated;
create index if not exists ppu_reviews_status on public.ppu_reviews(status, created_at desc);
drop policy if exists "Customers read their own ratings" on public.ppu_reviews;
create policy "Customers read their own ratings" on public.ppu_reviews for select to authenticated using (user_id = auth.uid());
drop policy if exists "Owners read all ratings" on public.ppu_reviews;
create policy "Owners read all ratings" on public.ppu_reviews for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)));
drop policy if exists "Owners approve or hide ratings" on public.ppu_reviews;
create policy "Owners approve or hide ratings" on public.ppu_reviews for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)));

-- customer: rate (or change a rating on) one of their own shipped/delivered orders. Changing an approved rating sends it back for approval.
create or replace function public.ppu_submit_review(p_order text, p_accuracy int, p_shipping int, p_packaging int, p_service int, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); o public.orders%rowtype; v_name text; v_first text; v_last text; v_id uuid; v_new boolean;
begin
  if v_uid is null then raise exception 'Sign in to rate your order.'; end if;
  select * into o from public.orders where (order_number = p_order or id::text = p_order) and user_id = v_uid limit 1;
  if not found then raise exception 'We couldn''t find that order on your account.'; end if;
  if lower(coalesce(o.status, '')) not in ('shipped','delivered','complete','completed') then raise exception 'You can rate this order once it ships.'; end if;
  if least(p_accuracy, p_shipping, p_packaging, p_service) < 1 or greatest(p_accuracy, p_shipping, p_packaging, p_service) > 4 then raise exception 'Pick 1 to 4 stars for each one.'; end if;
  v_first := split_part(trim(coalesce(o.shipping_name, '')), ' ', 1);
  v_last := nullif(regexp_replace(trim(coalesce(o.shipping_name, '')), '^\S+\s*', ''), '');
  v_name := nullif(trim(initcap(v_first) || coalesce(' ' || upper(left(regexp_replace(v_last, '^.*\s', ''), 1)) || '.', '')), '');
  select id into v_id from public.ppu_reviews where order_id = o.id; v_new := v_id is null;
  insert into public.ppu_reviews (order_id, user_id, display_name, accuracy, shipping, packaging, service, comment)
  values (o.id, v_uid, coalesce(v_name, 'Verified buyer'), p_accuracy, p_shipping, p_packaging, p_service, nullif(left(trim(coalesce(p_comment, '')), 500), ''))
  on conflict (order_id) do update set accuracy = excluded.accuracy, shipping = excluded.shipping, packaging = excluded.packaging, service = excluded.service,
    comment = excluded.comment, status = 'pending', updated_at = now(), reviewed_at = null, reviewed_by = null
  returning id into v_id;
  insert into public.pst_inbox (user_id, role, kind, title, body, url)
  select a.user_id, 'owner', 'review', left((case when v_new then 'New rating: ' else 'Rating changed: ' end) || coalesce(o.order_number, 'order') || ' · ' ||
    round((p_accuracy + p_shipping + p_packaging + p_service) / 4.0, 1) || ' of 4', 160),
    left(coalesce(nullif(left(trim(coalesce(p_comment, '')), 140), ''), 'No comment. Approve it to show it on your homepage.'), 400), 'owner.html#reviews'
  from public.admin_users a where a.user_id is not null and coalesce(a.is_active, true);
  return jsonb_build_object('id', v_id, 'status', 'pending', 'new', v_new);
end $$;
revoke all on function public.ppu_submit_review(text, int, int, int, int, text) from public, anon;
grant execute on function public.ppu_submit_review(text, int, int, int, int, text) to authenticated;

-- homepage: approved ratings only (no ids, no order numbers, first name + last initial)
create or replace function public.ppu_public_reviews(p_limit int default 6)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'count', count(*),
    'accuracy', round(avg(accuracy), 2), 'shipping', round(avg(shipping), 2), 'packaging', round(avg(packaging), 2), 'service', round(avg(service), 2),
    'overall', round(avg((accuracy + shipping + packaging + service) / 4.0), 2),
    'recent', coalesce((select jsonb_agg(x) from (
        select r.display_name as name, r.accuracy, r.shipping, r.packaging, r.service, r.comment, r.created_at::date as date
        from public.ppu_reviews r where r.status = 'approved' and r.comment is not null order by r.reviewed_at desc nulls last, r.created_at desc limit greatest(1, least(p_limit, 12))) x), '[]'::jsonb))
  from public.ppu_reviews where status = 'approved';
$$;
grant execute on function public.ppu_public_reviews(int) to anon, authenticated;
