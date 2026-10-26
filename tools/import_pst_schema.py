#!/usr/bin/env python3
"""Copy the PST schema dumps (from /home/claude/ppu/db/pst-schema) into server/sql, replacing Jimmie's
project refs with the __PPU_SUPABASE_REF__ placeholder. Re-runnable."""
import pathlib, shutil, re

PRIVATE_FNS = """-- private-schema helpers referenced by bulk_requests triggers (PST keeps these outside public; rebuilt here from the audit table shape)
create schema if not exists private;
create or replace function private.prepare_bulk_request_update() returns trigger language plpgsql security definer set search_path to '' as $f$
begin
  new.updated_at := now();
  new.last_touched_by := coalesce(auth.uid(), new.last_touched_by);
  new.last_touched_email := coalesce(auth.jwt() ->> 'email', new.last_touched_email);
  if new.status = 'reviewed' and old.status is distinct from 'reviewed' then new.reviewed_at := coalesce(new.reviewed_at, now()); end if;
  if new.status = 'quoted' and old.status is distinct from 'quoted' then new.quoted_at := coalesce(new.quoted_at, now()); end if;
  if new.status = 'ordered' and old.status is distinct from 'ordered' then new.ordered_at := coalesce(new.ordered_at, now()); end if;
  return new;
end $f$;
create or replace function private.audit_bulk_request_change() returns trigger language plpgsql security definer set search_path to '' as $f$
declare ch jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb) into ch
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value and n.key not in ('updated_at');
  end if;
  insert into public.bulk_request_audit (request_number, action, old_status, new_status, actor_id, actor_email, changes)
  values (new.request_number, lower(tg_op), case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(), auth.jwt() ->> 'email', ch);
  return new;
end $f$;
"""

def harden(name, s):
    """Make the dump safe to apply as one atomic batch on a fresh project, in the order 00,02,07,01,03,04,05,06,08."""
    if name == "01_migrations.sql":
        # 07 (all constraints) runs before 01 so its inserts with ON CONFLICT find their keys; 01's own add-constraint lines must then tolerate duplicates
        s = re.sub(r"^(\s*)(alter table public\.[a-z_]+ add constraint [a-z_]+ .*;)\s*$",
                   lambda m: f"{m.group(1)}do $dup$ begin {m.group(2)} exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;", s, flags=re.M)
        s = re.sub(r"^(\s*)create (unique )?index (?!if not exists)", lambda m: f"{m.group(1)}create {m.group(2) or ''}index if not exists ", s, flags=re.M | re.I)
    if name in ("01_migrations.sql", "03_functions.sql"):
        # functions are dumped alphabetically; SQL-language bodies that call a later function would fail validation
        s = "set local check_function_bodies = off;\n" + s
    if name == "05_triggers.sql":
        s = re.sub(r"^CREATE TRIGGER (\S+) (?:BEFORE|AFTER|INSTEAD OF) .*? ON (\S+) ", lambda m: f"DROP TRIGGER IF EXISTS {m.group(1)} ON {m.group(2)};\n{m.group(0)}", s, flags=re.M)
        s = PRIVATE_FNS + s
    if name == "07_constraints_indexes.sql":
        s = s.replace("exception when duplicate_object or duplicate_table then null;", "exception when duplicate_object or duplicate_table or invalid_table_definition then null;")
    if name == "06_rls_policies.sql":
        s = re.sub(r"^(create policy .*?;)[ \t]*$", lambda m: f"do $dup$ begin {m.group(1)} exception when duplicate_object then null; end $dup$;", s, flags=re.M | re.S)
    return s
SRC = pathlib.Path("/home/claude/ppu/db/pst-schema"); DST = pathlib.Path(__file__).resolve().parents[1] / "server/sql"
for f in sorted(SRC.glob("*.sql")):
    s = f.read_text()
    for ref in ("ndpfnerhvawbavkotinh", "ucejjztsbmrogiteivxl"): s = s.replace(ref, "__PPU_SUPABASE_REF__")
    if f.name == "08_cron_jobs.sql":  # two PST jobs call edge functions that were never deployed; drop them
        import re
        s = re.sub(r"select cron\.schedule\('pst-availability-(restock-notify|admin-email-retry)'.*?\n",
                   lambda m: "-- (dropped for Patriot: " + m.group(0).split("'")[1] + " called an edge function that was never deployed)\n", s, flags=re.S)
    s = harden(f.name, s)
    (DST / f.name).write_text(s); print("copied", f.name, len(s))
if (SRC / "README.md").exists(): shutil.copy(SRC / "README.md", DST / "README-schema.md")
