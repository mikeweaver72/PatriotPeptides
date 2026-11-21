-- 99m_coop_order.sql (handoff named it 99k, which was taken by 99k_group_pos.sql) — Ruby Dell Coop writes Mike's partner lines into an open group order.
-- Applied Nov 21 2026 as migration ppu_coop_order. Patriot change: size matching treats a blank/null price-sheet size as '' (pens have no size).
create or replace function public.ppu_coop_order(
  p_secret text, p_action text, p_alert_id text,
  p_lines jsonb default '[]'::jsonb, p_payment text default null, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_hash text; v_pid uuid; me public.ppu_partners; g public.ppu_group_orders; v_gid uuid;
  v_pay text; v_n int := 0; v_total numeric := 0; v_unmatched jsonb := '[]'::jsonb; v_lines jsonb := '[]'::jsonb;
  l record; v_price public.ppu_partner_prices;
begin
  select value into v_hash from public.pst_app_secrets where key = 'coop_inbound_secret_hash';
  if v_hash is null or p_secret is null or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_hash then
    raise exception 'bad_secret' using errcode = 'P0001';
  end if;
  select nullif(value, '')::uuid into v_pid from public.pst_app_secrets where key = 'coop_partner_id';
  select * into me from public.ppu_partners where id = v_pid and status = 'active';
  if me.id is null then raise exception 'not_configured' using errcode = 'P0001'; end if;

  if p_alert_id is null or p_alert_id !~* '^ppu-group-[0-9a-f-]{36}$' then raise exception 'bad_window' using errcode = 'P0001'; end if;
  v_gid := substring(p_alert_id from 11)::uuid;
  select * into g from public.ppu_group_orders where id = v_gid;
  if not found then raise exception 'bad_window' using errcode = 'P0001'; end if;

  if p_action not in ('preview', 'save') then raise exception 'bad_lines' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 200 then
    raise exception 'bad_lines' using errcode = 'P0001';
  end if;

  -- match coop lines (name + size) to Mike's tier price rows
  for l in
    select e ->> 'name' as name, e ->> 'size' as size,
           case when (e ->> 'kits') ~ '^\d{1,4}$' then (e ->> 'kits')::int else -1 end as kits
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
  loop
    if l.kits < 0 then raise exception 'bad_lines' using errcode = 'P0001'; end if;
    select * into v_price from public.ppu_partner_prices pr
     where pr.tier = me.tier and pr.active
       and lower(btrim(pr.name)) = lower(btrim(coalesce(l.name, ''))) and lower(btrim(coalesce(pr.amount, ''))) = lower(btrim(coalesce(l.size, '')))
     order by pr.sort limit 1;
    if v_price.id is null then
      v_unmatched := v_unmatched || jsonb_build_object('name', l.name, 'size', l.size);
    else
      v_lines := v_lines || jsonb_build_object('price_id', v_price.id, 'name', v_price.name, 'size', v_price.amount,
                   'pack', coalesce(v_price.pack, 1), 'price', v_price.price, 'kits', l.kits);
    end if;
    v_price := null;
  end loop;

  if p_action = 'preview' then
    return jsonb_build_object(
      'group', jsonb_build_object('title', g.title, 'order_date', g.order_date, 'cutoff_at', g.cutoff_at, 'status', g.status,
                 'editable', g.status = 'open' and now() < g.cutoff_at),
      'lines', v_lines, 'unmatched', v_unmatched,
      'saved', coalesce((select jsonb_agg(jsonb_build_object('name', pr.name, 'size', pr.amount, 'pack', coalesce(pr.pack, 1),
                   'price', pr.price, 'kits', gl.qty) order by pr.sort)
                   from public.ppu_group_lines gl join public.ppu_partner_prices pr on pr.id = gl.price_id
                  where gl.group_id = g.id and gl.partner_id = me.id), '[]'::jsonb),
      'payment', coalesce((select payment_method from public.ppu_group_members where group_id = g.id and partner_id = me.id),
                          (select payment_method from public.ppu_group_members where partner_id = me.id order by saved_at desc limit 1)),
      'notes', (select notes from public.ppu_group_members where group_id = g.id and partner_id = me.id));
  end if;

  -- save
  if g.status <> 'open' or now() >= g.cutoff_at then raise exception 'window_closed' using errcode = 'P0001'; end if;
  v_pay := coalesce(nullif(btrim(coalesce(p_payment, '')), ''),
                    (select payment_method from public.ppu_group_members where group_id = g.id and partner_id = me.id),
                    (select payment_method from public.ppu_group_members where partner_id = me.id order by saved_at desc limit 1));

  delete from public.ppu_group_lines where group_id = g.id and partner_id = me.id;
  insert into public.ppu_group_lines (group_id, partner_id, price_id, qty)
    select g.id, me.id, (x ->> 'price_id')::uuid, sum((x ->> 'kits')::int)
      from jsonb_array_elements(v_lines) x where (x ->> 'kits')::int > 0
     group by (x ->> 'price_id')::uuid;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    delete from public.ppu_group_members where group_id = g.id and partner_id = me.id;
  else
    if v_pay is null then raise exception 'need_payment' using errcode = 'P0001'; end if;
    insert into public.ppu_group_members (group_id, partner_id, payment_method, notes, saved_at)
      values (g.id, me.id, left(v_pay, 60), nullif(left(btrim(coalesce(p_notes, '')), 500), ''), now())
      on conflict (group_id, partner_id) do update
        set payment_method = excluded.payment_method,
            notes = coalesce(excluded.notes, public.ppu_group_members.notes),
            saved_at = now();
  end if;

  select coalesce(sum((x ->> 'kits')::int * (x ->> 'price')::numeric), 0) into v_total
    from jsonb_array_elements(v_lines) x where (x ->> 'kits')::int > 0;

  return jsonb_build_object('ok', true, 'lines', v_n, 'total', v_total, 'unmatched', v_unmatched,
                            'cutoff_at', g.cutoff_at, 'order_date', g.order_date, 'payment', v_pay);
end $$;

revoke all on function public.ppu_coop_order(text, text, text, jsonb, text, text) from public;
grant execute on function public.ppu_coop_order(text, text, text, jsonb, text, text) to anon, authenticated;

insert into public.pst_app_secrets (key, value) values
  ('coop_inbound_secret_hash', '670d9c2e107a39ae968de3537e2649b3bd3ced95256619a486563e35843face2'),
  ('coop_partner_id', 'b32e7ab7-6a09-4a1e-bbbb-2467fb7374f9')
on conflict (key) do update set value = excluded.value;

-- Part 2 (Nov 21 2026): catch up on order windows the trigger never saw (opened before it existed, or while it was off).
-- Each ppu-coop-alerts run first queues an 'open' for any open, not-yet-cut-off group order that has never been queued.
create or replace function public.ppu_coop_flush()
returns integer language plpgsql security definer set search_path to '' as $$
declare r record; resp record; n integer := 0;
begin
  insert into public.ppu_coop_outbox (alert_id, event, payload, status, attempts, next_at)
  select 'ppu-group-' || g.id, 'open', public.ppu_coop_payload(g, 'open'), 'pending', 0, now()
    from public.ppu_group_orders g
   where g.status = 'open' and g.cutoff_at > now()
     and not exists (select 1 from public.ppu_coop_outbox o where o.alert_id = 'ppu-group-' || g.id);
  for r in select * from public.ppu_coop_outbox where status = 'sending' loop
    select status_code, timed_out, error_msg, left(content::text, 300) as body into resp from net._http_response where id = r.request_id;
    if not found then
      if r.next_at < now() - interval '5 minutes' then
        update public.ppu_coop_outbox set status = case when attempts >= 4 then 'failed' else 'pending' end, next_at = now() + make_interval(mins => 2 * attempts), last_error = 'no response' where id = r.id;
      end if;
      continue;
    end if;
    if resp.status_code between 200 and 299 then
      update public.ppu_coop_outbox set status = 'sent', sent_at = now(), last_status = resp.status_code, last_error = null where id = r.id;
    elsif resp.status_code = 400 and resp.body ~* 'bad_secret|bad_payload' then
      update public.ppu_coop_outbox set status = 'failed', last_status = 400, last_error = resp.body where id = r.id;
    else
      update public.ppu_coop_outbox set status = case when attempts >= 4 then 'failed' else 'pending' end, next_at = now() + make_interval(mins => 2 * attempts),
        last_status = resp.status_code, last_error = coalesce(resp.error_msg, resp.body, case when resp.timed_out then 'timed out' end) where id = r.id;
    end if;
  end loop;
  for r in select id from public.ppu_coop_outbox where status = 'pending' and next_at <= now() order by id limit 20 loop
    perform public.ppu_coop_send(r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ppu_coop_flush() from public, anon, authenticated;
