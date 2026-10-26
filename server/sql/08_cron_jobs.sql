select cron.schedule('pst-free-vial-waitlist', '* * * * *', $$select public.pst_process_free_vial_waitlist()$$);
select cron.schedule('pst-expire-unpaid-orders', '*/5 * * * *', $$select public.pst_expire_unpaid_orders()$$);
-- (dropped for Patriot: pst-availability-restock-notify called an edge function that was never deployed)
-- (dropped for Patriot: pst-availability-admin-email-retry called an edge function that was never deployed)
select cron.schedule('pst-reorder-reminders', '0 15 * * *', $$
  select net.http_post(
    url := 'https://__PPU_SUPABASE_REF__.supabase.co/functions/v1/pst-push',
    body := '{"event":"reminders"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', (select value from public.pst_app_secrets where key = 'hook_key')),
    timeout_milliseconds := 20000);
$$);
select cron.schedule('pst-learn-cycles', '30 8 * * *', $$ select public.pst_refresh_product_cycles(); $$);
