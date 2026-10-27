-- Patriot (Oct 27, 2026), migration ppu_email_log_and_shipped_flag:
-- the owner app logs every email to order_audit_log, but there was no insert policy, so logs silently failed;
-- orders.shipping_email_sent_at didn't exist, so "shipped email sent" was never recorded. Both fixed.
alter table public.orders add column if not exists shipping_email_sent_at timestamptz;
create policy "Admins can add order audit log" on public.order_audit_log for insert to authenticated
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid() and coalesce(a.is_active, true)));
