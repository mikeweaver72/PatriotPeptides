set local check_function_bodies = off;
-- 20261025192347 clone_00_ext_seq
create schema if not exists private;
create extension if not exists pg_net;
create extension if not exists pg_cron;
create sequence if not exists public.refund_number_seq;
create sequence if not exists public.order_number_seq;
create sequence if not exists public.customer_number_seq;
create sequence if not exists public.incoming_purchase_order_number_seq;
-- 20261025192516 clone_02_tables
create table if not exists public.order_items (id uuid default gen_random_uuid() not null, order_id uuid not null, product_id text, product_name text not null, product_strength text, product_category text, quantity integer default 1 not null, unit_price numeric(10,2) default 0.00 not null, line_total numeric(10,2) default 0.00 not null, created_at timestamp with time zone default now() not null, product_key text);
create table if not exists public.operating_expenses (id uuid default gen_random_uuid() not null, date date default CURRENT_DATE not null, category text default 'Expense'::text not null, description text, amount numeric(12,2) default 0 not null, method text, created_by uuid, created_by_email text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, company_name text);
create table if not exists public.admin_users (user_id uuid not null, created_at timestamp with time zone default now() not null, email text, is_active boolean default true not null);
create table if not exists public.inventory_movements (id uuid default gen_random_uuid() not null, product_id uuid, product_key text not null, movement_type text not null, quantity_change integer default 0, previous_quantity integer, new_quantity integer, admin_note text, created_by uuid, created_by_email text, created_at timestamp with time zone default now());
create table if not exists public.product_inventory (id uuid default gen_random_uuid() not null, product_key text not null, display_name text not null, category text, strength text, price numeric(10,2) default 0, current_inventory integer default 0, low_stock_threshold integer default 5, limited_stock_threshold integer default 10, status_override text, is_active boolean default true, image_file text, image_data text, featured boolean default false, blend_stack boolean default false, admin_note text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), cost_per_unit numeric(10,2), coa_url text, coa_label text);
create table if not exists public.customer_profiles (user_id uuid not null, first_name text, last_name text, email text not null, phone text, username text, billing_address text, billing_city text, billing_state text, billing_zip text, shipping_address text, shipping_city text, shipping_state text, shipping_zip text, account_status text default 'active'::text not null, age_confirmed boolean default false, research_use_acknowledged boolean default false, tos_accepted boolean default false, admin_notes text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, marketing_opt_in boolean default false, marketing_opt_out boolean default false, marketing_opt_in_at timestamp with time zone, marketing_opt_out_at timestamp with time zone, marketing_source text, customer_tags text[] default '{}'::text[], card_last4 text, bank_last4 text, research_role text, research_role_confirmed_at timestamp with time zone, customer_number bigint not null, communication_preference text default 'email'::text not null);
create table if not exists public.orders (id uuid default gen_random_uuid() not null, customer_id uuid, order_number text, status text default 'Pending'::text not null, subtotal numeric(10,2) default 0.00 not null, shipping numeric(10,2) default 0.00 not null, tax numeric(10,2) default 0.00 not null, total numeric(10,2) default 0.00 not null, shipping_name text, shipping_email text, shipping_phone text, shipping_address_line1 text, shipping_address_line2 text, shipping_city text, shipping_state text, shipping_zip text, payment_method text, payment_status text default 'Pending'::text not null, tracking_number text, tracking_carrier text, customer_notes text, admin_notes text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, inventory_deducted boolean default false, inventory_restored boolean default false, inventory_deducted_at timestamp with time zone, inventory_restored_at timestamp with time zone, inventory_failure_reason text, admin_note text, rejection_reason text, rejected_at timestamp with time zone, shipped_at timestamp with time zone, order_status text default 'pending'::text, shipping_carrier text, subtotal_before_discount numeric default 0, discount_code text, discount_id uuid, discount_type text, discount_percent numeric default 0, discount_amount numeric default 0, discount_code_amount numeric default 0, vial_discount_amount numeric default 0, no_tracking_required boolean default false not null, no_tracking_reason text, last_admin_actor text, last_admin_actor_email text, refund_number bigint, refund_status text, refund_reason text, refund_amount numeric default 0, refund_requested_at timestamp with time zone, refund_issued_at timestamp with time zone, order_sequence_number bigint, legacy_order_number text, user_id uuid, customer_number text, customer_email text, store_credit_applied numeric(12,2) default 0 not null, storefront text default 'peptides'::text not null, payment_deadline_at timestamp with time zone, payment_deadline_extended_at timestamp with time zone);
create table if not exists public.incoming_inventory (id text default (gen_random_uuid())::text not null, product_id text, product_key text, product_name text not null, ordered_quantity integer default 0 not null, kit_cost numeric(12,2) default 0 not null, kit_vial_count integer default 10 not null, cost_per_unit numeric(12,4) default 0 not null, shipping_cost numeric(12,2) default 0 not null, total_cost numeric(12,2) default 0 not null, supplier_name text, tracking_number text, status text default 'ordered'::text not null, notes text, ordered_at timestamp with time zone default now() not null, expected_arrival_date timestamp with time zone, received_at timestamp with time zone, received_quantity integer, created_by text, created_by_email text, audit_note text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, vendor_id uuid, vendor_name text, lead_time_days integer default 10, po_number text);
create table if not exists public.discount_usage (id uuid default gen_random_uuid() not null, discount_id uuid, order_id uuid, customer_email text, amount_saved numeric default 0 not null, used_at timestamp with time zone default now() not null);
create table if not exists public.order_audit_log (id uuid default gen_random_uuid() not null, order_id uuid not null, order_number text, action_type text not null, field_name text, old_value text, new_value text, changed_by text, changed_by_email text, created_at timestamp with time zone default now() not null);
create table if not exists public.discount_codes (id uuid default gen_random_uuid() not null, code text not null, discount_type text default 'standard'::text not null, percent_off numeric default 0 not null, amount_off numeric default 0 not null, assigned_email text, one_time_use boolean default false not null, max_uses integer, times_used integer default 0 not null, uses integer default 0 not null, active boolean default true not null, expires_at timestamp with time zone, created_by text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, promotion_title text, promotion_description text, hero_banner_text text, hero_banner_active boolean default false, promotion_starts_at timestamp with time zone, promotion_ends_at timestamp with time zone, audience text default 'all'::text not null);
create table if not exists public.product_key_aliases (old_product_key text not null, new_product_key text not null, product_id text, display_name text, strength text, migration_label text default 'pstp_item_number_migration'::text not null, created_at timestamp with time zone default now() not null);
create table if not exists public.vendors (id uuid default gen_random_uuid() not null, pst_vendor_id text not null, company_name text not null, address text, contact_name text, standard_shipping_lead_time integer default 10, whatsapp_number text, is_active boolean default true, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table if not exists public.product_catalog (id uuid default gen_random_uuid() not null, product_key text not null, display_name text not null, strength text, category text default 'Peptide'::text, series text, price numeric(10,2) default 0, current_inventory integer default 0, low_stock_threshold integer default 5, limited_stock_threshold integer default 10, is_active boolean default true, featured boolean default false, blend_stack boolean default false, image_file text, image_data text, coa_file text, coa_image text, sort_name text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), image_status text default 'approved_png'::text, hot_peptide boolean default false not null, label_line_1 text, label_line_2 text, label_line_3 text, label_dose text, sale_enabled boolean default false, sale_price numeric, sale_label text, coa_url text, coa_label text, admin_only text, research_focus text[] default '{}'::text[] not null, label_color text);
create table if not exists public.customer_credits (id uuid default gen_random_uuid() not null, user_id uuid, customer_email text not null, customer_name text, amount numeric(12,2) not null, remaining_amount numeric(12,2) default 0 not null, reason text not null, related_order_id uuid, related_order_number text, parent_credit_id uuid, source text default 'admin'::text not null, status text default 'available'::text not null, created_by text, created_by_email text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table if not exists public.site_payment_options (id integer default 1 not null, payment_methods jsonb default '[]'::jsonb not null, venmo_enabled boolean default false, venmo_handle text, venmo_note text, venmo_qr text, venmo_qr_image text, venmo_image text, qr_image text, updated_at timestamp with time zone default now() not null);
create table if not exists public.store_credit_transactions (id uuid default gen_random_uuid() not null, customer_user_id uuid, customer_email text not null, amount_cents bigint not null, reason text not null, created_by uuid not null, created_by_email text not null, created_at timestamp with time zone default now() not null);
create table if not exists public.customer_addresses (id uuid default gen_random_uuid() not null, user_id uuid not null, label text default 'Additional address'::text not null, recipient_name text, address_line1 text not null, address_line2 text, city text not null, state text not null, zip text not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table if not exists public.saved_report_templates (id uuid default gen_random_uuid() not null, name text not null, source text not null, configuration jsonb default '{}'::jsonb not null, created_by uuid not null, created_by_email text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table if not exists public.discount_customer_assignments (discount_id uuid not null, customer_id uuid not null, created_at timestamp with time zone default now() not null, created_by uuid);
create table if not exists public.bulk_request_audit (id bigint generated always as identity not null, request_number bigint not null, action text not null, old_status text, new_status text, actor_id uuid, actor_email text, changes jsonb default '{}'::jsonb not null, created_at timestamp with time zone default now() not null);
create table if not exists public.bulk_requests (request_number bigint generated always as identity not null, name text not null, company text, email text not null, phone text, product text not null, strength text not null, kits integer not null, requirements text, testing_path text not null, acknowledgment boolean default false not null, status text default 'new'::text not null, quote_amount numeric(12,2), quote_notes text, admin_notes text, po_number text, reviewed_at timestamp with time zone, quoted_at timestamp with time zone, ordered_at timestamp with time zone, last_touched_by uuid, last_touched_email text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table if not exists public.coa_records (id uuid default gen_random_uuid() not null, peptide_name text not null, strength text not null, lot_number text not null, storage_path text not null, is_published boolean default true not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table if not exists public.manual_customers (id uuid default gen_random_uuid() not null, first_name text not null, last_name text not null, email text, phone text, shipping_address text, shipping_city text, shipping_state text, shipping_zip text, research_role text not null, marketing_opt_in boolean default false not null, marketing_opt_out boolean default false not null, marketing_opt_in_at timestamp with time zone, marketing_opt_out_at timestamp with time zone, marketing_source text, admin_notes text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, created_by uuid, customer_number bigint not null);
create table if not exists public.site_promotions (id uuid default gen_random_uuid() not null, title text default ''::text not null, body text default ''::text, badge text default ''::text, button_text text default ''::text, button_link text default ''::text, image_url text default ''::text, is_active boolean default false not null, starts_at timestamp with time zone, ends_at timestamp with time zone, sort_order integer default 100 not null, title_bold boolean default true not null, title_italic boolean default false not null, title_underline boolean default false not null, body_bold boolean default false not null, body_italic boolean default false not null, body_underline boolean default false not null, title_size integer default 28 not null, body_size integer default 15 not null, text_align text default 'center'::text not null, text_color text default '#101820'::text not null, background_color text default '#ffffff'::text not null, accent_color text default '#003f9e'::text not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, discount_id uuid, auto_apply_discount boolean default false not null, audience text default 'public_all'::text not null, promotion_type text default 'banner'::text not null, reward_product_key text, reward_quantity integer default 1 not null, minimum_paid_quantity integer default 1 not null, redemption_limit text default 'once_per_customer'::text not null, max_redemptions integer, require_available_inventory boolean default true not null, eligibility_starts_at timestamp with time zone, reward_mode text default 'fixed'::text not null);
create table if not exists public.order_shipments (id uuid default gen_random_uuid() not null, order_id uuid not null, carrier text not null, tracking_number text not null, shipped_at timestamp with time zone default now() not null, created_by uuid default auth.uid() not null, created_at timestamp with time zone default now() not null);
create table if not exists public.order_shipment_items (shipment_id uuid not null, order_item_id uuid not null, quantity integer not null);
create table if not exists public.promotion_redemptions (id uuid default gen_random_uuid() not null, promotion_id uuid not null, order_id uuid not null, customer_id uuid not null, reward_product_key text not null, quantity integer not null, status text default 'reserved'::text not null, created_at timestamp with time zone default now() not null);
create table if not exists public.pst_backorder_allocations (order_item_id uuid not null, order_id uuid not null, product_key text not null, quantity integer not null, created_at timestamp with time zone default now() not null);
create table if not exists public.pst_complimentary_order_additions (id uuid default gen_random_uuid() not null, order_id uuid not null, order_item_id uuid, product_key text not null, quantity integer not null, shipment_id uuid, created_at timestamp with time zone default now() not null, created_by uuid, request_key uuid not null);
create table if not exists public.product_availability_requests (id uuid default gen_random_uuid() not null, product_key text not null, product_name text not null, product_strength text, requested_quantity integer not null, customer_name text not null, customer_email text not null, notify_when_available boolean default false not null, status text default 'pending'::text not null, created_at timestamp with time zone default now() not null, notified_at timestamp with time zone, confirmation_sent_at timestamp with time zone, confirmation_email_id text, admin_alert_sent_at timestamp with time zone, admin_alert_claimed_at timestamp with time zone);
create table if not exists public.pst_lab_testing_adjustments (id uuid default gen_random_uuid() not null, inventory_id uuid not null, product_key text not null, lot_number text not null, laboratory text not null, testing_date date not null, quantity integer not null, mode text not null, result_status text default 'pending'::text not null, notes text, created_at timestamp with time zone default now() not null, created_by uuid, request_key uuid not null);
create table if not exists public.pst_promotion_eligible_customers (promotion_id uuid not null, customer_email text not null);
create table if not exists public.pst_promotion_reward_options (promotion_id uuid not null, product_key text not null);
create table if not exists public.pst_order_reward_choices (order_id uuid not null, promotion_id uuid not null, product_key text not null, created_at timestamp with time zone default now() not null);
create table if not exists public.pst_vendor_catalog_items (id uuid default gen_random_uuid() not null, vendor_id uuid not null, vendor_item_number text, product_name text not null, strength text, kit_cost numeric(12,2) not null, kit_size integer default 10 not null, product_key text, updated_at timestamp with time zone default now() not null);
create table if not exists public.pst_vendor_prices (vendor_id uuid not null, product_key text not null, vendor_item_number text, kit_cost numeric(12,2) not null, kit_size integer default 10 not null, updated_at timestamp with time zone default now() not null);
create table if not exists public.catalog_carousel_ads (id uuid default gen_random_uuid() not null, title text default 'Catalog advertisement'::text not null, image_path text not null, sort_order integer default 0 not null, is_active boolean default true not null, created_at timestamp with time zone default now() not null);
-- 20261025192533 clone_03_pk_unique
do $dup$ begin alter table public.pst_complimentary_order_additions add constraint pst_complimentary_order_additions_request_key_key UNIQUE (request_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_codes add constraint discount_codes_code_key UNIQUE (code); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.product_catalog add constraint product_catalog_product_key_key UNIQUE (product_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_lab_testing_adjustments add constraint pst_lab_testing_adjustments_request_key_key UNIQUE (request_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.customer_profiles add constraint customer_profiles_username_key UNIQUE (username); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.orders add constraint orders_order_number_key UNIQUE (order_number); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.promotion_redemptions add constraint promotion_redemptions_promotion_id_order_id_key UNIQUE (promotion_id, order_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.product_inventory add constraint product_inventory_product_key_key UNIQUE (product_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_vendor_catalog_items add constraint pst_vendor_catalog_items_vendor_sku_strength_key UNIQUE (vendor_id, vendor_item_number, strength); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_complimentary_order_additions add constraint pst_complimentary_order_additions_order_item_id_key UNIQUE (order_item_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.catalog_carousel_ads add constraint catalog_carousel_ads_image_path_key UNIQUE (image_path); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.vendors add constraint vendors_pst_vendor_id_key UNIQUE (pst_vendor_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.vendors add constraint vendors_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.product_catalog add constraint product_catalog_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.customer_credits add constraint customer_credits_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.site_payment_options add constraint site_payment_options_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.store_credit_transactions add constraint store_credit_transactions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.customer_addresses add constraint customer_addresses_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.saved_report_templates add constraint saved_report_templates_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_customer_assignments add constraint discount_customer_assignments_pkey PRIMARY KEY (discount_id, customer_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.bulk_request_audit add constraint bulk_request_audit_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.bulk_requests add constraint bulk_requests_pkey PRIMARY KEY (request_number); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.coa_records add constraint coa_records_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.manual_customers add constraint manual_customers_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.site_promotions add constraint site_promotions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.order_shipments add constraint order_shipments_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.order_shipment_items add constraint order_shipment_items_pkey PRIMARY KEY (shipment_id, order_item_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.promotion_redemptions add constraint promotion_redemptions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_backorder_allocations add constraint pst_backorder_allocations_pkey PRIMARY KEY (order_item_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_complimentary_order_additions add constraint pst_complimentary_order_additions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.product_availability_requests add constraint product_availability_requests_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_lab_testing_adjustments add constraint pst_lab_testing_adjustments_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_promotion_eligible_customers add constraint pst_promotion_eligible_customers_pkey PRIMARY KEY (promotion_id, customer_email); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_promotion_reward_options add constraint pst_promotion_reward_options_pkey PRIMARY KEY (promotion_id, product_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_order_reward_choices add constraint pst_order_reward_choices_pkey PRIMARY KEY (order_id, promotion_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_vendor_catalog_items add constraint pst_vendor_catalog_items_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_vendor_prices add constraint pst_vendor_prices_pkey PRIMARY KEY (vendor_id, product_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.catalog_carousel_ads add constraint catalog_carousel_ads_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.operating_expenses add constraint operating_expenses_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.admin_users add constraint admin_users_pkey PRIMARY KEY (user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.inventory_movements add constraint inventory_movements_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.product_inventory add constraint product_inventory_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.customer_profiles add constraint customer_profiles_pkey PRIMARY KEY (user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.orders add constraint orders_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.incoming_inventory add constraint incoming_inventory_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_usage add constraint discount_usage_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.order_audit_log add constraint order_audit_log_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_codes add constraint discount_codes_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.product_key_aliases add constraint product_key_aliases_pkey PRIMARY KEY (old_product_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
-- 20261025192612 clone_04_fk
do $dup$ begin alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.admin_users add constraint admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.inventory_movements add constraint inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES product_inventory(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.customer_profiles add constraint customer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.orders add constraint orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.incoming_inventory add constraint incoming_inventory_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_usage add constraint discount_usage_discount_id_fkey FOREIGN KEY (discount_id) REFERENCES discount_codes(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_usage add constraint discount_usage_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.customer_credits add constraint customer_credits_parent_credit_id_fkey FOREIGN KEY (parent_credit_id) REFERENCES customer_credits(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.customer_addresses add constraint customer_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_customer_assignments add constraint discount_customer_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_customer_assignments add constraint discount_customer_assignments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer_profiles(user_id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.discount_customer_assignments add constraint discount_customer_assignments_discount_id_fkey FOREIGN KEY (discount_id) REFERENCES discount_codes(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.bulk_request_audit add constraint bulk_request_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.bulk_request_audit add constraint bulk_request_audit_request_number_fkey FOREIGN KEY (request_number) REFERENCES bulk_requests(request_number) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.bulk_requests add constraint bulk_requests_last_touched_by_fkey FOREIGN KEY (last_touched_by) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.manual_customers add constraint manual_customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.site_promotions add constraint site_promotions_discount_id_fkey FOREIGN KEY (discount_id) REFERENCES discount_codes(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.order_shipments add constraint order_shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.order_shipment_items add constraint order_shipment_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.order_shipment_items add constraint order_shipment_items_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES order_shipments(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.promotion_redemptions add constraint promotion_redemptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.promotion_redemptions add constraint promotion_redemptions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.promotion_redemptions add constraint promotion_redemptions_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES site_promotions(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_backorder_allocations add constraint pst_backorder_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_backorder_allocations add constraint pst_backorder_allocations_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_complimentary_order_additions add constraint pst_complimentary_order_additions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_complimentary_order_additions add constraint pst_complimentary_order_additions_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_complimentary_order_additions add constraint pst_complimentary_order_additions_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES order_shipments(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_lab_testing_adjustments add constraint pst_lab_testing_adjustments_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES product_inventory(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_promotion_eligible_customers add constraint pst_promotion_eligible_customers_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES site_promotions(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_promotion_reward_options add constraint pst_promotion_reward_options_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES site_promotions(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_order_reward_choices add constraint pst_order_reward_choices_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_order_reward_choices add constraint pst_order_reward_choices_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES site_promotions(id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_vendor_catalog_items add constraint pst_vendor_catalog_items_product_key_fkey FOREIGN KEY (product_key) REFERENCES product_inventory(product_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_vendor_catalog_items add constraint pst_vendor_catalog_items_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_vendor_prices add constraint pst_vendor_prices_product_key_fkey FOREIGN KEY (product_key) REFERENCES product_inventory(product_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
do $dup$ begin alter table public.pst_vendor_prices add constraint pst_vendor_prices_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
-- 20261025192613 clone_05_indexes
create index if not exists bulk_requests_new_created_idx ON public.bulk_requests USING btree (created_at DESC) WHERE (status = 'new'::text);
create index if not exists saved_report_templates_updated_at_idx ON public.saved_report_templates USING btree (updated_at DESC);
create index if not exists idx_product_inventory_product_key ON public.product_inventory USING btree (product_key);
create index if not exists idx_customer_profiles_marketing_opt_in ON public.customer_profiles USING btree (marketing_opt_in);
create index if not exists idx_order_shipments_order_id ON public.order_shipments USING btree (order_id);
create index if not exists idx_discount_codes_hero_banner_active ON public.discount_codes USING btree (hero_banner_active, active);
create index if not exists idx_orders_inventory_restored ON public.orders USING btree (inventory_restored);
create index if not exists discount_usage_order_id_idx ON public.discount_usage USING btree (order_id);
create index if not exists idx_product_catalog_image_status ON public.product_catalog USING btree (image_status);
create index if not exists orders_user_id_idx ON public.orders USING btree (user_id);
create index if not exists customer_credits_remaining_idx ON public.customer_credits USING btree (remaining_amount);
create index if not exists idx_orders_created_at ON public.orders USING btree (created_at DESC);
create index if not exists idx_order_shipment_items_item ON public.order_shipment_items USING btree (order_item_id);
create index if not exists incoming_inventory_vendor_id_idx ON public.incoming_inventory USING btree (vendor_id);
create index if not exists customer_credits_email_idx ON public.customer_credits USING btree (lower(customer_email));
create index if not exists idx_product_catalog_category ON public.product_catalog USING btree (category);
create index if not exists discount_customer_assignments_created_by_idx ON public.discount_customer_assignments USING btree (created_by);
create index if not exists order_items_product_key_idx ON public.order_items USING btree (product_key);
create UNIQUE index if not exists orders_refund_number_key ON public.orders USING btree (refund_number) WHERE (refund_number IS NOT NULL);
create index if not exists idx_product_catalog_admin_only ON public.product_catalog USING btree (admin_only);
create index if not exists incoming_inventory_product_id_idx ON public.incoming_inventory USING btree (product_id);
create index if not exists idx_orders_inventory_deducted ON public.orders USING btree (inventory_deducted);
create index if not exists idx_product_inventory_status_override ON public.product_inventory USING btree (status_override);
create index if not exists store_credit_transactions_customer_user_idx ON public.store_credit_transactions USING btree (customer_user_id, created_at DESC);
create index if not exists customer_credits_status_idx ON public.customer_credits USING btree (status);
create index if not exists discount_usage_discount_id_idx ON public.discount_usage USING btree (discount_id);
create index if not exists customer_credits_user_id_idx ON public.customer_credits USING btree (user_id);
create UNIQUE index if not exists discount_usage_one_row_per_order_idx ON public.discount_usage USING btree (order_id) WHERE (order_id IS NOT NULL);
create index if not exists idx_inventory_movements_created_at ON public.inventory_movements USING btree (created_at DESC);
create index if not exists customer_addresses_user_id_idx ON public.customer_addresses USING btree (user_id);
create index if not exists bulk_request_audit_request_created_idx ON public.bulk_request_audit USING btree (request_number, created_at DESC);
create index if not exists idx_site_promotions_discount_id ON public.site_promotions USING btree (discount_id);
create index if not exists discount_customer_assignments_customer_idx ON public.discount_customer_assignments USING btree (customer_id, discount_id);
create index if not exists bulk_request_audit_actor_id_idx ON public.bulk_request_audit USING btree (actor_id);
create index if not exists incoming_inventory_status_idx ON public.incoming_inventory USING btree (status);
create index if not exists incoming_inventory_product_key_idx ON public.incoming_inventory USING btree (product_key);
create index if not exists idx_product_catalog_sort_name ON public.product_catalog USING btree (sort_name);
create index if not exists bulk_requests_last_touched_by_idx ON public.bulk_requests USING btree (last_touched_by);
create index if not exists store_credit_transactions_customer_email_idx ON public.store_credit_transactions USING btree (lower(customer_email), created_at DESC);
create UNIQUE index if not exists admin_users_user_id_unique ON public.admin_users USING btree (user_id);
create index if not exists idx_orders_customer_id ON public.orders USING btree (customer_id);
create UNIQUE index if not exists admin_users_email_unique ON public.admin_users USING btree (email);
create UNIQUE index if not exists customer_profiles_customer_number_key ON public.customer_profiles USING btree (customer_number);
create index if not exists idx_product_catalog_active ON public.product_catalog USING btree (is_active);
create UNIQUE index if not exists orders_order_sequence_number_key ON public.orders USING btree (order_sequence_number) WHERE (order_sequence_number IS NOT NULL);
create index if not exists idx_customer_profiles_marketing_opt_out ON public.customer_profiles USING btree (marketing_opt_out);
create index if not exists idx_product_catalog_product_key ON public.product_catalog USING btree (product_key);
create index if not exists idx_customer_profiles_created_at ON public.customer_profiles USING btree (created_at);
create index if not exists incoming_inventory_ordered_at_idx ON public.incoming_inventory USING btree (ordered_at DESC);
create index if not exists idx_inventory_movements_product_id ON public.inventory_movements USING btree (product_id);
create index if not exists idx_product_inventory_active ON public.product_inventory USING btree (is_active);
create index if not exists order_audit_log_order_id_created_at_idx ON public.order_audit_log USING btree (order_id, created_at DESC);
create index if not exists bulk_requests_status_created_idx ON public.bulk_requests USING btree (status, created_at DESC);
create index if not exists vendors_company_name_idx ON public.vendors USING btree (company_name);
create UNIQUE index if not exists manual_customers_email_unique ON public.manual_customers USING btree (lower(email)) WHERE (email IS NOT NULL);
create UNIQUE index if not exists manual_customers_customer_number_unique ON public.manual_customers USING btree (customer_number);
create index if not exists discount_codes_code_idx ON public.discount_codes USING btree (code);
create index if not exists vendors_is_active_idx ON public.vendors USING btree (is_active);
create index if not exists idx_order_items_order_id ON public.order_items USING btree (order_id);
create index if not exists pst_availability_by_product ON public.product_availability_requests USING btree (product_key, status, created_at);
create index if not exists incoming_inventory_po_number_idx ON public.incoming_inventory USING btree (po_number);
create index if not exists idx_customer_profiles_email ON public.customer_profiles USING btree (email);
create index if not exists coa_records_lot_number_idx ON public.coa_records USING btree (lot_number);
-- 20261025201909 pst_analytics_v5
create table if not exists public.pst_web_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  visitor text not null check (length(visitor) between 8 and 40),
  session text not null check (length(session) between 8 and 40),
  user_id uuid,
  event text not null check (event in ('page_view','product_view','search','add_to_bag','checkout_start','order_placed','signup')),
  path text check (length(path) <= 200),
  product_key text check (length(product_key) <= 40),
  qty integer check (qty is null or qty between 0 and 9999),
  value numeric check (value is null or value between 0 and 1000000),
  term text check (length(term) <= 80),
  ref_host text check (length(ref_host) <= 120),
  utm_source text check (length(utm_source) <= 60),
  utm_medium text check (length(utm_medium) <= 60),
  utm_campaign text check (length(utm_campaign) <= 80),
  device text check (device in ('mobile','tablet','desktop')),
  app boolean not null default false
);
create index if not exists pst_web_events_at on public.pst_web_events(at);
create index if not exists pst_web_events_event_at on public.pst_web_events(event, at);
create index if not exists pst_web_events_session on public.pst_web_events(session);
alter table public.pst_web_events enable row level security;
drop policy if exists "owner reads web events" on public.pst_web_events;
create policy "owner reads web events" on public.pst_web_events for select to authenticated
  using (exists(select 1 from public.admin_users au where au.is_active=true and (au.user_id=auth.uid() or au.email=auth.jwt()->>'email')));
revoke all on public.pst_web_events from anon, authenticated;
grant select on public.pst_web_events to authenticated;

create or replace function public.pst_track(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_session text := left(coalesce(p->>'session',''), 40); n int;
begin
  if length(v_session) < 8 or length(coalesce(p->>'visitor','')) < 8 then return; end if;
  if (p->>'event') not in ('page_view','product_view','search','add_to_bag','checkout_start','order_placed','signup') then return; end if;
  select count(*) into n from public.pst_web_events where session = v_session and at > now() - interval '1 day';
  if n >= 300 then return; end if;
  insert into public.pst_web_events(visitor, session, user_id, event, path, product_key, qty, value, term, ref_host, utm_source, utm_medium, utm_campaign, device, app)
  values (left(p->>'visitor',40), v_session, auth.uid(), p->>'event', left(p->>'path',200), left(p->>'product_key',40),
          case when (p->>'qty') ~ '^\d{1,4}$' then (p->>'qty')::int end,
          case when (p->>'value') ~ '^\d{1,7}(\.\d{1,2})?$' then (p->>'value')::numeric end,
          left(lower(p->>'term'),80), left(lower(p->>'ref_host'),120), left(lower(p->>'utm_source'),60), left(lower(p->>'utm_medium'),60), left(p->>'utm_campaign',80),
          case when p->>'device' in ('mobile','tablet','desktop') then p->>'device' end, coalesce((p->>'app')::boolean, false));
exception when others then null;
end $$;
revoke all on function public.pst_track(jsonb) from public;
grant execute on function public.pst_track(jsonb) to anon, authenticated;

create or replace function public.pst_insights(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a timestamptz := p_from::timestamptz; b timestamptz := (p_to + 1)::timestamptz; r jsonb;
begin
  if not exists(select 1 from public.admin_users au where au.is_active=true and (au.user_id=auth.uid() or au.email=auth.jwt()->>'email')) then raise exception 'Admin access required'; end if;
  with ev as (select * from public.pst_web_events where at >= a and at < b),
  ord as (select o.*, lower(coalesce(o.order_status,o.status,'')) st, lower(coalesce(o.payment_status,'')) ps from public.orders o where o.created_at >= a and o.created_at < b),
  good as (select * from ord where st not in ('cancelled','canceled','rejected','refunded') ),
  paid as (select * from good where ps = 'paid'),
  items as (select i.*, g.ps from public.order_items i join good g on g.id = i.order_id where coalesce(i.unit_price,0) > 0),
  firsts as (select coalesce(customer_id::text, lower(customer_email)) c, min(created_at) f from public.orders
             where lower(coalesce(order_status,status,'')) not in ('cancelled','canceled','rejected','refunded') group by 1)
  select jsonb_build_object(
    'web', jsonb_build_object(
      'visitors', (select count(distinct visitor) from ev),
      'sessions', (select count(distinct session) from ev),
      'page_views', (select count(*) from ev where event='page_view'),
      'app_sessions', (select count(distinct session) from ev where app),
      'by_day', (select coalesce(jsonb_agg(x order by d), '[]') from (select at::date d, count(distinct visitor) visitors, count(*) filter (where event='page_view') views from ev group by 1) x),
      'sources', (select coalesce(jsonb_agg(x order by n desc), '[]') from (select coalesce(nullif(utm_source,''), nullif(ref_host,''), 'direct') src, count(distinct session) n from ev group by 1 order by 2 desc limit 12) x),
      'devices', (select coalesce(jsonb_object_agg(coalesce(device,'unknown'), n), '{}') from (select device, count(distinct session) n from ev group by 1) x),
      'top_pages', (select coalesce(jsonb_agg(x order by n desc), '[]') from (select path, count(*) n from ev where event='page_view' group by 1 order by 2 desc limit 12) x),
      'top_viewed', (select coalesce(jsonb_agg(x order by n desc), '[]') from (select product_key, count(*) n from ev where event='product_view' group by 1 order by 2 desc limit 12) x),
      'searches', (select coalesce(jsonb_agg(x order by n desc), '[]') from (select term, count(*) n from ev where event='search' and term is not null group by 1 order by 2 desc limit 15) x),
      'funnel', jsonb_build_object(
        'sessions', (select count(distinct session) from ev),
        'viewed_product', (select count(distinct session) from ev where event='product_view'),
        'added_to_bag', (select count(distinct session) from ev where event='add_to_bag'),
        'started_checkout', (select count(distinct session) from ev where event='checkout_start'),
        'placed_order', (select count(distinct session) from ev where event='order_placed'))),
    'retail', jsonb_build_object(
      'orders', (select count(*) from good),
      'paid_orders', (select count(*) from paid),
      'revenue_paid', (select coalesce(sum(total),0) from paid),
      'revenue_pending', (select coalesce(sum(total),0) from good where ps <> 'paid'),
      'avg_order', (select coalesce(round(avg(total),2),0) from paid),
      'cancelled', (select count(*) from ord where st in ('cancelled','canceled')),
      'auto_cancelled', (select count(*) from ord where st in ('cancelled','canceled') and coalesce(admin_notes,'') ilike '%24-hour payment reservation expired%'),
      'by_day', (select coalesce(jsonb_agg(x order by d), '[]') from (select created_at::date d, count(*) orders, coalesce(sum(total) filter (where ps='paid'),0) paid from good group by 1) x),
      'top_products', (select coalesce(jsonb_agg(x order by revenue desc), '[]') from (select product_key, max(product_name) name, max(product_strength) strength, sum(quantity) units, sum(line_total) revenue from items group by 1 order by 5 desc limit 15) x),
      'payment_mix', (select coalesce(jsonb_object_agg(coalesce(payment_method,'Unknown'), n), '{}') from (select payment_method, count(*) n from good group by 1) x),
      'pickup', (select count(*) from good where coalesce(customer_notes,'') ilike '%local pickup%'),
      'shipped', (select count(*) from good where coalesce(customer_notes,'') not ilike '%local pickup%'),
      'customers', (select count(distinct coalesce(customer_id::text, lower(customer_email))) from good),
      'new_customers', (select count(*) from firsts where f >= a and f < b),
      'repeat_customers', (select count(*) from (select coalesce(customer_id::text, lower(customer_email)) c from good group by 1) g join firsts f on f.c = g.c where f.f < a),
      'backorder_units', (select coalesce(sum(i.backorder_quantity),0) from public.order_items i join good g on g.id=i.order_id),
      'discounts', (select coalesce(sum(coalesce(discount_amount,0)),0) from good),
      'store_credit', (select coalesce(sum(coalesce(store_credit_applied,0)),0) from good)),
    'stock', jsonb_build_object(
      'low', (select coalesce(jsonb_agg(x order by current_inventory), '[]') from (select product_key, display_name, strength, current_inventory from public.product_inventory
               where coalesce(is_active,true) and current_inventory > 0 and current_inventory <= coalesce(low_stock_threshold,5) order by current_inventory limit 20) x),
      'out', (select count(*) from public.product_inventory where coalesce(is_active,true) and current_inventory <= 0))
  ) into r;
  return r;
end $$;
revoke all on function public.pst_insights(date, date) from public, anon;
grant execute on function public.pst_insights(date, date) to authenticated;
-- 20261025201925 pst_label_colors_v6
create or replace function public.pst_pick_label_color(p_name text, p_key text default null) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select c.label_color from public.product_catalog c
      where lower(c.display_name) = lower(p_name) and coalesce(c.product_key,'') <> coalesce(p_key,'')
        and nullif(trim(c.label_color),'') is not null and lower(c.label_color) <> 'kpv'
      group by c.label_color order by count(*) desc limit 1),
    case
      when p_name ~* '(semaglutide|1sem|survodutide)' then 'Teal'
      when p_name ~* '(tirzepatide|2tir)' then 'Purple'
      when p_name ~* '(retatrutide|3ret)' then 'Red'
      when p_name ~* '(bacteriostatic|water|misc)' then 'Green'
      when p_name ~* '(b12|carnitine|\mmic\M|lipo|hcg|5000iu)' then 'Black'
      when p_name ~* '(ipamorelin|cjc|sermorelin|tesamorelin|aod|kisspeptin|pt-141|melanotan|melantonin|oxytocin|cagri)' then 'Orange'
    end,
    'Blue');
$$;

create or replace function public.pst_auto_label_color() returns trigger
language plpgsql set search_path = '' as $$
begin
  if nullif(trim(coalesce(new.label_color,'')),'') is null then
    new.label_color := public.pst_pick_label_color(new.display_name, new.product_key);
  end if;
  return new;
end $$;
drop trigger if exists pst_auto_label_color on public.product_catalog;
create trigger pst_auto_label_color before insert or update of label_color, display_name on public.product_catalog
  for each row execute function public.pst_auto_label_color();

update public.product_catalog set label_color = null where lower(trim(coalesce(label_color,''))) = 'kpv';
update public.product_catalog set label_color = label_color where nullif(trim(coalesce(label_color,'')),'') is null;
update public.product_catalog set label_color = 'Blue' where label_color = 'BLUE';
-- 20261025203857 pst_home_bottles_v7
alter table public.product_catalog add column if not exists home_feature_rank integer;
do $$ begin
  do $dup$ begin alter table public.product_catalog add constraint product_catalog_home_feature_rank_range check (home_feature_rank is null or home_feature_rank between 1 and 12); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
exception when duplicate_object then null; end $$;
alter table public.product_catalog add column if not exists bottle_url text;
alter table public.product_catalog add column if not exists bottle_sig text;
insert into storage.buckets (id, name, public) values ('product-bottles', 'product-bottles', true) on conflict (id) do nothing;
drop policy if exists "bottles are public" on storage.objects;
create policy "bottles are public" on storage.objects for select to anon, authenticated using (bucket_id = 'product-bottles');
drop policy if exists "owner uploads bottles" on storage.objects;
create policy "owner uploads bottles" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-bottles' and exists(select 1 from public.admin_users au where au.is_active=true and (au.user_id=auth.uid() or au.email=auth.jwt()->>'email')));
drop policy if exists "owner replaces bottles" on storage.objects;
create policy "owner replaces bottles" on storage.objects for update to authenticated
  using (bucket_id = 'product-bottles' and exists(select 1 from public.admin_users au where au.is_active=true and (au.user_id=auth.uid() or au.email=auth.jwt()->>'email')));
update public.product_catalog set home_feature_rank = case product_key when 'PSTP100050' then 1 when 'PSTP100013' then 2 when 'PSTP100054' then 3 end where product_key in ('PSTP100050','PSTP100013','PSTP100054');
-- 20261025210628 pst_notify_v8
create table if not exists public.pst_inbox (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'owner')),
  kind text not null check (length(kind) <= 40),
  title text not null check (length(title) <= 160),
  body text check (length(body) <= 400),
  url text check (length(url) <= 300),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists pst_inbox_user_at on public.pst_inbox(user_id, created_at desc);
create index if not exists pst_inbox_role_at on public.pst_inbox(role, created_at desc);
alter table public.pst_inbox enable row level security;
drop policy if exists "read own inbox" on public.pst_inbox;
create policy "read own inbox" on public.pst_inbox for select to authenticated using (
  (role = 'customer' and user_id = auth.uid()) or
  (role = 'owner' and exists(select 1 from public.admin_users au where au.is_active = true and (au.user_id = auth.uid() or au.email = auth.jwt()->>'email'))));
drop policy if exists "mark own inbox read" on public.pst_inbox;
create policy "mark own inbox read" on public.pst_inbox for update to authenticated using (
  (role = 'customer' and user_id = auth.uid()) or
  (role = 'owner' and exists(select 1 from public.admin_users au where au.is_active = true and (au.user_id = auth.uid() or au.email = auth.jwt()->>'email'))));
revoke all on public.pst_inbox from anon, authenticated;
grant select on public.pst_inbox to authenticated;
grant update (read_at) on public.pst_inbox to authenticated;
create table if not exists public.pst_notify_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'owner')),
  orders boolean not null default true,
  reminders boolean not null default true,
  new_orders boolean not null default true,
  payments boolean not null default true,
  low_stock boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.pst_notify_prefs enable row level security;
drop policy if exists "own alert settings" on public.pst_notify_prefs;
create policy "own alert settings" on public.pst_notify_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.pst_notify_prefs from anon, authenticated;
grant select, insert, update on public.pst_notify_prefs to authenticated;
-- 20261025211305 pst_coming_soon_v9
alter table public.product_catalog add column if not exists coming_soon boolean not null default false;
create or replace function public.pst_clear_coming_soon() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.current_inventory, 0) > 0 and coalesce(old.current_inventory, 0) <= 0 then
    update public.product_catalog set coming_soon = false where product_key = new.product_key and coming_soon;
  end if;
  return new;
exception when others then
  raise warning 'pst_clear_coming_soon: %', sqlerrm; return new;
end $$;
drop trigger if exists pst_clear_coming_soon on public.product_inventory;
create trigger pst_clear_coming_soon after update of current_inventory on public.product_inventory
  for each row execute function public.pst_clear_coming_soon();
-- 20261025211602 pst_owner_alerts_v10
alter table public.pst_notify_prefs add column if not exists cancellations boolean not null default true;
alter table public.pst_notify_prefs add column if not exists signups boolean not null default true;
alter table public.pst_notify_prefs add column if not exists requests boolean not null default true;
alter table public.pst_notify_prefs add column if not exists sold_out boolean not null default true;
create or replace function public.pst_owner_event_hook() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare hk text; kind text; ref text;
begin
  begin
    if tg_table_name = 'customer_profiles' then kind := 'signup'; ref := new.user_id::text;
    elsif tg_table_name = 'product_availability_requests' then kind := 'request'; ref := new.id::text;
    elsif tg_table_name = 'bulk_requests' then kind := 'bulk'; ref := new.request_number::text;
    elsif tg_table_name = 'product_inventory' then
      if not (coalesce(new.current_inventory, 0) <= 0 and coalesce(old.current_inventory, 0) > 0) then return new; end if;
      kind := 'sold_out'; ref := new.product_key;
    else return new; end if;
    select value into hk from public.pst_app_secrets where key = 'hook_key';
    perform net.http_post(
      url := 'https://__PPU_SUPABASE_REF__.supabase.co/functions/v1/pst-push',
      body := jsonb_build_object('event', 'owner_event', 'kind', kind, 'ref', ref),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', coalesce(hk, '')),
      timeout_milliseconds := 8000);
  exception when others then
    raise warning 'pst_owner_event_hook skipped: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists pst_owner_signup_alert on public.customer_profiles;
create trigger pst_owner_signup_alert after insert on public.customer_profiles for each row execute function public.pst_owner_event_hook();
drop trigger if exists pst_owner_request_alert on public.product_availability_requests;
create trigger pst_owner_request_alert after insert on public.product_availability_requests for each row execute function public.pst_owner_event_hook();
drop trigger if exists pst_owner_bulk_alert on public.bulk_requests;
create trigger pst_owner_bulk_alert after insert on public.bulk_requests for each row execute function public.pst_owner_event_hook();
drop trigger if exists pst_owner_soldout_alert on public.product_inventory;
create trigger pst_owner_soldout_alert after update of current_inventory on public.product_inventory for each row execute function public.pst_owner_event_hook();
-- 20261025214929 pst_payments_in_v11
create table if not exists public.pst_payment_matches (
  id bigserial primary key,
  source text not null default 'venmo' check (source in ('venmo', 'zelle', 'cashapp')),
  msg_id text not null unique,
  payer text,
  amount numeric(12,2) not null,
  order_id uuid,
  order_number text,
  order_total numeric(12,2),
  status text not null check (status in ('matched', 'amount_mismatch', 'guessed', 'no_order', 'already_paid', 'unverified')),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists pst_payment_matches_order on public.pst_payment_matches(order_id);
alter table public.pst_payment_matches enable row level security;
drop policy if exists "owner reads payment matches" on public.pst_payment_matches;
create policy "owner reads payment matches" on public.pst_payment_matches for select to authenticated
  using (exists(select 1 from public.admin_users au where au.is_active = true and (au.user_id = auth.uid() or au.email = auth.jwt()->>'email')));
drop policy if exists "owner confirms payment matches" on public.pst_payment_matches;
create policy "owner confirms payment matches" on public.pst_payment_matches for update to authenticated
  using (exists(select 1 from public.admin_users au where au.is_active = true and (au.user_id = auth.uid() or au.email = auth.jwt()->>'email')));
revoke all on public.pst_payment_matches from anon, authenticated;
grant select on public.pst_payment_matches to authenticated;
grant update (confirmed_at) on public.pst_payment_matches to authenticated;
alter table public.pst_notify_prefs add column if not exists payments_in boolean not null default true;
insert into public.pst_app_secrets(key, value) values ('pay_key', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;
insert into storage.buckets (id, name, public) values ('email-assets', 'email-assets', true) on conflict (id) do nothing;
drop policy if exists "email assets are public" on storage.objects;
create policy "email assets are public" on storage.objects for select to anon, authenticated using (bucket_id = 'email-assets');
-- 20261026060351 pst_support_tickets_v1
create table if not exists public.pst_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_email text,
  screen text,
  what text not null check (length(what) between 3 and 4000),
  expected text check (expected is null or length(expected) <= 2000),
  urgency text not null default 'annoying' check (urgency in ('blocking','annoying','idea')),
  shot_count int not null default 0 check (shot_count between 0 and 4),
  diag jsonb,
  status text not null default 'new' check (status in ('new','looking','fixed','need_info','wont_fix')),
  reply text,
  replied_at timestamptz,
  fixed_in text
);
create table if not exists public.pst_support_shots (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.pst_support_tickets(id) on delete cascade,
  idx int not null check (idx between 0 and 3),
  mime text not null default 'image/jpeg' check (mime in ('image/jpeg','image/png','image/webp')),
  data text not null check (length(data) <= 900000),
  created_at timestamptz not null default now(),
  unique (ticket_id, idx)
);
alter table public.pst_support_tickets enable row level security;
alter table public.pst_support_shots enable row level security;
drop policy if exists "owners manage tickets" on public.pst_support_tickets;
create policy "owners manage tickets" on public.pst_support_tickets for all to authenticated
  using (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))))
  with check (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))));
drop policy if exists "owners manage shots" on public.pst_support_shots;
create policy "owners manage shots" on public.pst_support_shots for all to authenticated
  using (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))))
  with check (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))));
create index if not exists pst_support_tickets_created on public.pst_support_tickets (created_at desc);
create index if not exists pst_support_shots_ticket on public.pst_support_shots (ticket_id, idx);
-- 20261026060543 pst_support_tickets_view_key
alter table public.pst_support_tickets add column if not exists view_key uuid not null default gen_random_uuid();
-- 20261026062313 pst_support_tickets_v2_workflow
alter table public.pst_support_tickets drop constraint if exists pst_support_tickets_status_check;
do $dup$ begin alter table public.pst_support_tickets add constraint pst_support_tickets_status_check check (status in ('new','looking','testing','fixed','need_info','wont_fix','reopened')); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $dup$;
alter table public.pst_support_tickets add column if not exists confirmed boolean;
alter table public.pst_support_tickets add column if not exists confirmed_at timestamptz;
alter table public.pst_support_tickets add column if not exists followups jsonb not null default '[]'::jsonb;
-- 20261026063634 pst_releases_v1
create table if not exists public.pst_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  notes text,
  tested text,
  fix_note text,
  tickets int[] not null default '{}',
  branch text not null,
  pr_number int not null,
  preview_url text,
  db_changes text,
  status text not null default 'review' check (status in ('review','approved','changes','publishing','published','failed','withdrawn')),
  review_by text, review_at timestamptz, review_note text,
  publish_by text, publish_at timestamptz, commit_sha text, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.pst_releases enable row level security;
drop policy if exists "owners read releases" on public.pst_releases;
create policy "owners read releases" on public.pst_releases for select to authenticated
  using (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))));
create or replace function public.pst_review_release(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))) then raise exception 'Owners only'; end if;
  update public.pst_releases set status = case when p_ok then 'approved' else 'changes' end, review_by = auth.jwt() ->> 'email', review_at = now(),
    review_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_id and status in ('review', 'approved', 'changes');
  if not found then raise exception 'This update can''t be reviewed right now'; end if;
end $$;
revoke all on function public.pst_review_release(uuid, boolean, text) from public, anon;
grant execute on function public.pst_review_release(uuid, boolean, text) to authenticated;
-- 20261026070122 pst_promos_sms_v1
-- Pep Shop Texas · owner app 5.8
-- 1) Promos in emails: partner / sale boxes at the bottom of the automatic customer emails (send-order-email v52 reads these).
-- 2) Text promotions: customer text opt-in (with the consent wording they agreed to), the owner's test phone, and a log of every text.
-- Additive only: new tables, new nullable columns, new functions. Nothing existing is changed.

-- ---------- 1. promos in emails ----------
create table if not exists public.pst_email_promos (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'partner' check (kind in ('partner', 'sale')),
  name text not null,
  headline text not null check (char_length(headline) <= 90),
  body text check (char_length(body) <= 220),
  link_url text check (link_url is null or link_url ~* '^https://'),
  link_text text not null default 'Learn more' check (char_length(link_text) <= 40),
  logo_url text check (logo_url is null or logo_url ~* '^https://'),
  show_on text[] not null default '{order_received,order_placed,payment_accepted,order_packed,order_shipped,shipment_update,order_delivered,shipment_delivered}',
  starts_on date, ends_on date,
  enabled boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by text
);
alter table public.pst_email_promos enable row level security;
drop policy if exists "owners manage email promos" on public.pst_email_promos;
create policy "owners manage email promos" on public.pst_email_promos for all to authenticated
  using (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))))
  with check (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))));
insert into public.pst_email_promos (kind, name, headline, body, link_url, link_text, logo_url, sort)
select 'partner', 'PepKeep', 'Keep your research organized with PepKeep',
  'Track every vial, get reminders when it''s time to reorder, and see what each vial really costs. iPhone, Android and desktop.',
  'https://pepkeep.io', 'Try it free for 14 days', 'https://pepkeep.io/icons/apple-touch-icon.png', 0
where not exists (select 1 from public.pst_email_promos where name = 'PepKeep');

-- ---------- 2. text promotions ----------
alter table public.customer_profiles
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists sms_phone text,
  add column if not exists sms_opt_in_at timestamptz,
  add column if not exists sms_opt_out_at timestamptz,
  add column if not exists sms_source text,
  add column if not exists sms_consent_text text;

create or replace function public.pst_us_phone(p text) returns text language sql immutable set search_path = '' as $$
  select case when d ~ '^[2-9][0-9]{9}$' then '+1' || d when d ~ '^1[2-9][0-9]{9}$' then '+' || d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

create or replace function public.pst_sms_consent(p_on boolean, p_phone text default null, p_source text default 'account', p_text text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_on then
    v_phone := public.pst_us_phone(coalesce(nullif(trim(p_phone), ''), (select phone from public.customer_profiles where user_id = auth.uid())));
    if v_phone is null then raise exception 'Enter a 10-digit US mobile number to get texts'; end if;
    update public.customer_profiles set sms_opt_in = true, sms_phone = v_phone, sms_opt_in_at = now(), sms_opt_out_at = null,
      sms_source = left(coalesce(p_source, 'account'), 40), sms_consent_text = left(p_text, 600), updated_at = now() where user_id = auth.uid();
  else
    update public.customer_profiles set sms_opt_in = false, sms_opt_out_at = now(), sms_source = left(coalesce(p_source, 'account') || '_off', 40), updated_at = now() where user_id = auth.uid();
  end if;
  if not found then raise exception 'Save your profile first'; end if;
  return json_build_object('on', p_on, 'phone', v_phone);
end $$;
revoke all on function public.pst_sms_consent(boolean, text, text, text) from public, anon;
grant execute on function public.pst_sms_consent(boolean, text, text, text) to authenticated;

create table if not exists public.pst_sms_settings (
  id int primary key default 1 check (id = 1),
  test_phone text,
  updated_at timestamptz not null default now(), updated_by text
);
insert into public.pst_sms_settings (id) values (1) on conflict do nothing;
alter table public.pst_sms_settings enable row level security;
drop policy if exists "owners manage sms settings" on public.pst_sms_settings;
create policy "owners manage sms settings" on public.pst_sms_settings for all to authenticated
  using (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))))
  with check (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))));

create table if not exists public.pst_sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  is_test boolean not null default false,
  status text not null default 'sending' check (status in ('sending', 'done', 'failed', 'practice')),
  recipients int not null default 0, sent int not null default 0, failed int not null default 0, skipped int not null default 0,
  error text, created_by text, created_at timestamptz not null default now(), finished_at timestamptz
);
create table if not exists public.pst_sms_log (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.pst_sms_campaigns(id) on delete cascade,
  user_id uuid, phone text not null,
  status text not null check (status in ('sent', 'failed', 'skipped', 'opted_out', 'practice')),
  provider_id text, error text,
  created_at timestamptz not null default now()
);
create index if not exists pst_sms_log_phone_idx on public.pst_sms_log (phone, created_at desc);
create index if not exists pst_sms_log_campaign_idx on public.pst_sms_log (campaign_id);
alter table public.pst_sms_campaigns enable row level security;
alter table public.pst_sms_log enable row level security;
drop policy if exists "owners read sms campaigns" on public.pst_sms_campaigns;
create policy "owners read sms campaigns" on public.pst_sms_campaigns for select to authenticated
  using (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))));
