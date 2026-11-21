-- 99n (Nov 21 2026): tell Jeff (owner bell + push) when a partner joins, changes or drops out of a group order.
-- Called at the end of ppu_group_save (vendor portal) and ppu_coop_order 'save' (Ruby Dell Coop, "via Ruby Dell Coop").
-- Bell: pst_inbox (role owner, kind group_save). Push: ppu-owner-push edge function, honouring pst_notify_prefs.group_saves.
-- Debounce: the same partner saving the same group again within 2 minutes updates the unread bell entry, no new push.
-- Never blocks the save: any error is swallowed with a warning.
alter table public.pst_notify_prefs add column if not exists group_saves boolean not null default true;

create or replace function public.ppu_group_notify_owner(p_group uuid, p_partner uuid, p_via text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare g public.ppu_group_orders; pt public.ppu_partners; v_who text; v_list text; v_total numeric; v_pay text; v_title text; v_body text;
  v_url text; v_tag text; v_new boolean; v_prev bigint; hk text;
begin
  select * into g from public.ppu_group_orders where id = p_group;
  select * into pt from public.ppu_partners where id = p_partner;
  if g.id is null or pt.id is null then return; end if;
  v_who := coalesce(nullif(btrim(pt.name), ''), pt.email, 'A partner') || coalesce(' (' || nullif(btrim(pt.company), '') || ')', '');
  select string_agg(gl.qty || '× ' || btrim(pr.name || ' ' || coalesce(pr.amount, '')), ', ' order by pr.sort, pr.name), sum(pr.price * gl.qty)
    into v_list, v_total
    from public.ppu_group_lines gl join public.ppu_partner_prices pr on pr.id = gl.price_id
   where gl.group_id = g.id and gl.partner_id = pt.id;
  select payment_method into v_pay from public.ppu_group_members where group_id = g.id and partner_id = pt.id;
  v_url := 'owner.html#group=' || g.id; v_tag := 'group-' || left(g.id::text, 8) || '-' || left(pt.id::text, 8);
  if v_list is null then
    delete from public.pst_notify_log where kind = 'group_join' and ref = g.id || ':' || pt.id; -- rejoining later reads "joined" again
    v_title := 'Group order · ' || v_who || ' dropped out';
    v_body := 'No longer in the ' || to_char(g.order_date, 'Dy Mon FMDD') || ' order' || coalesce(' · via ' || p_via, '');
  else
    begin insert into public.pst_notify_log (kind, ref, user_id) values ('group_join', g.id || ':' || pt.id, null); v_new := true;
    exception when unique_violation then v_new := false; end;
    v_title := 'Group order · ' || v_who || case when v_new then ' joined' else ' updated' end;
    v_body := v_list || ' · $' || to_char(coalesce(v_total, 0), 'FM999,990.00') || coalesce(' · ' || v_pay, '') || coalesce(' · via ' || p_via, '');
  end if;
  -- same partner + group within 2 minutes and still unread: update that bell entry, don't ping again
  select id into v_prev from public.pst_inbox
   where role = 'owner' and kind = 'group_save' and url = v_url and title like 'Group order · ' || v_who || ' %'
     and read_at is null and created_at > now() - interval '2 minutes'
   order by created_at desc limit 1;
  if v_prev is not null then
    update public.pst_inbox set title = left(case when v_list is not null and title like '% joined' then replace(v_title, ' updated', ' joined') else v_title end, 160),
      body = left(v_body, 400), created_at = now() where id = v_prev;
    return;
  end if;
  insert into public.pst_inbox (user_id, role, kind, title, body, url) values (null, 'owner', 'group_save', left(v_title, 160), left(v_body, 400), v_url);
  select value into hk from public.pst_app_secrets where key = 'hook_key';
  perform net.http_post(url := 'https://aoovvhbjugmqevwvekku.supabase.co/functions/v1/ppu-owner-push',
    body := jsonb_build_object('field', 'group_saves', 'title', v_title, 'body', v_body, 'url', v_url, 'tag', v_tag),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', coalesce(hk, '')), timeout_milliseconds := 8000);
exception when others then raise warning 'group notify skipped: %', sqlerrm;
end $$;
revoke all on function public.ppu_group_notify_owner(uuid, uuid, text) from public, anon, authenticated;

-- hook both save paths (patched in place)
do $m$ declare d text; n text;
begin
  d := pg_get_functiondef('public.ppu_group_save(uuid,jsonb,text,text)'::regprocedure);
  n := replace(d, $x$  return jsonb_build_object('lines', n, 'cutoff_at'$x$, $x$  perform public.ppu_group_notify_owner(g.id, me.id, null);
  return jsonb_build_object('lines', n, 'cutoff_at'$x$);
  if n = d then raise exception 'group_save: pattern not found'; end if; execute n;
  d := pg_get_functiondef('public.ppu_coop_order(text,text,text,jsonb,text,text)'::regprocedure);
  n := replace(d, $x$  return jsonb_build_object('ok', true, 'lines', v_n$x$, $x$  perform public.ppu_group_notify_owner(g.id, me.id, 'Ruby Dell Coop');
  return jsonb_build_object('ok', true, 'lines', v_n$x$);
  if n = d then raise exception 'coop_order: pattern not found'; end if; execute n;
end $m$;
