# PST Supabase schema snapshot

Read-only copy of schema definitions from Supabase project `ndpfnerhvawbavkotinh`, taken 2026-10-26 with SELECT-only queries. No table rows were read other than `supabase_migrations.schema_migrations`. Nothing in Supabase was modified.

| File | Contents | Count |
|---|---|---|
| `00_extensions.sql` | `create extension if not exists` for every `pg_extension` row except `plpgsql` | 6 (pg_cron, pg_net, pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp) |
| `01_migrations.sql` | `supabase_migrations.schema_migrations`, ordered by version; `-- <version> <name>` header then `statements[1]` verbatim | 18 migrations (each has exactly one statement) |
| `03_functions.sql` | `pg_get_functiondef()` for every function/procedure in schema `public`, ordered by `proname`, each followed by a `;` line | 80 functions |
| `04_views.sql` | `create or replace view public.<name> as <definition>` from `pg_views` | 1 view (`catalog_listing`) |
| `05_triggers.sql` | `pg_get_triggerdef()` for non-internal triggers on public tables, each + `;` | 30 triggers across 13 tables |
| `06_rls_policies.sql` | `alter table ... enable row level security;` once per table, then `create policy ...` rebuilt from `pg_policies` (permissive/cmd/roles/using/with check) | 108 policies across 45 tables |
| `08_cron_jobs.sql` | `select cron.schedule('<jobname>', '<schedule>', $$<command>$$);` from `cron.job`, ordered by jobid | 6 jobs |

## Fidelity

Every file was checked against an `md5()` computed server-side on the same construction; all match byte-for-byte:

- migrations: concatenated `statements[1]` bodies, length 71755, md5 `bd2fc3fe…`
- functions: each of the 80 `pg_get_functiondef` outputs individually (length + md5)
- views, triggers, policies, cron: whole-file md5

Line endings: 69 of the 80 function bodies and the `pst-reorder-reminders` cron command are stored in the database with CRLF (`\r\n`) line endings; the files preserve those CRs exactly. Migrations, policies, triggers and the view use LF only.

## Not fetched / caveats

- Two triggers on `bulk_requests` call functions in the `private` schema (`private.audit_bulk_request_change`, `private.prepare_bulk_request_update`). Only `public` functions were requested, so their definitions are not in `03_functions.sql`.
- Tables that exist but were created outside the migration history (e.g. `pst_app_secrets`, `pst_product_cycles`, `pst_protocols`, `pst_push_subscriptions`, and columns such as `order_items.backorder_quantity` / `reorder_*`) are referenced by functions and policies but have no `create table` in `01_migrations.sql`; a full table DDL dump (information_schema / pg_attribute) was not part of this task.
- `pst_app_secrets` and `vault.decrypted_secrets` are referenced by name only; no secret values were read.
- `02_` and `07_` are intentionally unused numbers (reserved for table DDL and grants if dumped later).

## Added: table DDL and constraints/indexes

| File | Contents | Count |
|---|---|---|
| `02_tables.sql` | 9 `create sequence if not exists` lines, then column-only `create table if not exists public.<t> (...)` for every public base table, built from `information_schema.columns` (arrays as `<udt>[]`, numeric(p,s), varchar(n)). No constraints or identity clauses. | 54 tables, 9 sequences |
| `07_constraints_indexes.sql` | Every `pg_constraint` on public tables (p, u, f, c; ordered by type, table, name) as `alter table ... add constraint ...` wrapped in `do $$ ... exception when duplicate_object or duplicate_table then null ... $$` so anything 01 already created is skipped; then every public index not backed by a constraint as `create [unique] index if not exists`. | 199 constraints, 74 indexes |

Both verified against server-side md5 of the same construction (02 table body: 26000 / `5ecb1aaa…`; 07 body: 51895 / `adfcf83f…`).

### Apply order

`00_extensions` → `02_tables` → `01_migrations` → `03_functions` → `04_views` → `05_triggers` → `06_rls_policies` → `07_constraints_indexes` → `08_cron_jobs`

02 runs before 01 on purpose: 01's `create table if not exists` / `add column if not exists` statements are no-ops against 02's tables, and 01's plain `add constraint` lines then succeed; 07 afterwards back-fills every constraint and index 01 did not create. Identity columns (`bulk_request_audit.id`, `bulk_requests.request_number`, `pst_support_tickets.ticket_no`) appear in 02 as plain `bigint not null` because 02 is columns-only; the identity property lives in 01's `create table` text, which will not apply once 02 has created the table, so add it by hand if a rebuild needs it.