drop policy if exists "owners read sms log" on public.pst_sms_log;
create policy "owners read sms log" on public.pst_sms_log for select to authenticated
  using (exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))));
-- 20261026171326 pst_ticket_alerts_v1
create or replace function public.pst_ticket_hook() returns trigger
language plpgsql security definer set search_path = '' as $$
declare hk text; kind text;
begin
  begin
    if tg_op = 'INSERT' then kind := 'new';
    elsif coalesce(jsonb_array_length(new.followups), 0) > coalesce(jsonb_array_length(old.followups), 0)
       or (new.status = 'reopened' and old.status is distinct from 'reopened') then kind := 'followup';
    else return new; end if;
    select value into hk from public.pst_app_secrets where key = 'hook_key';
    perform net.http_post(
      url := 'https://__PPU_SUPABASE_REF__.supabase.co/functions/v1/pst-push',
      body := jsonb_build_object('event', 'ticket', 'kind', kind, 'ref', new.id::text),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', coalesce(hk, '')),
      timeout_milliseconds := 15000);
  exception when others then
    raise warning 'pst_ticket_hook skipped: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.pst_ticket_hook() from public, anon, authenticated;
drop trigger if exists pst_ticket_alert on public.pst_support_tickets;
create trigger pst_ticket_alert after insert or update of followups, status on public.pst_support_tickets
  for each row execute function public.pst_ticket_hook();
