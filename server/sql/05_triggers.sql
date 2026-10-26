-- private-schema helpers referenced by bulk_requests triggers (PST keeps these outside public; rebuilt here from the audit table shape)
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
DROP TRIGGER IF EXISTS bulk_requests_audit ON public.bulk_requests;
CREATE TRIGGER bulk_requests_audit AFTER INSERT OR UPDATE ON public.bulk_requests FOR EACH ROW EXECUTE FUNCTION private.audit_bulk_request_change();
DROP TRIGGER IF EXISTS bulk_requests_prepare_update ON public.bulk_requests;
CREATE TRIGGER bulk_requests_prepare_update BEFORE UPDATE ON public.bulk_requests FOR EACH ROW EXECUTE FUNCTION private.prepare_bulk_request_update();
DROP TRIGGER IF EXISTS pst_owner_bulk_alert ON public.bulk_requests;
CREATE TRIGGER pst_owner_bulk_alert AFTER INSERT ON public.bulk_requests FOR EACH ROW EXECUTE FUNCTION pst_owner_event_hook();
DROP TRIGGER IF EXISTS pst_owner_signup_alert ON public.customer_profiles;
CREATE TRIGGER pst_owner_signup_alert AFTER INSERT ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION pst_owner_event_hook();
DROP TRIGGER IF EXISTS trg_assign_customer_number ON public.customer_profiles;
CREATE TRIGGER trg_assign_customer_number BEFORE INSERT ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION assign_customer_number();
DROP TRIGGER IF EXISTS set_incoming_inventory_updated_at ON public.incoming_inventory;
CREATE TRIGGER set_incoming_inventory_updated_at BEFORE UPDATE ON public.incoming_inventory FOR EACH ROW EXECUTE FUNCTION set_incoming_inventory_updated_at();
DROP TRIGGER IF EXISTS pst_allocate_receipts_to_backorders ON public.inventory_movements;
CREATE TRIGGER pst_allocate_receipts_to_backorders AFTER INSERT ON public.inventory_movements FOR EACH ROW WHEN (((new.movement_type = 'incoming_received'::text) AND (new.quantity_change > 0))) EXECUTE FUNCTION pst_allocate_on_inventory_receipt();
DROP TRIGGER IF EXISTS trg_assign_manual_customer_number ON public.manual_customers;
CREATE TRIGGER trg_assign_manual_customer_number BEFORE INSERT ON public.manual_customers FOR EACH ROW EXECUTE FUNCTION assign_customer_number();
DROP TRIGGER IF EXISTS set_operating_expenses_updated_at ON public.operating_expenses;
CREATE TRIGGER set_operating_expenses_updated_at BEFORE UPDATE ON public.operating_expenses FOR EACH ROW EXECUTE FUNCTION set_operating_expenses_updated_at();
DROP TRIGGER IF EXISTS pst_reserve_new_order_line ON public.order_items;
CREATE TRIGGER pst_reserve_new_order_line AFTER INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION pst_inventory_reserve_order_line();
DROP TRIGGER IF EXISTS pst_allocate_backorders_on_paid ON public.orders;
CREATE TRIGGER pst_allocate_backorders_on_paid AFTER UPDATE OF payment_status ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_allocate_backorders_when_paid();
DROP TRIGGER IF EXISTS pst_new_order_payment_deadline ON public.orders;
CREATE TRIGGER pst_new_order_payment_deadline BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_order_set_payment_deadline();
DROP TRIGGER IF EXISTS pst_orders_notify_ins ON public.orders;
CREATE TRIGGER pst_orders_notify_ins AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_notify_hook();
DROP TRIGGER IF EXISTS pst_orders_notify_upd ON public.orders;
CREATE TRIGGER pst_orders_notify_upd AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_notify_hook();
DROP TRIGGER IF EXISTS pst_paid_order_reward ON public.orders;
CREATE TRIGGER pst_paid_order_reward AFTER UPDATE OF payment_status ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_paid_order_reward_trigger();
DROP TRIGGER IF EXISTS pst_record_order_discount_usage_trigger ON public.orders;
CREATE TRIGGER pst_record_order_discount_usage_trigger AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_record_order_discount_usage();
DROP TRIGGER IF EXISTS pst_release_cancelled_backorders ON public.orders;
CREATE TRIGGER pst_release_cancelled_backorders AFTER UPDATE OF order_status, status ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_release_cancelled_backorders();
DROP TRIGGER IF EXISTS pst_restore_new_cancelled_order ON public.orders;
CREATE TRIGGER pst_restore_new_cancelled_order AFTER UPDATE OF order_status, status ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_restore_cancelled_inventory();
DROP TRIGGER IF EXISTS pst_validate_order_discount_trigger ON public.orders;
CREATE TRIGGER pst_validate_order_discount_trigger BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION pst_validate_order_discount();
DROP TRIGGER IF EXISTS trg_assign_refund_number_if_needed ON public.orders;
CREATE TRIGGER trg_assign_refund_number_if_needed BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION assign_refund_number_if_needed();
DROP TRIGGER IF EXISTS trg_generate_order_number ON public.orders;
CREATE TRIGGER trg_generate_order_number BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION generate_order_number();
DROP TRIGGER IF EXISTS trg_log_order_audit_changes ON public.orders;
CREATE TRIGGER trg_log_order_audit_changes AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION log_order_audit_changes();
DROP TRIGGER IF EXISTS pst_availability_admin_alert_new ON public.product_availability_requests;
CREATE TRIGGER pst_availability_admin_alert_new AFTER INSERT ON public.product_availability_requests FOR EACH ROW EXECUTE FUNCTION pst_ping_availability_admin_alert();
DROP TRIGGER IF EXISTS pst_owner_request_alert ON public.product_availability_requests;
CREATE TRIGGER pst_owner_request_alert AFTER INSERT ON public.product_availability_requests FOR EACH ROW EXECUTE FUNCTION pst_owner_event_hook();
DROP TRIGGER IF EXISTS pst_auto_label_color ON public.product_catalog;
CREATE TRIGGER pst_auto_label_color BEFORE INSERT OR UPDATE OF label_color, display_name ON public.product_catalog FOR EACH ROW EXECUTE FUNCTION pst_auto_label_color();
DROP TRIGGER IF EXISTS pst_clear_coming_soon ON public.product_inventory;
CREATE TRIGGER pst_clear_coming_soon AFTER UPDATE OF current_inventory ON public.product_inventory FOR EACH ROW EXECUTE FUNCTION pst_clear_coming_soon();
DROP TRIGGER IF EXISTS pst_owner_soldout_alert ON public.product_inventory;
CREATE TRIGGER pst_owner_soldout_alert AFTER UPDATE OF current_inventory ON public.product_inventory FOR EACH ROW EXECUTE FUNCTION pst_owner_event_hook();
DROP TRIGGER IF EXISTS trg_sync_product_catalog_from_inventory ON public.product_inventory;
CREATE TRIGGER trg_sync_product_catalog_from_inventory AFTER INSERT OR UPDATE OF price, current_inventory, low_stock_threshold, limited_stock_threshold, is_active, display_name, strength ON public.product_inventory FOR EACH ROW EXECUTE FUNCTION sync_product_catalog_from_inventory();
DROP TRIGGER IF EXISTS pst_ticket_alert ON public.pst_support_tickets;
CREATE TRIGGER pst_ticket_alert AFTER INSERT OR UPDATE OF followups, status ON public.pst_support_tickets FOR EACH ROW EXECUTE FUNCTION pst_ticket_hook();
DROP TRIGGER IF EXISTS trg_site_promotions_updated_at ON public.site_promotions;
CREATE TRIGGER trg_site_promotions_updated_at BEFORE UPDATE ON public.site_promotions FOR EACH ROW EXECUTE FUNCTION set_site_promotions_updated_at();
