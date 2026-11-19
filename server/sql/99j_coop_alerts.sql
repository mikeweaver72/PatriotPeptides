-- 99j (Nov 19 2026): tell the Ruby Dell Coop (rdcoop.pepseekr.com) when a partner group order window opens, changes, closes or is cancelled.
-- Order-window facts only (id, dates, title, Jeff's note). No names, emails, phones, totals or partner details ever leave.
-- One outbox row per event; sent with pg_net (async, so saving the group order never waits on the coop).
-- Retries: up to 3 more tries over ~10 minutes (cron every 2 min), then it stops and keeps the error.
-- 400 bad_secret / bad_payload is not retried. Nothing is sent until the two secrets exist in pst_app_secrets:
--   coop_api_key  (the coop's publishable key)     coop_secret  (the shared secret)
create table if not exists public.ppu_coop_outbox (
  id          bigint generated always as identity primary key,
  alert_id    text not null,
  event       text not null check (event in ('open', 'updated', 'closed', 'cancelled')),
  payload     jsonb not null,
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts    integer not null default 0,
  request_id  bigint,
  next_at     timestamptz not null default now(),
  last_status integer,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
alter table public.ppu_coop_outbox enable row level security;
drop policy if exists "owners read coop outbox" on public.ppu_coop_outbox;
create policy "owners read coop outbox" on public.ppu_coop_outbox for select to authenticated using (public.ppu_is_owner());

create or replace function public.ppu_coop_payload(g public.ppu_group_orders, p_event text)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'alert_id', 'ppu-group-' || g.id,
    'event', p_event,
    'cutoff_at', to_char(g.cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ships_by', null,
    'title', left(coalesce(nullif(btrim(g.title), ''), 'Group order') || ' · order date ' || to_char(g.order_date, 'Dy Mon FMDD'), 120),
    'message', nullif(left(btrim(coalesce(g.note, '')), 500), ''),
    'min_order', null,
    'products', '[]'::jsonb,
    'sent_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
$$;

-- send one outbox row now (async). Quietly waits if the secrets aren't set yet.
create or replace function public.ppu_coop_send(p_id bigint)
returns void language plpgsql security definer set search_path to '' as $$
declare k text; s text; r public.ppu_coop_outbox; rid bigint;
begin
  select value into k from public.pst_app_secrets where key = 'coop_api_key';
  select value into s from public.pst_app_secrets where key = 'coop_secret';
  if coalesce(k, '') = '' or coalesce(s, '') = '' then return; end if;
  select * into r from public.ppu_coop_outbox where id = p_id for update skip locked;
  if not found or r.status not in ('pending') then return; end if;
  select net.http_post(
    url := 'https://vddteufnmnkqqndzepbk.supabase.co/rest/v1/rpc/coop_vendor_alert',
    body := jsonb_build_object('p_secret', s, 'p_alert', r.payload || jsonb_build_object('sent_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', k, 'Authorization', 'Bearer ' || k),
    timeout_milliseconds := 10000) into rid;
  update public.ppu_coop_outbox set status = 'sending', request_id = rid, attempts = attempts + 1 where id = p_id;
exception when others then
  update public.ppu_coop_outbox set last_error = left(sqlerrm, 300), next_at = now() + interval '2 minutes' where id = p_id;
end $$;
revoke all on function public.ppu_coop_send(bigint) from public, anon, authenticated;

-- every 2 minutes: read pg_net results, schedule retries, send what's due
create or replace function public.ppu_coop_flush()
returns integer language plpgsql security definer set search_path to '' as $$
declare r record; resp record; n integer := 0;
begin
  for r in select * from public.ppu_coop_outbox where status = 'sending' loop
    select status_code, timed_out, error_msg, left(content::text, 300) as body into resp from net._http_response where id = r.request_id;
    if not found then
      if r.next_at < now() - interval '5 minutes' then -- response never recorded: treat as a miss
        update public.ppu_coop_outbox set status = case when attempts >= 4 then 'failed' else 'pending' end, next_at = now() + make_interval(mins => 2 * attempts), last_error = 'no response' where id = r.id;
      end if;
      continue;
    end if;
    if resp.status_code between 200 and 299 then
      update public.ppu_coop_outbox set status = 'sent', sent_at = now(), last_status = resp.status_code, last_error = null where id = r.id;
    elsif resp.status_code = 400 and resp.body ~* 'bad_secret|bad_payload' then
      update public.ppu_coop_outbox set status = 'failed', last_status = 400, last_error = resp.body where id = r.id; -- don't retry
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

-- the hook: once per window event, never per partner. Errors here never block Jeff's save.
create or replace function public.ppu_group_coop_hook()
returns trigger language plpgsql security definer set search_path to '' as $$
declare ev text; oid bigint;
begin
  if tg_op = 'INSERT' then ev := case when new.status = 'open' then 'open' end;
  elsif new.status is distinct from old.status then ev := case new.status when 'submitted' then 'closed' when 'cancelled' then 'cancelled' when 'open' then 'open' end;
  elsif new.status = 'open' and (new.cutoff_at, new.order_date, coalesce(new.title, ''), coalesce(new.note, '')) is distinct from (old.cutoff_at, old.order_date, coalesce(old.title, ''), coalesce(old.note, '')) then ev := 'updated';
  end if;
  if ev is null then return new; end if;
  begin
    insert into public.ppu_coop_outbox (alert_id, event, payload) values ('ppu-group-' || new.id, ev, public.ppu_coop_payload(new, ev)) returning id into oid;
    perform public.ppu_coop_send(oid);
  exception when others then raise warning 'coop alert skipped: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists ppu_group_coop on public.ppu_group_orders;
create trigger ppu_group_coop after insert or update on public.ppu_group_orders for each row execute function public.ppu_group_coop_hook();

select cron.schedule('ppu-coop-alerts', '*/2 * * * *', $c$ select public.ppu_coop_flush(); $c$);
