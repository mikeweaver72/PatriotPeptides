-- 99c (Nov 3 2026): Supabase flagged rls_disabled_in_public. These internal tables are only used by
-- SECURITY DEFINER functions (owner postgres) and service-role edge functions, so RLS with no policies
-- blocks direct public access without breaking anything.
alter table public.promotion_redemptions enable row level security;
alter table public.pst_app_secrets enable row level security;
alter table public.pst_backorder_allocations enable row level security;
alter table public.pst_complimentary_order_additions enable row level security;
alter table public.pst_lab_testing_adjustments enable row level security;
alter table public.pst_notify_log enable row level security;
alter table public.pst_order_reward_choices enable row level security;
alter table public.pst_promotion_eligible_customers enable row level security;
alter table public.pst_promotion_reward_options enable row level security;
revoke all on public.pst_app_secrets from anon, authenticated;
