alter table public.admin_users enable row level security;
do $dup$ begin create policy "Admins can verify own admin status" on public.admin_users as permissive for select to public using ((auth.uid() = user_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can view their own admin record" on public.admin_users as permissive for select to authenticated using (((user_id = auth.uid()) AND (is_active = true))); exception when duplicate_object then null; end $dup$;
alter table public.bulk_request_audit enable row level security;
do $dup$ begin create policy "active admins can read bulk request audit" on public.bulk_request_audit as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.bulk_requests enable row level security;
do $dup$ begin create policy "active admins can read bulk requests" on public.bulk_requests as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "active admins can update bulk requests" on public.bulk_requests as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "public can submit bulk requests" on public.bulk_requests as permissive for insert to anon, authenticated with check (((status = 'new'::text) AND (acknowledgment = true) AND (quote_amount IS NULL) AND (quote_notes IS NULL) AND (admin_notes IS NULL) AND (po_number IS NULL) AND (reviewed_at IS NULL) AND (quoted_at IS NULL) AND (ordered_at IS NULL) AND (last_touched_by IS NULL) AND (last_touched_email IS NULL))); exception when duplicate_object then null; end $dup$;
alter table public.catalog_carousel_ads enable row level security;
do $dup$ begin create policy "catalog_carousel_admin_delete" on public.catalog_carousel_ads as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND au.is_active)))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "catalog_carousel_admin_insert" on public.catalog_carousel_ads as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND au.is_active)))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "catalog_carousel_admin_update" on public.catalog_carousel_ads as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND au.is_active)))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND au.is_active)))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "catalog_carousel_public_active" on public.catalog_carousel_ads as permissive for select to anon, authenticated using ((is_active OR (EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND au.is_active))))); exception when duplicate_object then null; end $dup$;
alter table public.coa_records enable row level security;
do $dup$ begin create policy "COA admins delete" on public.coa_records as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "COA admins insert" on public.coa_records as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "COA admins select" on public.coa_records as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "COA admins update" on public.coa_records as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Published COA metadata visible" on public.coa_records as permissive for select to anon, authenticated using (is_published); exception when duplicate_object then null; end $dup$;
alter table public.customer_addresses enable row level security;
do $dup$ begin create policy "Customers can add own addresses" on public.customer_addresses as permissive for insert to authenticated with check ((( SELECT auth.uid() AS uid) = user_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can delete own addresses" on public.customer_addresses as permissive for delete to authenticated using ((( SELECT auth.uid() AS uid) = user_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can read own addresses" on public.customer_addresses as permissive for select to authenticated using ((( SELECT auth.uid() AS uid) = user_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can update own addresses" on public.customer_addresses as permissive for update to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id)); exception when duplicate_object then null; end $dup$;
alter table public.customer_credits enable row level security;
do $dup$ begin create policy "Admins can read customer credits" on public.customer_credits as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((lower(au.email) = lower((auth.jwt() ->> 'email'::text))) AND (COALESCE(au.is_active, true) = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can write customer credits" on public.customer_credits as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((lower(au.email) = lower((auth.jwt() ->> 'email'::text))) AND (COALESCE(au.is_active, true) = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((lower(au.email) = lower((auth.jwt() ->> 'email'::text))) AND (COALESCE(au.is_active, true) = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can apply own credits" on public.customer_credits as permissive for update to authenticated using (((user_id = auth.uid()) OR (lower(customer_email) = lower((auth.jwt() ->> 'email'::text))))) with check (((user_id = auth.uid()) OR (lower(customer_email) = lower((auth.jwt() ->> 'email'::text))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can insert own credit usage rows" on public.customer_credits as permissive for insert to authenticated with check (((user_id = auth.uid()) OR (lower(customer_email) = lower((auth.jwt() ->> 'email'::text))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can read own credits" on public.customer_credits as permissive for select to authenticated using (((user_id = auth.uid()) OR (lower(customer_email) = lower((auth.jwt() ->> 'email'::text))))); exception when duplicate_object then null; end $dup$;
alter table public.customer_profiles enable row level security;
do $dup$ begin create policy "Admins can read all customer profiles" on public.customer_profiles as permissive for select to public using ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.user_id = auth.uid())))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can update customer profiles" on public.customer_profiles as permissive for update to public using ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.user_id = auth.uid())))) with check ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.user_id = auth.uid())))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can insert own profile" on public.customer_profiles as permissive for insert to authenticated with check ((auth.uid() = user_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can read own profile" on public.customer_profiles as permissive for select to public using ((auth.uid() = user_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can update own profile" on public.customer_profiles as permissive for update to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can view own profile" on public.customer_profiles as permissive for select to authenticated using ((auth.uid() = user_id)); exception when duplicate_object then null; end $dup$;
alter table public.discount_codes enable row level security;
do $dup$ begin create policy "Admins can manage discount codes" on public.discount_codes as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Authenticated customers can read active eligible discount codes" on public.discount_codes as permissive for select to authenticated using (((active = true) AND ((expires_at IS NULL) OR (expires_at >= now())) AND ((COALESCE(TRIM(BOTH FROM assigned_email), ''::text) = ''::text) OR (lower(TRIM(BOTH FROM assigned_email)) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))); exception when duplicate_object then null; end $dup$;
alter table public.discount_customer_assignments enable row level security;
do $dup$ begin create policy "discount_assignments_admin_delete" on public.discount_customer_assignments as permissive for delete to authenticated using (( SELECT is_pst_admin() AS is_pst_admin)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "discount_assignments_admin_insert" on public.discount_customer_assignments as permissive for insert to authenticated with check (( SELECT is_pst_admin() AS is_pst_admin)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "discount_assignments_admin_select" on public.discount_customer_assignments as permissive for select to authenticated using (( SELECT is_pst_admin() AS is_pst_admin)); exception when duplicate_object then null; end $dup$;
alter table public.discount_usage enable row level security;
do $dup$ begin create policy "Admins can manage discount usage" on public.discount_usage as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can read own discount usage" on public.discount_usage as permissive for select to authenticated using ((lower(COALESCE(customer_email, ''::text)) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))); exception when duplicate_object then null; end $dup$;
alter table public.incoming_inventory enable row level security;
do $dup$ begin create policy "incoming_inventory_admin_delete" on public.incoming_inventory as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower((auth.jwt() ->> 'email'::text)))) AND (au.is_active IS TRUE))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "incoming_inventory_admin_insert" on public.incoming_inventory as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower((auth.jwt() ->> 'email'::text)))) AND (au.is_active IS TRUE))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "incoming_inventory_admin_select" on public.incoming_inventory as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower((auth.jwt() ->> 'email'::text)))) AND (au.is_active IS TRUE))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "incoming_inventory_admin_update" on public.incoming_inventory as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower((auth.jwt() ->> 'email'::text)))) AND (au.is_active IS TRUE))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower((auth.jwt() ->> 'email'::text)))) AND (au.is_active IS TRUE))))); exception when duplicate_object then null; end $dup$;
alter table public.inventory_movements enable row level security;
do $dup$ begin create policy "Admins can insert inventory movements" on public.inventory_movements as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can read inventory movements" on public.inventory_movements as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.manual_customers enable row level security;
do $dup$ begin create policy "Active admins create manual customers" on public.manual_customers as permissive for insert to authenticated with check (((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = auth.uid()) AND (a.is_active = true)))) AND (created_by = auth.uid()))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins read manual customers" on public.manual_customers as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = auth.uid()) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins update manual customers" on public.manual_customers as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = auth.uid()) AND (a.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = auth.uid()) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.operating_expenses enable row level security;
do $dup$ begin create policy "Active admins can delete operating expenses" on public.operating_expenses as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins can insert operating expenses" on public.operating_expenses as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins can read operating expenses" on public.operating_expenses as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins can update operating expenses" on public.operating_expenses as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (lower(au.email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.order_audit_log enable row level security;
do $dup$ begin create policy "Admins can read order audit log" on public.order_audit_log as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.order_items enable row level security;
do $dup$ begin create policy "Admins can delete all order items" on public.order_items as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can update all order items" on public.order_items as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can view all order items" on public.order_items as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can create order items for their own orders" on public.order_items as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.id = order_items.order_id) AND (orders.customer_id = auth.uid()))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can view their own order items" on public.order_items as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.id = order_items.order_id) AND (orders.customer_id = auth.uid()))))); exception when duplicate_object then null; end $dup$;
alter table public.order_shipment_items enable row level security;
do $dup$ begin create policy "Admin shipment items access" on public.order_shipment_items as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.order_shipments enable row level security;
do $dup$ begin create policy "Admin shipment access" on public.order_shipments as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = ( SELECT auth.uid() AS uid)) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.orders enable row level security;
do $dup$ begin create policy "Admins can delete all orders" on public.orders as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can update all orders" on public.orders as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can view all orders" on public.orders as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can create their own orders" on public.orders as permissive for insert to authenticated with check ((auth.uid() = customer_id)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can view their own orders" on public.orders as permissive for select to authenticated using ((auth.uid() = customer_id)); exception when duplicate_object then null; end $dup$;
alter table public.product_availability_requests enable row level security;
do $dup$ begin create policy "pst_availability_admin_read" on public.product_availability_requests as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "pst_availability_admin_update" on public.product_availability_requests as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.product_catalog enable row level security;
do $dup$ begin create policy "Admins can delete product catalog" on public.product_catalog as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can insert product catalog" on public.product_catalog as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can read product catalog" on public.product_catalog as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can update product catalog" on public.product_catalog as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Public can read active product catalog" on public.product_catalog as permissive for select to anon, authenticated using ((is_active = true)); exception when duplicate_object then null; end $dup$;
alter table public.product_inventory enable row level security;
do $dup$ begin create policy "Admins can delete product inventory" on public.product_inventory as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can insert product inventory" on public.product_inventory as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can read product inventory" on public.product_inventory as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can update product inventory" on public.product_inventory as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.product_key_aliases enable row level security;
do $dup$ begin create policy "Product key aliases are readable" on public.product_key_aliases as permissive for select to anon, authenticated using (true); exception when duplicate_object then null; end $dup$;
alter table public.pst_email_promos enable row level security;
do $dup$ begin create policy "owners manage email promos" on public.pst_email_promos as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_inbox enable row level security;
do $dup$ begin create policy "mark own inbox read" on public.pst_inbox as permissive for update to authenticated using ((((role = 'customer'::text) AND (user_id = auth.uid())) OR ((role = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "read own inbox" on public.pst_inbox as permissive for select to authenticated using ((((role = 'customer'::text) AND (user_id = auth.uid())) OR ((role = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_notify_prefs enable row level security;
do $dup$ begin create policy "own alert settings" on public.pst_notify_prefs as permissive for all to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid())); exception when duplicate_object then null; end $dup$;
alter table public.pst_payment_matches enable row level security;
do $dup$ begin create policy "owner confirms payment matches" on public.pst_payment_matches as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "owner reads payment matches" on public.pst_payment_matches as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_product_cycles enable row level security;
do $dup$ begin create policy "cycles are public" on public.pst_product_cycles as permissive for select to anon, authenticated using (true); exception when duplicate_object then null; end $dup$;
alter table public.pst_protocols enable row level security;
do $dup$ begin create policy "owner reads protocols" on public.pst_protocols as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "owner writes protocols" on public.pst_protocols as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_push_subscriptions enable row level security;
do $dup$ begin create policy "own devices readable" on public.pst_push_subscriptions as permissive for select to authenticated using ((user_id = auth.uid())); exception when duplicate_object then null; end $dup$;
alter table public.pst_releases enable row level security;
do $dup$ begin create policy "owners read releases" on public.pst_releases as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_sms_campaigns enable row level security;
do $dup$ begin create policy "owners read sms campaigns" on public.pst_sms_campaigns as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_sms_log enable row level security;
do $dup$ begin create policy "owners read sms log" on public.pst_sms_log as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_sms_settings enable row level security;
do $dup$ begin create policy "owners manage sms settings" on public.pst_sms_settings as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_support_shots enable row level security;
do $dup$ begin create policy "owners manage shots" on public.pst_support_shots as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_support_tickets enable row level security;
do $dup$ begin create policy "owners manage tickets" on public.pst_support_tickets as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.is_active AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_vendor_catalog_items enable row level security;
do $dup$ begin create policy "vendor_catalog_read_admin" on public.pst_vendor_catalog_items as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = auth.uid()) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_vendor_prices enable row level security;
do $dup$ begin create policy "pst_vendor_prices_admin_select" on public.pst_vendor_prices as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users a
  WHERE ((a.user_id = auth.uid()) AND (a.is_active = true))))); exception when duplicate_object then null; end $dup$;
alter table public.pst_web_events enable row level security;
do $dup$ begin create policy "owner reads web events" on public.pst_web_events as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.is_active = true) AND ((au.user_id = auth.uid()) OR (au.email = (auth.jwt() ->> 'email'::text))))))); exception when duplicate_object then null; end $dup$;
alter table public.saved_report_templates enable row level security;
do $dup$ begin create policy "Active admins can create saved report templates" on public.saved_report_templates as permissive for insert to authenticated with check ((( SELECT is_pst_admin() AS is_pst_admin) AND (created_by = ( SELECT auth.uid() AS uid)))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins can delete saved report templates" on public.saved_report_templates as permissive for delete to authenticated using (( SELECT is_pst_admin() AS is_pst_admin)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins can update saved report templates" on public.saved_report_templates as permissive for update to authenticated using (( SELECT is_pst_admin() AS is_pst_admin)) with check (( SELECT is_pst_admin() AS is_pst_admin)); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Active admins can view saved report templates" on public.saved_report_templates as permissive for select to authenticated using (( SELECT is_pst_admin() AS is_pst_admin)); exception when duplicate_object then null; end $dup$;
alter table public.site_payment_options enable row level security;
do $dup$ begin create policy "Admins can read payment options" on public.site_payment_options as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((lower(au.email) = lower((auth.jwt() ->> 'email'::text))) AND (COALESCE(au.is_active, true) = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admins can write payment options" on public.site_payment_options as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((lower(au.email) = lower((auth.jwt() ->> 'email'::text))) AND (COALESCE(au.is_active, true) = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((lower(au.email) = lower((auth.jwt() ->> 'email'::text))) AND (COALESCE(au.is_active, true) = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Customers can read payment options" on public.site_payment_options as permissive for select to authenticated using (true); exception when duplicate_object then null; end $dup$;
alter table public.site_promotions enable row level security;
do $dup$ begin create policy "Admins can manage site promotions" on public.site_promotions as permissive for all to public using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = auth.uid()) AND (au.is_active = true))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Public can read active site promotions" on public.site_promotions as permissive for select to public using (((is_active = true) AND ((starts_at IS NULL) OR (starts_at <= now())) AND ((ends_at IS NULL) OR (ends_at >= now())))); exception when duplicate_object then null; end $dup$;
alter table public.store_credit_transactions enable row level security;
do $dup$ begin create policy "Admins can read store credit" on public.store_credit_transactions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (lower(au.email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))); exception when duplicate_object then null; end $dup$;
alter table public.vendors enable row level security;
do $dup$ begin create policy "Admin users can delete vendors" on public.vendors as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.email = (auth.jwt() ->> 'email'::text))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admin users can insert vendors" on public.vendors as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.email = (auth.jwt() ->> 'email'::text))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admin users can read vendors" on public.vendors as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.email = (auth.jwt() ->> 'email'::text))))); exception when duplicate_object then null; end $dup$;
do $dup$ begin create policy "Admin users can update vendors" on public.vendors as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.email = (auth.jwt() ->> 'email'::text))))) with check ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE (admin_users.email = (auth.jwt() ->> 'email'::text))))); exception when duplicate_object then null; end $dup$;
