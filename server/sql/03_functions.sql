set local check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.admin_adjust_store_credit(p_customer_user_id uuid, p_customer_email text, p_amount_cents bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin_id uuid := auth.uid();
  v_admin_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_customer_email text := lower(trim(coalesce(p_customer_email, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_balance bigint;
begin
  if v_admin_id is null or not exists (
    select 1
    from public.admin_users au
    where au.user_id = v_admin_id
      and au.is_active = true
  ) then
    raise exception 'Active admin access required';
  end if;

  if p_amount_cents = 0 then
    raise exception 'Credit adjustment cannot be zero';
  end if;

  if length(v_customer_email) < 3 then
    raise exception 'Customer email is required';
  end if;

  if length(v_reason) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_customer_user_id::text, v_customer_email), 0));

  select coalesce(sum(t.amount_cents), 0)
    into v_balance
  from public.store_credit_transactions t
  where (p_customer_user_id is not null and t.customer_user_id = p_customer_user_id)
     or (p_customer_user_id is null and lower(t.customer_email) = v_customer_email);

  if v_balance + p_amount_cents < 0 then
    raise exception 'Adjustment would make the store-credit balance negative';
  end if;

  insert into public.store_credit_transactions (
    customer_user_id,
    customer_email,
    amount_cents,
    reason,
    created_by,
    created_by_email
  ) values (
    p_customer_user_id,
    v_customer_email,
    p_amount_cents,
    v_reason,
    v_admin_id,
    v_admin_email
  );

  v_balance := v_balance + p_amount_cents;
  return jsonb_build_object('balance_cents', v_balance);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_create_manual_order(p_customer_source text, p_customer_uuid uuid, p_lines jsonb, p_shipping numeric DEFAULT 0, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); cust record; v_order uuid; v_number text; v_subtotal numeric:=0; v_price numeric; v_qty integer; v_product record; v_line jsonb; v_email text; v_name text; v_user uuid; v_cnum text; v_addr text;v_city text;v_state text;v_zip text;v_phone text;
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor and is_active=true) then raise exception 'Administrator access required';end if;
 if p_customer_source='manual' then
  select * into cust from public.manual_customers where id=p_customer_uuid;
  if not found then raise exception 'Manual customer not found';end if;
  v_user:=null;
 elsif p_customer_source='online' then
  select * into cust from public.customer_profiles where user_id=p_customer_uuid;
  if not found then raise exception 'Customer not found';end if;
  v_user:=cust.user_id;
 else raise exception 'Invalid customer source';end if;
 v_email:=cust.email;v_name:=concat_ws(' ',cust.first_name,cust.last_name);
 v_cnum:='PST-C'||cust.customer_number::text;
 v_addr:=cust.shipping_address;v_city:=cust.shipping_city;v_state:=cust.shipping_state;v_zip:=cust.shipping_zip;v_phone:=cust.phone;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>50 then raise exception 'Choose 1 to 50 products';end if;
 if p_shipping<0 or p_shipping>10000 then raise exception 'Invalid shipping';end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  if not(v_line ? 'product_key') then raise exception 'Product selection missing';end if;
  select product_key,display_name,strength,price,is_active,category into v_product from public.product_catalog where product_key=v_line->>'product_key' and is_active=true;
  if not found then raise exception 'Unavailable product: %',v_line->>'product_key';end if;
  v_qty:= (v_line->>'quantity')::integer;
  if v_qty<1 or v_qty>500 then raise exception 'Quantity must be between 1 and 500';end if;
  v_price:=coalesce(v_product.price,0);
  v_subtotal:=v_subtotal+v_price*v_qty;
 end loop;
 insert into public.orders(customer_id,user_id,customer_email,customer_number,shipping_name,shipping_email,shipping_phone,shipping_address_line1,shipping_city,shipping_state,shipping_zip,subtotal,shipping,tax,total,status,order_status,payment_status,admin_notes,storefront)
 values(v_user,v_user,v_email,v_cnum,v_name,v_email,v_phone,v_addr,v_city,v_state,v_zip,round(v_subtotal,2),p_shipping,0,round(v_subtotal+p_shipping,2),'Pending','pending','Pending',concat('Created manually by admin. ',coalesce(left(p_notes,1000),'')),'peptides')
 returning id,order_number into v_order,v_number;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  select product_key,display_name,strength,price,category into v_product from public.product_catalog where product_key=v_line->>'product_key';
  v_qty:=(v_line->>'quantity')::integer;
  insert into public.order_items(order_id,product_key,product_name,product_strength,product_category,quantity,unit_price,line_total)
  values(v_order,v_product.product_key,v_product.display_name,v_product.strength,v_product.category,v_qty,coalesce(v_product.price,0),round(coalesce(v_product.price,0)*v_qty,2));
 end loop;
 return jsonb_build_object('id',v_order,'order_number',v_number,'total',round(v_subtotal+p_shipping,2));
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_set_discount_customer_assignments(p_discount_id uuid, p_audience text, p_customer_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer := 0;
  v_audience text := lower(trim(coalesce(p_audience,'')));
begin
  if auth.uid() is null or not public.is_pst_admin() then
    raise exception 'Active admin access is required.';
  end if;
  if v_audience not in ('all','selected') then
    raise exception 'Audience must be all or selected.';
  end if;
  if not exists (select 1 from public.discount_codes where id=p_discount_id) then
    raise exception 'Discount not found.';
  end if;

  update public.discount_codes
     set audience=v_audience, assigned_email=null, updated_at=now()
   where id=p_discount_id;

  delete from public.discount_customer_assignments where discount_id=p_discount_id;

  if v_audience='selected' then
    insert into public.discount_customer_assignments(discount_id, customer_id, created_by)
    select p_discount_id, p.user_id, auth.uid()
    from public.customer_profiles p
    join (select distinct unnest(coalesce(p_customer_ids,'{}'::uuid[])) as customer_id) chosen
      on chosen.customer_id=p.user_id
    on conflict do nothing;
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_customer_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.customer_number is null then
    new.customer_number := nextval('public.customer_number_seq');
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_refund_number_if_needed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new_status text := lower(coalesce(new.status, ''));
  v_new_order_status text := lower(coalesce(new.order_status, ''));
  v_new_payment_status text := lower(coalesce(new.payment_status, ''));
  v_old_payment_status text := lower(coalesce(old.payment_status, ''));
  v_refund_action boolean := false;
  v_paid_related boolean := false;
begin
  v_refund_action :=
    v_new_status in ('cancelled','canceled','rejected','refunded')
    or v_new_order_status in ('cancelled','canceled','rejected','refunded')
    or v_new_payment_status = 'refunded';

  v_paid_related :=
    v_new_payment_status in ('paid','refunded')
    or v_old_payment_status in ('paid','refunded');

  if v_refund_action and v_paid_related then
    if new.refund_number is null then
      new.refund_number := nextval('public.refund_number_seq');
    end if;

    if new.refund_amount is null or new.refund_amount = 0 then
      new.refund_amount := coalesce(new.total, 0);
    end if;

    if new.refund_requested_at is null then
      new.refund_requested_at := now();
    end if;

    if v_new_payment_status = 'refunded' then
      new.refund_status := coalesce(nullif(new.refund_status, ''), 'issued');
      if new.refund_issued_at is null then
        new.refund_issued_at := now();
      end if;
    else
      new.refund_status := coalesce(nullif(new.refund_status, ''), 'pending');
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.deduct_inventory_for_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_problem_count integer := 0;
  v_problems jsonb := '[]'::jsonb;
  v_item record;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'order_not_found', 'message', 'Order was not found.');
  end if;

  if auth.uid() is not null and v_order.customer_id is not null and v_order.customer_id <> auth.uid() then
    return jsonb_build_object('success', false, 'reason', 'not_order_owner', 'message', 'This order does not belong to the current user.');
  end if;

  if coalesce(v_order.inventory_deducted, false) then
    return jsonb_build_object('success', true, 'already_deducted', true, 'message', 'Inventory was already deducted for this order.');
  end if;

  perform 1
  from public.product_inventory pi
  join (
    select coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key) as product_key,
           sum(oi.quantity)::integer as requested_qty
    from public.order_items oi
    left join public.product_catalog pc on pc.id::text = oi.product_id
    left join public.product_inventory direct_pi on direct_pi.product_key = oi.product_id
    where oi.order_id = p_order_id and oi.unit_price > 0
    group by coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key)
  ) resolved on resolved.product_key = pi.product_key
  order by pi.product_key
  for update of pi;

  for v_item in
    select resolved.stored_product_id,
           resolved.product_key,
           resolved.requested_qty,
           pi.id as inventory_id,
           pi.display_name,
           pi.current_inventory,
           pi.is_active
    from (
      select min(oi.product_id) as stored_product_id,
             coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key) as product_key,
             sum(oi.quantity)::integer as requested_qty
      from public.order_items oi
      left join public.product_catalog pc on pc.id::text = oi.product_id
      left join public.product_inventory direct_pi on direct_pi.product_key = oi.product_id
      where oi.order_id = p_order_id and oi.unit_price > 0
      group by coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key)
    ) resolved
    left join public.product_inventory pi on pi.product_key = resolved.product_key
    order by resolved.product_key nulls first
  loop
    if v_item.product_key is null or v_item.inventory_id is null then
      v_problem_count := v_problem_count + 1;
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'product_id', v_item.stored_product_id,
        'product_name', v_item.stored_product_id,
        'requested', v_item.requested_qty,
        'available', 0,
        'message', 'No exact PST item-number mapping exists for order item ' || coalesce(v_item.stored_product_id, '(blank)') || '.'
      ));
    elsif coalesce(v_item.is_active, true) = false then
      v_problem_count := v_problem_count + 1;
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'product_id', v_item.product_key,
        'product_name', coalesce(v_item.display_name, v_item.product_key),
        'requested', v_item.requested_qty,
        'available', 0,
        'message', coalesce(v_item.display_name, v_item.product_key) || ' is no longer available.'
      ));
    elsif coalesce(v_item.current_inventory, 0) < v_item.requested_qty then
      v_problem_count := v_problem_count + 1;
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'product_id', v_item.product_key,
        'product_name', coalesce(v_item.display_name, v_item.product_key),
        'requested', v_item.requested_qty,
        'available', coalesce(v_item.current_inventory, 0),
        'message', coalesce(v_item.display_name, v_item.product_key) || ': only ' || coalesce(v_item.current_inventory, 0) || ' available.'
      ));
    end if;
  end loop;

  if v_problem_count > 0 then
    update public.orders
    set inventory_failure_reason = v_problems::text, updated_at = now()
    where id = p_order_id;
    return jsonb_build_object('success', false, 'reason', 'inventory_match_failed', 'message', 'Inventory could not be matched by exact PST item number.', 'problems', v_problems);
  end if;

  for v_item in
    select resolved.product_key,
           resolved.requested_qty,
           pi.id as inventory_id,
           pi.display_name,
           pi.current_inventory
    from (
      select coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key) as product_key,
             sum(oi.quantity)::integer as requested_qty
      from public.order_items oi
      left join public.product_catalog pc on pc.id::text = oi.product_id
      left join public.product_inventory direct_pi on direct_pi.product_key = oi.product_id
      where oi.order_id = p_order_id and oi.unit_price > 0
      group by coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key)
    ) resolved
    join public.product_inventory pi on pi.product_key = resolved.product_key
    order by resolved.product_key
  loop
    update public.product_inventory
    set current_inventory = current_inventory - v_item.requested_qty, updated_at = now()
    where id = v_item.inventory_id;

    insert into public.inventory_movements (
      product_id, product_key, movement_type, quantity_change,
      previous_quantity, new_quantity, admin_note, created_by, created_by_email
    ) values (
      v_item.inventory_id, v_item.product_key, 'sold_checkout', -v_item.requested_qty,
      v_item.current_inventory, v_item.current_inventory - v_item.requested_qty,
      'Inventory automatically deducted by exact PST item number for order ' || p_order_id::text,
      auth.uid(), auth.jwt() ->> 'email'
    );
  end loop;

  update public.orders
  set inventory_deducted = true,
      inventory_restored = false,
      inventory_deducted_at = now(),
      inventory_failure_reason = null,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'message', 'Inventory deducted successfully by exact PST item number.', 'order_id', p_order_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.generate_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.order_sequence_number is null then
    new.order_sequence_number := nextval('public.order_number_seq');
  end if;

  if new.order_number is null or new.order_number !~ '^PST-O[0-9]+$' then
    if new.legacy_order_number is null and new.order_number is not null then
      new.legacy_order_number := new.order_number;
    end if;
    new.order_number := 'PST-O' || new.order_sequence_number::text;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_active_discount_by_code(p_code text)
 RETURNS TABLE(promotion_id uuid, discount_id uuid, code text, discount_type text, percent_off numeric, amount_off numeric, audience text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ctx as (
    select
      auth.uid() as uid,
      lower(coalesce(auth.jwt() ->> 'email', '')) as email
  ), dc_row as (
    select dc.*
    from public.discount_codes dc
    where upper(dc.code) = upper(trim(p_code))
      and dc.active = true
      and (dc.expires_at is null or dc.expires_at >= now())
    order by dc.created_at desc
    limit 1
  ), promo_row as (
    select sp.*
    from public.site_promotions sp
    join dc_row dc on dc.id = sp.discount_id
    where sp.is_active = true
      and (sp.starts_at is null or sp.starts_at <= now())
      and (sp.ends_at is null or sp.ends_at >= now())
    order by sp.sort_order asc, sp.created_at desc
    limit 1
  )
  select
    pr.id as promotion_id,
    dc.id as discount_id,
    dc.code,
    dc.discount_type,
    dc.percent_off,
    dc.amount_off,
    coalesce(pr.audience, 'public_all') as audience
  from dc_row dc
  cross join ctx
  left join promo_row pr on true
  where (
    case coalesce(pr.audience, 'public_all')
      when 'public_all' then (coalesce(trim(dc.assigned_email), '') = '' or (ctx.uid is not null and lower(dc.assigned_email) = ctx.email))
      when 'new_customers' then (
        coalesce(trim(dc.assigned_email), '') = ''
        and (
          ctx.uid is null
          or (
            public.pst_user_created_for_promo(ctx.uid, ctx.email, pr.starts_at) = true
            and public.pst_user_has_prior_real_order(ctx.uid, ctx.email) = false
            and public.pst_user_has_used_discount(dc.id, dc.code, ctx.uid, ctx.email) = false
          )
        )
      )
      when 'logged_in_customers' then (ctx.uid is not null and (coalesce(trim(dc.assigned_email), '') = '' or lower(dc.assigned_email) = ctx.email))
      when 'assigned_customers' then (ctx.uid is not null and coalesce(trim(dc.assigned_email), '') <> '' and lower(dc.assigned_email) = ctx.email)
      when 'admin_test' then exists (select 1 from public.admin_users au where au.user_id = ctx.uid and au.is_active = true)
      else false
    end
  )
  limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_active_promotion_discount(p_promotion_id uuid)
 RETURNS TABLE(promotion_id uuid, discount_id uuid, code text, discount_type text, percent_off numeric, amount_off numeric, audience text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ctx as (
    select
      auth.uid() as uid,
      lower(coalesce(auth.jwt() ->> 'email', '')) as email
  )
  select
    sp.id as promotion_id,
    dc.id as discount_id,
    dc.code,
    dc.discount_type,
    dc.percent_off,
    dc.amount_off,
    sp.audience
  from public.site_promotions sp
  join public.discount_codes dc on dc.id = sp.discount_id
  cross join ctx
  where sp.id = p_promotion_id
    and sp.is_active = true
    and sp.auto_apply_discount = true
    and (sp.starts_at is null or sp.starts_at <= now())
    and (sp.ends_at is null or sp.ends_at >= now())
    and dc.active = true
    and (dc.expires_at is null or dc.expires_at >= now())
    and (
      case coalesce(sp.audience, 'public_all')
        when 'public_all' then (coalesce(trim(dc.assigned_email), '') = '' or (ctx.uid is not null and lower(dc.assigned_email) = ctx.email))
        when 'new_customers' then (
          coalesce(trim(dc.assigned_email), '') = ''
          and (
            ctx.uid is null
            or (
              public.pst_user_created_for_promo(ctx.uid, ctx.email, sp.starts_at) = true
              and public.pst_user_has_prior_real_order(ctx.uid, ctx.email) = false
              and public.pst_user_has_used_discount(dc.id, dc.code, ctx.uid, ctx.email) = false
            )
          )
        )
        when 'logged_in_customers' then (ctx.uid is not null and (coalesce(trim(dc.assigned_email), '') = '' or lower(dc.assigned_email) = ctx.email))
        when 'assigned_customers' then (ctx.uid is not null and coalesce(trim(dc.assigned_email), '') <> '' and lower(dc.assigned_email) = ctx.email)
        when 'admin_test' then exists (select 1 from public.admin_users au where au.user_id = ctx.uid and au.is_active = true)
        else false
      end
    )
  limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_product_incoming_status(p_product_keys text[])
 RETURNS TABLE(product_key text, incoming_quantity integer, incoming_status text, incoming_expected_arrival_date timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    ii.product_key,
    sum(greatest(coalesce(ii.ordered_quantity, 0) - coalesce(ii.received_quantity, 0), 0))::integer as incoming_quantity,
    case
      when bool_or(lower(ii.status) = 'in_transit') then 'in_transit'
      else 'ordered'
    end as incoming_status,
    min(ii.expected_arrival_date) as incoming_expected_arrival_date
  from public.incoming_inventory ii
  where ii.product_key is not null
    and ii.product_key = any(coalesce(p_product_keys, array[]::text[]))
    and cardinality(coalesce(p_product_keys, array[]::text[])) <= 200
    and lower(ii.status) in ('ordered', 'in_transit')
    and greatest(coalesce(ii.ordered_quantity, 0) - coalesce(ii.received_quantity, 0), 0) > 0
  group by ii.product_key;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_customer_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  m jsonb;
  marketing_selected boolean;
  requested_username text;
  safe_username text;
begin
  m := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  marketing_selected := lower(coalesce(m->>'marketing_opt_in', 'false')) in ('true','1','yes','on');
  requested_username := nullif(trim(coalesce(m->>'username', '')), '');
  safe_username := requested_username;

  if safe_username is not null and exists (
    select 1
    from public.customer_profiles cp
    where lower(cp.username) = lower(safe_username)
      and cp.user_id <> new.id
  ) then
    safe_username := null;
  end if;

  insert into public.customer_profiles (
    user_id,
    first_name,
    last_name,
    email,
    phone,
    username,
    billing_address,
    billing_city,
    billing_state,
    billing_zip,
    shipping_address,
    shipping_city,
    shipping_state,
    shipping_zip,
    account_status,
    age_confirmed,
    research_use_acknowledged,
    tos_accepted,
    created_at,
    updated_at,
    marketing_opt_in,
    marketing_opt_out,
    marketing_opt_in_at,
    marketing_source,
    research_role,
    research_role_confirmed_at
  ) values (
    new.id,
    nullif(trim(coalesce(m->>'first_name', '')), ''),
    nullif(trim(coalesce(m->>'last_name', '')), ''),
    lower(new.email),
    nullif(trim(coalesce(m->>'phone', '')), ''),
    safe_username,
    nullif(trim(coalesce(m->>'billing_address', '')), ''),
    nullif(trim(coalesce(m->>'billing_city', '')), ''),
    nullif(trim(coalesce(m->>'billing_state', '')), ''),
    nullif(trim(coalesce(m->>'billing_zip', '')), ''),
    nullif(trim(coalesce(m->>'shipping_address', '')), ''),
    nullif(trim(coalesce(m->>'shipping_city', '')), ''),
    nullif(trim(coalesce(m->>'shipping_state', '')), ''),
    nullif(trim(coalesce(m->>'shipping_zip', '')), ''),
    'active',
    true,
    true,
    true,
    now(),
    now(),
    marketing_selected,
    false,
    case when marketing_selected then now() else null end,
    case when marketing_selected then coalesce(nullif(trim(coalesce(m->>'marketing_source', '')), ''), 'registration') else null end,
    nullif(trim(coalesce(m->>'research_role', '')), ''),
    now()
  )
  on conflict (user_id) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    username = coalesce(excluded.username, public.customer_profiles.username),
    billing_address = excluded.billing_address,
    billing_city = excluded.billing_city,
    billing_state = excluded.billing_state,
    billing_zip = excluded.billing_zip,
    shipping_address = excluded.shipping_address,
    shipping_city = excluded.shipping_city,
    shipping_state = excluded.shipping_state,
    shipping_zip = excluded.shipping_zip,
    updated_at = now(),
    marketing_opt_in = excluded.marketing_opt_in,
    marketing_opt_out = excluded.marketing_opt_out,
    marketing_opt_in_at = excluded.marketing_opt_in_at,
    marketing_source = excluded.marketing_source,
    research_role = excluded.research_role,
    research_role_confirmed_at = excluded.research_role_confirmed_at;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_pst_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
    and is_active = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.log_order_audit_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'order_received', 'order', null, coalesce(new.status, new.order_status, 'pending'), coalesce(new.last_admin_actor, 'System'), new.last_admin_actor_email);
    return new;
  end if;

  if coalesce(old.payment_status,'') is distinct from coalesce(new.payment_status,'') then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'payment_status_changed', 'payment_status', old.payment_status, new.payment_status, coalesce(new.last_admin_actor, 'Admin'), new.last_admin_actor_email);
  end if;

  if coalesce(old.status,'') is distinct from coalesce(new.status,'') then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'order_status_changed', 'status', old.status, new.status, coalesce(new.last_admin_actor, 'Admin'), new.last_admin_actor_email);
  end if;

  if coalesce(old.order_status,'') is distinct from coalesce(new.order_status,'') and coalesce(old.status,'') = coalesce(new.status,'') then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'order_status_changed', 'order_status', old.order_status, new.order_status, coalesce(new.last_admin_actor, 'Admin'), new.last_admin_actor_email);
  end if;

  if coalesce(old.tracking_number,'') is distinct from coalesce(new.tracking_number,'') then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'tracking_changed', 'tracking_number', old.tracking_number, new.tracking_number, coalesce(new.last_admin_actor, 'Admin'), new.last_admin_actor_email);
  end if;

  if coalesce(old.tracking_carrier,'') is distinct from coalesce(new.tracking_carrier,'') then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'tracking_carrier_changed', 'tracking_carrier', old.tracking_carrier, new.tracking_carrier, coalesce(new.last_admin_actor, 'Admin'), new.last_admin_actor_email);
  end if;

  if coalesce(old.no_tracking_required,false) is distinct from coalesce(new.no_tracking_required,false) then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'no_tracking_required_changed', 'no_tracking_required', old.no_tracking_required::text, new.no_tracking_required::text, coalesce(new.last_admin_actor, 'Admin'), new.last_admin_actor_email);
  end if;

  if coalesce(old.no_tracking_reason,'') is distinct from coalesce(new.no_tracking_reason,'') then
    insert into public.order_audit_log(order_id, order_number, action_type, field_name, old_value, new_value, changed_by, changed_by_email)
    values (new.id, new.order_number, 'no_tracking_reason_changed', 'no_tracking_reason', old.no_tracking_reason, new.no_tracking_reason, coalesce(new.last_admin_actor, 'Admin'), new.last_admin_actor_email);
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.next_incoming_po_number()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not public.is_pst_admin() then
    raise exception 'Active administrator access is required.'
      using errcode = '42501';
  end if;
  return 'PST-PO' || lpad(nextval('public.incoming_purchase_order_number_seq')::text, 6, '0');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pst_add_complimentary_order_item(p_order_id uuid, p_product_key text, p_quantity integer, p_shipment_id uuid, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.orders%rowtype;v_stock public.product_inventory%rowtype;v_item_id uuid;v_existing uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.admin_users a where a.is_active=true and (a.user_id=auth.uid() or a.email=auth.jwt()->>'email')) then raise exception 'Administrator access required';end if;
 if p_quantity is null or p_quantity<1 or p_quantity>500 then raise exception 'Quantity must be between 1 and 500';end if;
 if p_request_key is null then raise exception 'Missing request identifier';end if;
 select order_item_id into v_existing from public.pst_complimentary_order_additions where request_key=p_request_key;
 if found then return jsonb_build_object('success',true,'already_added',true,'order_item_id',v_existing);end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found then raise exception 'Order not found';end if;
 if lower(coalesce(v_order.order_status,'')) in ('cancelled','canceled','rejected','refunded') then raise exception 'Cannot add an item to a cancelled order';end if;
 if p_shipment_id is not null and not exists(select 1 from public.order_shipments where id=p_shipment_id and order_id=p_order_id) then raise exception 'Selected shipment does not belong to this order';end if;
 select * into v_stock from public.product_inventory where product_key=p_product_key for update;
 if not found then raise exception 'Inventory product not found';end if;
 if coalesce(v_stock.current_inventory,0)<p_quantity then raise exception 'Not enough stock for %, available %',p_product_key,v_stock.current_inventory;end if;
 insert into public.order_items(order_id,product_id,product_key,product_name,product_strength,product_category,quantity,unit_price,line_total)
 values(p_order_id,v_stock.product_key,v_stock.product_key,v_stock.display_name,v_stock.strength,v_stock.category,p_quantity,0,0) returning id into v_item_id;
 update public.product_inventory set current_inventory=current_inventory-p_quantity,updated_at=now() where id=v_stock.id;
 insert into public.inventory_movements(product_id,product_key,movement_type,quantity_change,previous_quantity,new_quantity,admin_note,created_by,created_by_email)
 values(v_stock.id,v_stock.product_key,'sold_checkout',-p_quantity,v_stock.current_inventory,v_stock.current_inventory-p_quantity,'Complimentary $0 item on order '||coalesce(v_order.order_number,p_order_id::text),auth.uid(),auth.jwt()->>'email');
 if p_shipment_id is not null then
 insert into public.order_shipment_items(shipment_id,order_item_id,quantity) values(p_shipment_id,v_item_id,p_quantity);
 end if;
 insert into public.pst_complimentary_order_additions(order_id,order_item_id,product_key,quantity,shipment_id,created_by,request_key)
 values(p_order_id,v_item_id,p_product_key,p_quantity,p_shipment_id,auth.uid(),p_request_key);
 return jsonb_build_object('success',true,'order_item_id',v_item_id);
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_admin_add_availability_notification(p_email text, p_product_key text, p_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.product_inventory%rowtype; new_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.admin_users a where a.is_active=true and a.user_id=auth.uid()) then raise exception 'Administrator access required';end if;
 if trim(coalesce(p_email,'')) !~* '^[^ @]+@[^ @]+[.][^ @]+$' then raise exception 'Invalid email address';end if;
 select * into v from public.product_inventory where product_key=p_product_key;
 if not found then raise exception 'Product not found';end if;
 if coalesce(v.current_inventory,0)>0 and v.status_override is distinct from 'out_of_stock' then raise exception 'This item has inventory. Choose an unavailable item for restock notifications';end if;
 if exists(select 1 from public.product_availability_requests where lower(customer_email)=lower(trim(p_email)) and product_key=p_product_key and notify_when_available and status='pending') then raise exception 'This email is already waiting for this product';end if;
 insert into public.product_availability_requests(product_key,product_name,product_strength,requested_quantity,customer_name,customer_email,notify_when_available,status)
 values(v.product_key,v.display_name,v.strength,1,coalesce(nullif(trim(p_name),''),'Email subscriber'),lower(trim(p_email)),true,'pending')
 returning id into new_id;
 return new_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_admin_change_order_item_quantity(p_order_id uuid, p_item_id uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare o public.orders%rowtype; li public.order_items%rowtype; old_qty integer; delta integer; inv_id uuid; new_sub numeric; new_total numeric;
begin
 if auth.uid() is null or not exists(select 1 from public.admin_users where user_id=auth.uid() and is_active=true) then raise exception 'Admin access required'; end if;
 if p_quantity < 1 then raise exception 'Quantity must be at least 1'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if lower(coalesce(o.order_status,o.status,'')) in ('shipped','delivered','cancelled','rejected','refunded') then raise exception 'Cannot edit items on a shipped or closed order'; end if;
 select * into li from public.order_items where id=p_item_id and order_id=p_order_id for update;
 if not found then raise exception 'Order item not found'; end if;
 old_qty:=li.quantity; delta:=p_quantity-old_qty;
 if delta=0 then return jsonb_build_object('quantity',p_quantity,'unchanged',true); end if;
 if coalesce(o.inventory_deducted,false) and not coalesce(o.inventory_restored,false) then
   select id into inv_id from public.product_inventory where product_key=li.product_key or id::text=li.product_id order by case when product_key=li.product_key then 0 else 1 end limit 1 for update;
   if inv_id is null then raise exception 'Inventory product not found; quantity unchanged'; end if;
   update public.product_inventory set current_inventory=current_inventory-delta,updated_at=now() where id=inv_id and current_inventory-delta >= 0;
   if not found then raise exception 'Insufficient inventory'; end if;
 end if;
 update public.order_items set quantity=p_quantity,line_total=round(p_quantity*coalesce(li.unit_price,0),2) where id=p_item_id;
 new_sub:=coalesce(o.subtotal,0)+delta*coalesce(li.unit_price,0);
 new_total:=coalesce(o.total,0)+delta*coalesce(li.unit_price,0);
 update public.orders set subtotal=greatest(0,new_sub),subtotal_before_discount=case when subtotal_before_discount is null then null else greatest(0,subtotal_before_discount+delta*coalesce(li.unit_price,0)) end,total=greatest(0,new_total),updated_at=now(),admin_note=concat_ws(E'\n',nullif(admin_note,''),'Quantity corrected from '||old_qty||' to '||p_quantity||' for '||li.product_name||' by admin on '||now()::text) where id=p_order_id;
 return jsonb_build_object('quantity',p_quantity,'previous_quantity',old_qty,'total',greatest(0,new_total));
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_admin_import_vendor_catalog(p_vendor_id uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; n int:=0; k text;
begin
 if not exists(select 1 from public.admin_users where user_id=auth.uid() and is_active=true) then raise exception 'Admin only'; end if;
 if not exists(select 1 from public.vendors where id=p_vendor_id) then raise exception 'Invalid vendor'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid data'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  k:=nullif(trim(r->>'product_key'),'');
  if k is not null and not exists(select 1 from public.product_inventory where product_key=k) then raise exception 'Unknown product key %',k;end if;
  insert into public.pst_vendor_catalog_items(vendor_id,vendor_item_number,product_name,strength,kit_cost,product_key)
  values(p_vendor_id,r->>'vendor_item_number',r->>'product_name',r->>'strength',(r->>'kit_cost')::numeric,k)
  on conflict(vendor_id,vendor_item_number,strength) do update set product_name=excluded.product_name,strength=excluded.strength,kit_cost=excluded.kit_cost,product_key=excluded.product_key,updated_at=now();
  if k is not null then
   insert into public.pst_vendor_prices(vendor_id,product_key,vendor_item_number,kit_cost)
   values(p_vendor_id,k,r->>'vendor_item_number',(r->>'kit_cost')::numeric)
   on conflict(vendor_id,product_key) do update set vendor_item_number=excluded.vendor_item_number,kit_cost=excluded.kit_cost,updated_at=now();
  end if;
  n:=n+1;
 end loop;
 return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_admin_order_vendor_only_item(p_item_id uuid, p_kits integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.pst_vendor_catalog_items%rowtype; v public.vendors%rowtype; po text; now_time timestamptz:=now();
begin
 if not exists(select 1 from public.admin_users where user_id=auth.uid() and is_active=true) then raise exception 'Admin only';end if;
 if p_kits is null or p_kits<1 or p_kits>10000 then raise exception 'Kits must be between 1 and 10000';end if;
 select * into i from public.pst_vendor_catalog_items where id=p_item_id;
 if not found then raise exception 'Vendor item not found'; end if;
 if i.product_key is not null then raise exception 'Matched item: use Inventory purchase order form';end if;
 select * into v from public.vendors where id=i.vendor_id;
 select public.next_incoming_po_number() into po;
 insert into public.incoming_inventory
 (po_number,product_id,product_key,product_name,ordered_quantity,kit_cost,kit_vial_count,cost_per_unit,shipping_cost,total_cost,supplier_name,status,ordered_at,expected_arrival_date,created_by,created_by_email,vendor_id,vendor_name,lead_time_days,notes)
 values(po,null,null,i.product_name||' — '||coalesce(i.strength,'')||' [Vendor SKU: '||i.vendor_item_number||']',p_kits*10,i.kit_cost,10,i.kit_cost/10,0,p_kits*i.kit_cost,v.company_name,'ordered',now_time,now_time+make_interval(days=>coalesce(v.standard_shipping_lead_time,10)),auth.uid()::text,auth.jwt()->>'email',v.id,v.company_name,coalesce(v.standard_shipping_lead_time,10),'UNMATCHED VENDOR PRODUCT — receiving must be manually matched before inventory addition');
 return po;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_admin_reduce_unshipped_item(p_order_id uuid, p_item_id uuid, p_remove_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders%rowtype; it public.order_items%rowtype; shipped integer; n integer; refund numeric; oldsubtotal numeric; oldtotal numeric; who uuid:=auth.uid(); invkey text; msg text;
        alloc integer:=0; from_bo integer:=0; from_alloc integer:=0; back_to_stock integer;
begin
 if who is null or not exists(select 1 from public.admin_users where user_id=who and is_active=true) then raise exception 'Admin access required'; end if;
 if p_remove_qty<1 then raise exception 'Quantity must be at least one'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 select * into it from public.order_items where id=p_item_id and order_id=p_order_id for update;
 if not found then raise exception 'Item not found'; end if;
 select coalesce(sum(si.quantity),0) into shipped from public.order_shipment_items si join public.order_shipments sh on sh.id=si.shipment_id where sh.order_id=p_order_id and si.order_item_id=p_item_id;
 if p_remove_qty>it.quantity-shipped then raise exception 'Cannot remove shipped units or more than the unshipped quantity'; end if;
 if it.quantity=p_remove_qty and (select count(*) from public.order_items where order_id=p_order_id)=1 then raise exception 'Cannot remove the only order item. Cancel the order through the controlled cancellation workflow.'; end if;
 oldsubtotal:=coalesce(o.subtotal,0);oldtotal:=coalesce(o.total,0); refund:=round(coalesce(it.unit_price,0)*p_remove_qty,2);
 back_to_stock:=p_remove_qty;
 if coalesce(it.backorder_quantity,0)>0 then
   select coalesce(quantity,0) into alloc from public.pst_backorder_allocations where order_item_id=it.id for update;
   alloc:=coalesce(alloc,0);
   from_bo:=least(p_remove_qty,greatest(0,it.backorder_quantity-alloc));
   from_alloc:=least(p_remove_qty-from_bo,alloc);
   if from_alloc>0 then
     if alloc-from_alloc>0 then update public.pst_backorder_allocations set quantity=alloc-from_alloc where order_item_id=it.id;
     else delete from public.pst_backorder_allocations where order_item_id=it.id; end if;
     update public.product_inventory set current_inventory=current_inventory+from_alloc where product_key=it.product_key;
   end if;
   back_to_stock:=p_remove_qty-from_bo-from_alloc;
 end if;
 if back_to_stock>0 and o.inventory_deducted=true and coalesce(o.inventory_restored,false)=false then
   invkey:=it.product_key;
   if invkey is null or invkey='' then raise exception 'Inventory product key missing; manual reconciliation required'; end if;
   update public.product_inventory set current_inventory=current_inventory+back_to_stock where product_key=invkey;
   if not found then raise exception 'Inventory record missing; manual reconciliation required'; end if;
 end if;
 n:=it.quantity-p_remove_qty;
 if n=0 then delete from public.order_items where id=it.id;
 else update public.order_items set quantity=n,line_total=round(coalesce(it.unit_price,0)*n,2),backorder_quantity=greatest(0,coalesce(it.backorder_quantity,0)-from_bo-from_alloc) where id=it.id;end if;
 msg:='Admin unshipped item reduction: '||coalesce(it.product_name,'Item')||' '||coalesce(it.product_strength,'')||' x'||p_remove_qty::text||'; order value reduced by $'||refund::text||'. Payment status unchanged; refund/credit must be handled separately.'
      ||case when from_bo>0 then ' ('||from_bo||' were unfilled backorder.)' else '' end;
 update public.orders set subtotal=greatest(0,oldsubtotal-refund),total=greatest(0,oldtotal-refund),updated_at=now(),admin_note=concat_ws(E'\n',nullif(o.admin_note,''),msg),admin_notes=concat_ws(E'\n',nullif(o.admin_notes,''),msg) where id=p_order_id;
 return jsonb_build_object('ok',true,'removed_quantity',p_remove_qty,'amount_reduced',refund,'remaining_on_line',n,'payment_status',o.payment_status,'refund_not_issued',true);
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_admin_save_vendor_prices(p_vendor_id uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry jsonb; c integer:=0;
begin
 if not exists(select 1 from public.admin_users a where a.user_id=auth.uid() and a.is_active=true) then raise exception 'Admin required';end if;
 if not exists(select 1 from public.vendors where id=p_vendor_id) then raise exception 'Unknown vendor';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid upload';end if;
 for entry in select value from jsonb_array_elements(p_rows) loop
  if not exists(select 1 from public.product_inventory where product_key=entry->>'product_key') then raise exception 'Unknown product key: %',entry->>'product_key';end if;
  insert into public.pst_vendor_prices(vendor_id,product_key,vendor_item_number,kit_cost,updated_at)
  values(p_vendor_id,entry->>'product_key',nullif(trim(entry->>'vendor_item_number'),''),(entry->>'kit_cost')::numeric,now())
  on conflict(vendor_id,product_key) do update set vendor_item_number=excluded.vendor_item_number,kit_cost=excluded.kit_cost,updated_at=now();
  c:=c+1;
 end loop;
 return c;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_allocate_backorders_when_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text;
begin
  if lower(coalesce(new.payment_status,''))='paid' and lower(coalesce(old.payment_status,''))<>'paid' then
    for k in select distinct product_key from public.order_items where order_id=new.id and coalesce(backorder_quantity,0)>0 and product_key is not null loop
      begin perform public.pst_allocate_paid_backorders(k); exception when others then null; end; -- never block marking paid
    end loop;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_allocate_on_inventory_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.movement_type='incoming_received' and new.quantity_change>0 then
  perform public.pst_allocate_paid_backorders(new.product_key);
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_allocate_paid_backorders(p_product_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare stock public.product_inventory%rowtype; line record; available integer; taken integer; allocated integer:=0; prev integer;
begin
 select * into stock from public.product_inventory where product_key=p_product_key for update;
 if not found then return 0; end if;
 available:=greatest(0,coalesce(stock.current_inventory,0));
 for line in
  select * from (
   select oi.id item_id,oi.order_id,o.order_number,o.created_at,
          case when coalesce(o.inventory_deducted,false)=false
               then oi.quantity-coalesce(si.shipped,0)-coalesce(a.quantity,0)          -- his original rule (unreserved orders)
               else coalesce(oi.backorder_quantity,0)-coalesce(a.quantity,0) end as need -- checkout backorder still owed
   from public.order_items oi join public.orders o on o.id=oi.order_id
   left join (select order_item_id,sum(quantity) shipped from public.order_shipment_items group by order_item_id) si on si.order_item_id=oi.id
   left join public.pst_backorder_allocations a on a.order_item_id=oi.id
   where oi.product_key=p_product_key and oi.unit_price>0 and lower(coalesce(o.payment_status,''))='paid'
     and lower(coalesce(o.order_status,o.status,'')) not in ('cancelled','canceled','rejected','refunded')
     and (coalesce(o.inventory_deducted,false)=false or coalesce(oi.backorder_quantity,0)>0)
  ) q where need>0
  order by created_at,item_id
 loop
  exit when available<=0;
  taken:=least(available,line.need);
  if taken<=0 then continue;end if;
  insert into public.pst_backorder_allocations(order_item_id,order_id,product_key,quantity)
   values(line.item_id,line.order_id,p_product_key,taken)
   on conflict(order_item_id) do update set quantity=public.pst_backorder_allocations.quantity+excluded.quantity;
  prev:=available;
  available:=available-taken;
  update public.product_inventory set current_inventory=available,updated_at=now() where id=stock.id;
  insert into public.inventory_movements(product_id,product_key,movement_type,quantity_change,previous_quantity,new_quantity,admin_note,created_by,created_by_email)
  values(stock.id,p_product_key,'sold_checkout',-taken,prev,available,'Allocated to paid backorder '||coalesce(line.order_number,line.order_id::text)||' | item '||line.item_id::text,auth.uid(),auth.jwt()->>'email');
  allocated:=allocated+taken;
 end loop;
 return allocated;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_allocate_paid_free_vial(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders%rowtype; p public.site_promotions%rowtype; v public.product_inventory%rowtype;
 earlier_unpaid integer; issued integer; purchased integer; chosen_key text;
begin
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if lower(coalesce(o.payment_status,'')) not in ('paid','completed','confirmed') then
   return jsonb_build_object('awarded',false,'reason','payment_pending');
 end if;
 if lower(coalesce(o.order_status,o.status,'')) in ('rejected','cancelled','canceled') then
   return jsonb_build_object('awarded',false,'reason','order_cancelled');
 end if;
 select coalesce(sum(quantity),0) into purchased from public.order_items
 where order_id=o.id and unit_price>0 and (coalesce(product_category,'') ilike '%peptide%' or coalesce(product_category,'') ilike '%glp%');
 for p in select * from public.site_promotions where promotion_type='free_product' and is_active
 and (starts_at is null or o.created_at>=starts_at) and (ends_at is null or o.created_at<=ends_at)
 order by sort_order,created_at loop
   if purchased<p.minimum_paid_quantity or coalesce(o.customer_id,o.user_id) is null then continue; end if;
   if p.reward_mode='customer_choice' and not exists(select 1 from public.pst_order_reward_choices ch where ch.order_id=o.id and ch.promotion_id=p.id) then continue;end if;
   if p.audience='selected_customers' then
     if p.eligibility_starts_at is null or o.created_at<p.eligibility_starts_at then continue; end if;
     if not exists(select 1 from public.pst_promotion_eligible_customers ec where ec.promotion_id=p.id and lower(ec.customer_email)=lower(coalesce(o.customer_email,''))) then continue; end if;
   end if;
   perform pg_advisory_xact_lock(hashtextextended(p.id::text,0));
   if exists(select 1 from public.promotion_redemptions r where r.promotion_id=p.id and r.order_id=o.id and r.status in ('reserved','fulfilled')) then continue; end if;
   if p.redemption_limit='once_per_customer' and exists(
     select 1 from public.promotion_redemptions r where r.promotion_id=p.id and r.customer_id=coalesce(o.customer_id,o.user_id) and r.status in ('reserved','fulfilled')
   ) then continue; end if;
   if p.max_redemptions is not null then
     select count(*) into issued from public.promotion_redemptions r where r.promotion_id=p.id and r.status in ('reserved','fulfilled');
     if issued>=p.max_redemptions then continue; end if;
   end if;
   chosen_key:=p.reward_product_key;
   if p.reward_mode='customer_choice' then
     select ch.product_key into chosen_key from public.pst_order_reward_choices ch where ch.order_id=o.id and ch.promotion_id=p.id;
     if not exists(select 1 from public.pst_promotion_reward_options opt where opt.promotion_id=p.id and opt.product_key=chosen_key) then continue;end if;
   end if;
   select * into v from public.product_inventory where product_key=chosen_key for update;
   if not found or coalesce(v.current_inventory,0)<p.reward_quantity then continue; end if;
   -- Protect earlier unpaid qualifying orders only while scarce and within their two-hour window.
   select count(*) into earlier_unpaid from public.orders e
   where e.created_at<o.created_at and e.created_at>now()-interval '2 hours'
     and lower(coalesce(e.payment_status,'')) not in ('paid','completed','confirmed')
     and lower(coalesce(e.order_status,e.status,'')) not in ('rejected','cancelled','canceled')
     and coalesce(e.customer_id,e.user_id) is not null
     and (p.audience is distinct from 'selected_customers' or (e.created_at>=p.eligibility_starts_at and exists(select 1 from public.pst_promotion_eligible_customers ec where ec.promotion_id=p.id and lower(ec.customer_email)=lower(coalesce(e.customer_email,'')))))
     and (p.starts_at is null or e.created_at>=p.starts_at)
     and (p.ends_at is null or e.created_at<=p.ends_at)
     and (select coalesce(sum(ei2.quantity),0) from public.order_items ei2 where ei2.order_id=e.id and ei2.unit_price>0 and coalesce(ei2.product_category,'') ilike '%peptide%')>=p.minimum_paid_quantity
     and exists(select 1 from public.order_items ei where ei.order_id=e.id and ei.unit_price>0
       and (coalesce(ei.product_category,'') ilike '%peptide%' or coalesce(ei.product_category,'') ilike '%glp%'))
     and not exists(select 1 from public.promotion_redemptions er where er.promotion_id=p.id and er.order_id=e.id and er.status in ('reserved','fulfilled'));
   -- A chosen reward is never substituted if unavailable.
   if p.reward_mode='customer_choice' then earlier_unpaid:=0;end if;
   -- If earlier unpaid orders still have a live two-hour claim, leave enough stock for them.
   -- Expired orders no longer block the queue; later submitted paid orders are eligible.
   if v.current_inventory < (earlier_unpaid+1)*p.reward_quantity then continue; end if;
   -- Inventory is deducted here, and the standard order RPC excludes zero-price promotional lines.
   update public.product_inventory set current_inventory=current_inventory-p.reward_quantity where id=v.id;
   insert into public.order_items(order_id,product_id,product_key,product_name,product_strength,product_category,quantity,unit_price,line_total)
   values(o.id,v.id::text,v.product_key,v.display_name,v.strength,v.category,p.reward_quantity,0,0);
   insert into public.promotion_redemptions(promotion_id,order_id,customer_id,reward_product_key,quantity,status)
   values(p.id,o.id,coalesce(o.customer_id,o.user_id),v.product_key,p.reward_quantity,'fulfilled');
   -- Inventory is locked in this transaction; the last awarded vial ends the campaign.
   if p.reward_mode='fixed' and (select current_inventory from public.product_inventory where id=v.id)<p.reward_quantity then
     update public.site_promotions set is_active=false where id=p.id;
   end if;
   return jsonb_build_object('awarded',true,'product_key',v.product_key,'quantity',p.reward_quantity);
 end loop;
 return jsonb_build_object('awarded',false,'reason','not_eligible_or_no_unreserved_inventory');
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_auto_label_color()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if nullif(trim(coalesce(new.label_color,'')),'') is null then
    new.label_color := public.pst_pick_label_color(new.display_name, new.product_key);
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_availability_token_valid(p_token text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce((select decrypted_secret=p_token from vault.decrypted_secrets where name='pst_availability_cron_token' limit 1),false);
$function$
;
CREATE OR REPLACE FUNCTION public.pst_backorders_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select true $function$
;
CREATE OR REPLACE FUNCTION public.pst_choose_order_reward(p_order_id uuid, p_promotion_id uuid, p_product_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype;p public.site_promotions%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found or coalesce(o.customer_id,o.user_id)<>auth.uid() then raise exception 'Not your order';end if;
 if lower(coalesce(o.payment_status,'')) in ('paid','completed','confirmed') then raise exception 'Reward choice locked after payment';end if;
 if now()>o.created_at+interval '15 minutes' then raise exception 'Choice period expired';end if;
 select * into p from public.site_promotions where id=p_promotion_id;
 if not found or not p.is_active or p.promotion_type<>'free_product' or p.reward_mode<>'customer_choice' then raise exception 'Offer unavailable';end if;
 if (p.starts_at is not null and o.created_at<p.starts_at) or (p.ends_at is not null and o.created_at>p.ends_at) then raise exception 'Offer outside dates';end if;
 if p.audience='selected_customers' and (o.created_at<p.eligibility_starts_at or not exists(select 1 from public.pst_promotion_eligible_customers e where e.promotion_id=p.id and lower(e.customer_email)=lower(coalesce(o.customer_email,'')))) then raise exception 'Customer not eligible';end if;
 if not exists(select 1 from public.pst_promotion_reward_options r join public.product_inventory i on i.product_key=r.product_key where r.promotion_id=p.id and r.product_key=p_product_key and i.current_inventory>=p.reward_quantity) then raise exception 'Reward currently unavailable';end if;
 if (select coalesce(sum(oi.quantity),0) from public.order_items oi where oi.order_id=o.id and oi.unit_price>0 and (coalesce(oi.product_category,'') ilike '%peptide%' or coalesce(oi.product_category,'') ilike '%glp%'))<p.minimum_paid_quantity then raise exception 'Order does not qualify';end if;
 insert into public.pst_order_reward_choices(order_id,promotion_id,product_key) values(o.id,p.id,p_product_key) on conflict(order_id,promotion_id) do update set product_key=excluded.product_key,created_at=now();
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_claim_availability_admin_alerts()
 RETURNS SETOF product_availability_requests
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 update public.product_availability_requests p set admin_alert_claimed_at=now()
 where p.id in (
  select id from public.product_availability_requests
  where admin_alert_sent_at is null and created_at >= now()-interval '7 days'
  and (admin_alert_claimed_at is null or admin_alert_claimed_at<now()-interval '10 minutes')
  order by created_at asc limit 20 for update skip locked
 ) returning p.*;
$function$
;
CREATE OR REPLACE FUNCTION public.pst_claim_restock_notifications()
 RETURNS SETOF product_availability_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service access required';end if;
 return query with ready as (
  select r.id from public.product_availability_requests r join public.product_inventory p on p.product_key=r.product_key
  where r.status='pending' and r.notify_when_available=true and p.current_inventory>0
  order by r.created_at for update of r skip locked limit 30
 ), updated as (
  update public.product_availability_requests r set status='sending' from ready where r.id=ready.id returning r.*
 ) select * from updated;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_clear_coming_soon()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(new.current_inventory, 0) > 0 and coalesce(old.current_inventory, 0) <= 0 then
    update public.product_catalog set coming_soon = false where product_key = new.product_key and coming_soon;
  end if;
  return new;
exception when others then
  raise warning 'pst_clear_coming_soon: %', sqlerrm; return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_expire_unpaid_orders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
 with expired as (
  update public.orders set order_status='cancelled',status='cancelled',updated_at=now(),
  admin_notes=concat(coalesce(admin_notes,''),E'\nAuto-cancelled: 24-hour payment reservation expired.')
  where payment_deadline_at is not null and payment_deadline_at<=now()
   and lower(coalesce(payment_status,'pending')) not in ('paid','refunded')
   and lower(coalesce(order_status,status,'')) not in ('cancelled','canceled','rejected','shipped','delivered','complete','completed','packed','partially_shipped')
   and not exists(select 1 from public.order_shipments s where s.order_id=orders.id)
  returning id
 ) select count(*) into v_count from expired;
 return v_count;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_extend_payment_deadline(p_order_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_deadline timestamptz;
begin
 if not exists(select 1 from public.admin_users where is_active=true and (user_id=auth.uid() or email=auth.jwt()->>'email')) then raise exception 'Admin access required';end if;
 update public.orders set payment_deadline_at=greatest(payment_deadline_at,now())+interval '24 hours',payment_deadline_extended_at=now(),updated_at=now()
 where id=p_order_id and payment_deadline_at is not null and lower(coalesce(payment_status,'pending')) not in ('paid','refunded') and lower(coalesce(order_status,status,'')) not in ('cancelled','canceled','rejected','shipped','delivered','complete','completed')
 returning payment_deadline_at into v_deadline;
 if v_deadline is null then raise exception 'Order cannot be extended';end if;
 return v_deadline;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_get_promotion_customers(p_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not exists(select 1 from public.admin_users a where a.is_active=true and (a.user_id=auth.uid() or lower(a.email)=lower(coalesce(auth.jwt()->>'email','')))) then raise exception 'Admin only';end if;
 return array(select customer_email from public.pst_promotion_eligible_customers where promotion_id=p_id order by customer_email);
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_get_promotion_reward_options(p_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(array_agg(product_key order by product_key),'{}'::text[]) from public.pst_promotion_reward_options where promotion_id=p_id
$function$
;
CREATE OR REPLACE FUNCTION public.pst_hold_until_paid(p_order_id uuid, p_hold boolean DEFAULT true)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v timestamptz;
begin
  if not exists(select 1 from public.admin_users where is_active=true and (user_id=auth.uid() or email=auth.jwt()->>'email')) then raise exception 'Admin access required'; end if;
  update public.orders
     set payment_deadline_at = case when p_hold then now()+interval '10 years' else now()+interval '24 hours' end,
         payment_deadline_extended_at = now(), updated_at = now(),
         admin_notes = concat_ws(E'\n', nullif(admin_notes,''), case when p_hold then 'Held until paid (24-hour auto-cancel off) by ' else '24-hour hold restarted by ' end || coalesce(auth.jwt()->>'email','admin'))
   where id=p_order_id and payment_deadline_at is not null
     and lower(coalesce(payment_status,'pending')) not in ('paid','refunded')
     and lower(coalesce(order_status,status,'')) not in ('cancelled','canceled','rejected','shipped','delivered','complete','completed')
  returning payment_deadline_at into v;
  if v is null then raise exception 'Order cannot be held'; end if;
  return v;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_insights(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_inventory_reserve_order_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.orders%rowtype; v_stock public.product_inventory%rowtype; v_qty integer; v_take integer; v_short integer;
begin
 select * into v_order from public.orders where id=new.order_id for update;
 if not found then raise exception 'Order missing for inventory reservation'; end if;
 if v_order.payment_deadline_at is null then return new; end if;
 if lower(coalesce(v_order.order_status,v_order.status,'')) in ('cancelled','canceled','rejected') then raise exception 'Cannot reserve inventory on canceled order'; end if;
 if coalesce(new.unit_price,0)<=0 then return new; end if;
 v_qty:=coalesce(new.quantity,0);
 if v_qty<=0 then raise exception 'Invalid inventory quantity'; end if;
 select * into v_stock from public.product_inventory where product_key=new.product_key for update;
 if not found then raise exception 'No inventory record for %',new.product_key; end if;
 v_take:=least(v_qty,greatest(0,coalesce(v_stock.current_inventory,0)));
 v_short:=v_qty-v_take;
 -- still refused: inactive, completely sold out, or a shortfall while backorders are switched off
 if not coalesce(v_stock.is_active,true) or v_take<=0 or (v_short>0 and public.pst_backorders_enabled() is not true) then
   raise exception 'Insufficient stock for %: requested %, available %',new.product_key,v_qty,v_stock.current_inventory;
 end if;
 update public.product_inventory set current_inventory=current_inventory-v_take,updated_at=now() where id=v_stock.id;
 insert into public.inventory_movements(product_id,product_key,movement_type,quantity_change,previous_quantity,new_quantity,admin_note,created_by,created_by_email)
 values(v_stock.id,new.product_key,'sold_checkout',-v_take,v_stock.current_inventory,v_stock.current_inventory-v_take,
   'Reserved on order submission: '||coalesce(v_order.order_number,v_order.id::text)||case when v_short>0 then ' ('||v_short||' on backorder)' else '' end,
   auth.uid(),auth.jwt()->>'email');
 if v_short>0 then update public.order_items set backorder_quantity=v_short where id=new.id; end if;
 update public.orders set inventory_deducted=true,inventory_restored=false,inventory_deducted_at=coalesce(inventory_deducted_at,now()) where id=new.order_id;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_my_loyalty_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_total numeric:=0;v_tier text;v_threshold numeric;v_next numeric;v_current_year numeric:=0;v_start timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select coalesce(sum(greatest(0,least(
   greatest(0,coalesce(o.subtotal,0)-coalesce(o.discount_amount,0)),
   greatest(0,coalesce(o.total,0)-coalesce(o.shipping,0)-coalesce(o.tax,0))
 ))),0)
 into v_total from public.orders o
 where (o.user_id=auth.uid() or o.customer_id=auth.uid())
 and lower(coalesce(o.payment_status,'')) in ('paid','completed','confirmed')
 and lower(coalesce(o.order_status,'')) not in ('cancelled','canceled','rejected','refunded');
 v_tier:=case when v_total>=5000 then 'diamond' when v_total>=3000 then 'gold' when v_total>=1500 then 'silver' else 'bronze' end;
 v_threshold:=case v_tier when 'diamond' then 2500 when 'gold' then 1500 when 'silver' then 750 else 0 end;
 v_next:=case v_tier when 'bronze' then 1500 when 'silver' then 3000 when 'gold' then 5000 else null end;
 select min(o.created_at) into v_start from public.orders o
 where (o.user_id=auth.uid() or o.customer_id=auth.uid())
 and lower(coalesce(o.payment_status,'')) in ('paid','completed','confirmed');
 select coalesce(sum(greatest(0,least(greatest(0,coalesce(o.subtotal,0)-coalesce(o.discount_amount,0)),greatest(0,coalesce(o.total,0)-coalesce(o.shipping,0)-coalesce(o.tax,0))))),0)
 into v_current_year from public.orders o
 where (o.user_id=auth.uid() or o.customer_id=auth.uid()) and o.created_at>=now()-interval '1 year'
 and lower(coalesce(o.payment_status,'')) in ('paid','completed','confirmed')
 and lower(coalesce(o.order_status,'')) not in ('cancelled','canceled','rejected','refunded');
 return jsonb_build_object('tier',v_tier,'qualifying_total',round(v_total,2),'next_threshold',v_next,'amount_to_next',case when v_next is null then 0 else greatest(0,v_next-v_total) end,'annual_spend_preview',round(v_current_year,2),'annual_retention_threshold',v_threshold,'renewal_active',false);
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_my_store_credit_balance()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_email text := lower(coalesce(auth.jwt()->>'email','')); v_cents bigint;
begin
 if v_uid is null then raise exception 'Sign in required'; end if;
 select coalesce(sum(amount_cents),0) into v_cents from public.store_credit_transactions
 where customer_user_id = v_uid or (customer_user_id is null and lower(customer_email)=v_email and v_email <> '');
 return greatest(0,v_cents)::numeric / 100;
end; $function$
;
CREATE OR REPLACE FUNCTION public.pst_notify_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  hk text;
  o jsonb := to_jsonb(new);
  p jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  body jsonb;
begin
  begin
    select value into hk from public.pst_app_secrets where key = 'hook_key';
    if tg_op = 'INSERT' then
      body := jsonb_build_object('event', 'new_order', 'order_id', new.id);
    elsif coalesce(o->>'payment_status', '') is distinct from coalesce(p->>'payment_status', '')
       or coalesce(o->>'order_status', o->>'status', '') is distinct from coalesce(p->>'order_status', p->>'status', '')
       or coalesce(o->>'tracking_number', '') is distinct from coalesce(p->>'tracking_number', '') then
      body := jsonb_build_object('event', 'status', 'order_id', new.id);
    else
      return new;
    end if;
    perform net.http_post(
      url := 'https://__PPU_SUPABASE_REF__.supabase.co/functions/v1/pst-push',
      body := body,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', coalesce(hk, '')),
      timeout_milliseconds := 8000);
  exception when others then
    raise warning 'pst_notify_hook skipped: %', sqlerrm;               -- never block the order
  end;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_order_set_payment_deadline()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.payment_deadline_at is null and lower(coalesce(new.payment_status,'pending')) not in ('paid','refunded') then
 new.payment_deadline_at:=coalesce(new.created_at,now())+interval '24 hours';
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_owner_event_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_paid_order_reward_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if lower(coalesce(new.payment_status,'')) in ('paid','completed','confirmed')
 and lower(coalesce(old.payment_status,'')) not in ('paid','completed','confirmed') then
   perform public.pst_process_free_vial_waitlist();
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_pick_label_color(p_name text, p_key text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.pst_ping_availability_admin_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform net.http_post(url:='https://__PPU_SUPABASE_REF__.supabase.co/functions/v1/pst-availability-admin-alert',body:='{}'::jsonb,headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=10000);
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_process_free_vial_waitlist()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 candidate record;
 result jsonb;
 awarded_count integer := 0;
begin
 -- Serialize workers so two invocations cannot process the same queue concurrently.
 perform pg_advisory_xact_lock(hashtextextended('pst_free_vial_waitlist',0));
 for candidate in
   select distinct o.id, o.created_at
   from public.orders o
   join public.order_items oi on oi.order_id=o.id
   where lower(coalesce(o.payment_status,'')) in ('paid','completed','confirmed')
     and lower(coalesce(o.order_status,o.status,'')) not in ('rejected','cancelled','canceled')
     and oi.unit_price>0
     and (coalesce(oi.product_category,'') ilike '%peptide%' or coalesce(oi.product_category,'') ilike '%glp%')
     and exists (
       select 1 from public.site_promotions p
       where p.is_active and p.promotion_type='free_product'
       and (p.starts_at is null or o.created_at>=p.starts_at)
       and (p.ends_at is null or o.created_at<=p.ends_at)
       and not exists (
         select 1 from public.promotion_redemptions r
         where r.promotion_id=p.id and r.order_id=o.id
           and r.status in ('reserved','fulfilled')
       )
     )
   order by o.created_at,o.id
 loop
   result := public.pst_allocate_paid_free_vial(candidate.id);
   if coalesce((result->>'awarded')::boolean,false) then
     awarded_count:=awarded_count+1;
   end if;
 end loop;
 return jsonb_build_object('awarded_count',awarded_count,'processed_at',now());
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_promotion_visible_to_current_customer(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists (
  select 1 from public.site_promotions p
  where p.id=p_id and (
   p.audience is distinct from 'selected_customers'
   or (
    auth.uid() is not null and exists(
      select 1 from public.pst_promotion_eligible_customers e
      where e.promotion_id=p.id and lower(e.customer_email)=lower(coalesce(auth.jwt()->>'email',''))
    )
   )
  )
 );
$function$
;
CREATE OR REPLACE FUNCTION public.pst_public_reward_options()
 RETURNS TABLE(promotion_id uuid, product_key text, display_name text, strength text, current_inventory integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select r.promotion_id,i.product_key,i.display_name,i.strength,i.current_inventory
 from public.pst_promotion_reward_options r join public.product_inventory i on i.product_key=r.product_key
 join public.site_promotions p on p.id=r.promotion_id
 where p.is_active and p.promotion_type='free_product' and p.reward_mode='customer_choice'
 and (p.starts_at is null or p.starts_at<=now()) and (p.ends_at is null or p.ends_at>=now())
 and (p.audience is distinct from 'selected_customers' or exists(select 1 from public.pst_promotion_eligible_customers e where e.promotion_id=p.id and lower(e.customer_email)=lower(coalesce(auth.jwt()->>'email',''))))
$function$
;
CREATE OR REPLACE FUNCTION public.pst_record_lab_testing(p_inventory_id uuid, p_lot text, p_lab text, p_date date, p_qty integer, p_mode text, p_result text, p_notes text, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.product_inventory%rowtype;v_prior uuid;v_next integer;
begin
 if auth.uid() is null or not exists(select 1 from public.admin_users a where a.is_active=true and (a.user_id=auth.uid() or lower(a.email)=lower(coalesce(auth.jwt()->>'email','')))) then raise exception 'Administrator access required';end if;
 if nullif(trim(p_lot),'') is null or nullif(trim(p_lab),'') is null or p_date is null then raise exception 'Lot, laboratory and date are required';end if;
 if p_qty is null or p_qty<1 or p_qty>1000 then raise exception 'Invalid vial count';end if;
 if p_mode not in ('deduct_now','historical_already_counted') then raise exception 'Invalid adjustment mode';end if;
 if p_result not in ('pending','passed','failed','not_recorded') then raise exception 'Invalid testing result';end if;
 if p_request_key is null then raise exception 'Request identifier required';end if;
 select id into v_prior from public.pst_lab_testing_adjustments where request_key=p_request_key;
 if found then return jsonb_build_object('success',true,'already_recorded',true,'id',v_prior);end if;
 select * into v from public.product_inventory where id=p_inventory_id for update;
 if not found then raise exception 'Product not found';end if;
 v_next:=v.current_inventory;
 if p_mode='deduct_now' then
 if v.current_inventory<p_qty then raise exception 'Insufficient inventory';end if;
 v_next:=v.current_inventory-p_qty;
 update public.product_inventory set current_inventory=v_next,updated_at=now() where id=v.id;
 update public.product_catalog set current_inventory=v_next,updated_at=now() where product_key=v.product_key;
 insert into public.inventory_movements(product_id,product_key,movement_type,quantity_change,previous_quantity,new_quantity,admin_note,created_by,created_by_email)
 values(v.id,v.product_key,'physical_count',-p_qty,v.current_inventory,v_next,'Lab testing / QC: lot '||p_lot||'; '||p_lab||'; '||p_date::text||'; result '||p_result,auth.uid(),auth.jwt()->>'email');
 end if;
 insert into public.pst_lab_testing_adjustments(inventory_id,product_key,lot_number,laboratory,testing_date,quantity,mode,result_status,notes,created_by,request_key)
 values(v.id,v.product_key,trim(p_lot),trim(p_lab),p_date,p_qty,p_mode,p_result,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),p_request_key);
 return jsonb_build_object('success',true,'new_inventory',v_next);
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_record_order_discount_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.discount_id is null or coalesce(new.discount_amount, 0) <= 0 then return new; end if;
  insert into public.discount_usage (discount_id, order_id, customer_email, amount_saved, used_at)
  values (new.discount_id, new.id, lower(trim(coalesce(new.customer_email, new.shipping_email, auth.jwt() ->> 'email', ''))), new.discount_amount, now())
  on conflict (order_id) where order_id is not null do nothing;
  update public.discount_codes set times_used = coalesce(times_used, 0) + 1, uses = coalesce(uses, 0) + 1 where id = new.discount_id;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pst_redeem_store_credit(p_order_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_email text:=lower(coalesce(auth.jwt()->>'email','')); v_order public.orders%rowtype; v_balance bigint; v_use bigint; v_marker text;
begin
 if v_uid is null then raise exception 'Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtext(v_uid::text));
 select * into v_order from public.orders where id=p_order_id and customer_id=v_uid for update;
 if not found then raise exception 'Order not available'; end if;
 if coalesce(v_order.store_credit_applied,0)>0 then return v_order.store_credit_applied; end if;
 if lower(coalesce(v_order.status,'pending')) not in ('pending','awaiting_payment') then raise exception 'Order cannot use store credit'; end if;
 v_marker:='Store credit applied to order '||p_order_id::text;
 if exists (select 1 from public.store_credit_transactions where customer_user_id=v_uid and reason=v_marker) then raise exception 'Credit already redeemed for this order'; end if;
 select greatest(0,coalesce(sum(amount_cents),0)) into v_balance
 from public.store_credit_transactions
 where customer_user_id=v_uid or (customer_user_id is null and lower(customer_email)=v_email and v_email <> '');
 v_use:=least(v_balance,greatest(0,round(coalesce(v_order.total,0)*100)::bigint));
 if v_use<=0 then return 0; end if;
 insert into public.store_credit_transactions (customer_user_id,customer_email,amount_cents,reason,created_by,created_by_email)
 values (v_uid,v_email,-v_use,v_marker,v_uid,v_email);
 update public.orders set total=round(greatest(0,coalesce(total,0)-v_use::numeric/100),2),
 store_credit_applied=v_use::numeric/100 where id=p_order_id;
 return v_use::numeric/100;
end; $function$
;
CREATE OR REPLACE FUNCTION public.pst_refresh_product_cycles()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  with buys as (
    select coalesce(to_jsonb(o)->>'customer_id', to_jsonb(o)->>'user_id', lower(to_jsonb(o)->>'customer_email')) as cust,
           to_jsonb(i)->>'product_key' as product_key, o.created_at
    from public.order_items i join public.orders o on o.id = i.order_id
    where lower(coalesce(to_jsonb(o)->>'payment_status', '')) = 'paid'
      and lower(coalesce(to_jsonb(o)->>'order_status', to_jsonb(o)->>'status', '')) not in ('cancelled', 'canceled', 'rejected', 'refunded', 'failed')
  ), gaps as (
    select product_key, extract(epoch from created_at - lag(created_at) over (partition by cust, product_key order by created_at)) / 86400.0 as gap
    from buys where cust is not null and product_key is not null
  ), agg as (
    select product_key, round(percentile_cont(0.5) within group (order by gap)::numeric, 1) as typical, count(*)::int as samples
    from gaps where gap between 5 and 200 group by product_key having count(*) >= 3
  ), up as (
    insert into public.pst_product_cycles(product_key, typical_days, samples, updated_at)
    select product_key, typical, samples, now() from agg
    on conflict (product_key) do update set typical_days = excluded.typical_days, samples = excluded.samples, updated_at = now()
    returning 1
  )
  select count(*) into n from up;
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_release_cancelled_backorders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; st public.product_inventory%rowtype; sent integer; reserved_at_checkout integer; giveback integer;
begin
 if lower(coalesce(new.order_status,new.status,'')) not in ('cancelled','canceled','rejected','refunded')
    or lower(coalesce(old.order_status,old.status,'')) in ('cancelled','canceled','rejected','refunded') then return new;end if;
 for a in select * from public.pst_backorder_allocations where order_id=new.id for update loop
  select coalesce(sum(quantity),0) into sent from public.order_shipment_items where order_item_id=a.order_item_id;
  -- on a checkout-reserved order, shipped units are counted against the checkout reservation first
  select case when coalesce(new.inventory_deducted,false) and new.payment_deadline_at is not null
              then greatest(0,oi.quantity-coalesce(oi.backorder_quantity,0)) else 0 end
    into reserved_at_checkout from public.order_items oi where oi.id=a.order_item_id;
  giveback:=greatest(0,a.quantity-greatest(0,sent-coalesce(reserved_at_checkout,0)));
  if giveback>0 then
   select * into st from public.product_inventory where product_key=a.product_key for update;
   if found then
    update public.product_inventory set current_inventory=current_inventory+giveback,updated_at=now() where id=st.id;
    insert into public.inventory_movements(product_id,product_key,movement_type,quantity_change,previous_quantity,new_quantity,admin_note)
    values(st.id,a.product_key,'restored_order',giveback,st.current_inventory,st.current_inventory+giveback,'Released paid backorder reservation from '||coalesce(new.order_number,new.id::text));
   end if;
  end if;
  delete from public.pst_backorder_allocations where order_item_id=a.order_item_id;
 end loop;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_restore_cancelled_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_item record;v_stock public.product_inventory%rowtype;v_qty integer;
begin
 if new.payment_deadline_at is null or not coalesce(new.inventory_deducted,false) or coalesce(new.inventory_restored,false) then return new;end if;
 if lower(coalesce(new.order_status,new.status,'')) not in ('cancelled','canceled','rejected','refunded') then return new;end if;
 for v_item in
  -- reserved at checkout = quantity - backorder_quantity; shipped units come out of that reservation first.
  -- (Backordered units filled later live in pst_backorder_allocations and are released by pst_release_cancelled_backorders.)
  select oi.product_key,sum(greatest(0,(oi.quantity-coalesce(oi.backorder_quantity,0))-greatest(0,coalesce(sh.shipped,0))))::integer as qty
  from public.order_items oi
  left join (select si.order_item_id,sum(si.quantity) as shipped from public.order_shipment_items si join public.order_shipments sh on sh.id=si.shipment_id where sh.order_id=new.id group by si.order_item_id) sh on sh.order_item_id=oi.id
  where oi.order_id=new.id and oi.unit_price>0
  group by oi.product_key
 loop
  v_qty:=greatest(0,v_item.qty);
  if v_qty=0 then continue;end if;
  select * into v_stock from public.product_inventory where product_key=v_item.product_key for update;
  if not found then raise exception 'Cannot restore inventory: missing product %',v_item.product_key;end if;
  update public.product_inventory set current_inventory=current_inventory+v_qty,updated_at=now() where id=v_stock.id;
  insert into public.inventory_movements(product_id,product_key,movement_type,quantity_change,previous_quantity,new_quantity,admin_note,created_by,created_by_email)
  values(v_stock.id,v_item.product_key,'restored_order',v_qty,v_stock.current_inventory,v_stock.current_inventory+v_qty,'Unshipped reservation released: '||coalesce(new.order_number,new.id::text),auth.uid(),auth.jwt()->>'email');
 end loop;
 update public.orders set inventory_restored=true,inventory_restored_at=now() where id=new.id and inventory_restored is distinct from true;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_review_release(p_id uuid, p_ok boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.admin_users au where au.is_active and (au.user_id = auth.uid() or au.email = (auth.jwt() ->> 'email'))) then raise exception 'Owners only'; end if;
  update public.pst_releases set status = case when p_ok then 'approved' else 'changes' end, review_by = auth.jwt() ->> 'email', review_at = now(),
    review_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_id and status in ('review', 'approved', 'changes');
  if not found then raise exception 'This update can''t be reviewed right now'; end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_save_promotion_reward_options(p_promotion_id uuid, p_keys text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer;
begin
 if auth.uid() is null or not exists(select 1 from public.admin_users a where a.user_id=auth.uid() and a.is_active) then raise exception 'Admin only';end if;
 perform 1 from public.site_promotions where id=p_promotion_id for update;
 if not found then raise exception 'Promotion not found';end if;
 delete from public.pst_promotion_reward_options where promotion_id=p_promotion_id;
 insert into public.pst_promotion_reward_options(promotion_id,product_key)
 select p_promotion_id,k from unnest(coalesce(p_keys,'{}'::text[])) k join public.product_inventory i on i.product_key=k group by k;
 get diagnostics n=row_count; return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_set_order_line_days(p_item_id uuid, p_days integer, p_basis text DEFAULT 'protocol'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.admin_users where is_active=true and (user_id=auth.uid() or email=auth.jwt()->>'email')) then raise exception 'Admin access required'; end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then raise exception 'Days must be between 1 and 365'; end if;
  update public.order_items
     set reorder_reminder_days = p_days, reorder_reminder_auto = false, reorder_basis = case when p_days is null then null else left(coalesce(p_basis,'owner'),20) end,
         reorder_reminded_at = null
   where id = p_item_id;
  if not found then raise exception 'Order line not found'; end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_set_promotion_customers(p_id uuid, p_emails text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer;
begin
 if auth.uid() is null or not exists(select 1 from public.admin_users a where a.is_active=true and (a.user_id=auth.uid() or lower(a.email)=lower(coalesce(auth.jwt()->>'email','')))) then raise exception 'Admin only';end if;
 perform 1 from public.site_promotions where id=p_id for update;
 if not found then raise exception 'Promotion not found';end if;
 if array_length(p_emails,1)>1000 then raise exception 'Too many selected customers';end if;
 delete from public.pst_promotion_eligible_customers where promotion_id=p_id;
 insert into public.pst_promotion_eligible_customers(promotion_id,customer_email)
 select p_id,lower(trim(e)) from unnest(coalesce(p_emails,'{}'::text[])) as e where trim(e) ~* '^[^ @]+@[^ @]+[.][^ @]+$' group by lower(trim(e));
 get diagnostics n=row_count;
 return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_sms_consent(p_on boolean, p_phone text DEFAULT NULL::text, p_source text DEFAULT 'account'::text, p_text text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_submit_availability_request(p_product_key text, p_quantity integer, p_name text, p_email text, p_notify boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_product record;v_id uuid;
begin
 if length(coalesce(p_name,'')) not between 2 and 120 or length(coalesce(p_email,'')) not between 5 and 250 or p_email not like '%@%.%' then raise exception 'Enter a valid name and email';end if;
 if p_quantity is null or p_quantity not between 1 and 500 then raise exception 'Quantity must be 1–500';end if;
 select product_key,display_name,strength,current_inventory into v_product from public.product_inventory where product_key=p_product_key;
 if not found then raise exception 'Product not found';end if;
 if v_product.current_inventory>0 then raise exception 'This product is back in stock. Refresh the catalog to order.';end if;
 insert into public.product_availability_requests(product_key,product_name,product_strength,requested_quantity,customer_name,customer_email,notify_when_available)
 values(v_product.product_key,v_product.display_name,v_product.strength,p_quantity,trim(p_name),lower(trim(p_email)),coalesce(p_notify,false)) returning id into v_id;
 return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_submit_bulk_request(p_name text, p_company text, p_email text, p_phone text, p_product text, p_strength text, p_kits integer, p_requirements text, p_testing_path text, p_acknowledgment boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_number bigint;
begin
 if length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Enter your name';end if;
 if length(trim(coalesce(p_email,''))) not between 5 and 254 or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email';end if;
 if length(trim(coalesce(p_product,''))) not between 2 and 160 or length(trim(coalesce(p_strength,''))) not between 1 and 100 then raise exception 'Enter product and strength';end if;
 if p_kits is null or p_kits<1 or p_kits>500 then raise exception 'Choose 1 to 500 kits';end if;
 if p_testing_path not in ('pst_coordinated','customer_coordinated') then raise exception 'Select a testing preference';end if;
 if p_acknowledgment is distinct from true then raise exception 'Confirm the research-use acknowledgment';end if;
 insert into public.bulk_requests(request_number,name,company,email,phone,product,strength,kits,requirements,testing_path,acknowledgment,status)
 values(nextval('public.bulk_requests_request_number_seq'),left(trim(p_name),120),nullif(left(trim(coalesce(p_company,'')),160),''),lower(trim(p_email)),nullif(left(trim(coalesce(p_phone,'')),50),''),left(trim(p_product),160),left(trim(p_strength),100),p_kits,nullif(left(trim(coalesce(p_requirements,'')),2000),''),p_testing_path,true,'new')
 returning request_number into v_number;
 return v_number;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_ticket_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_tmp_load(tbl regclass, data jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare r jsonb; cols text; n int := 0; c int;
begin
  set local session_replication_role = replica;  -- no triggers while copying (no emails, pushes or stock changes)
  for r in select * from jsonb_array_elements(data) loop
    select string_agg(quote_ident(k), ',') into cols from jsonb_object_keys(r) k
      where exists (select 1 from pg_attribute a where a.attrelid = tbl and a.attname = k and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = '');
    execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict do nothing', tbl, cols, cols, tbl) using r;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_track(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.pst_us_phone(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when d ~ '^[2-9][0-9]{9}$' then '+1' || d when d ~ '^1[2-9][0-9]{9}$' then '+' || d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$function$
;
CREATE OR REPLACE FUNCTION public.pst_user_created_for_promo(p_user_id uuid, p_email text, p_promo_starts_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.customer_profiles cp
    where (
      (p_user_id is not null and cp.user_id = p_user_id)
      or (coalesce(trim(p_email), '') <> '' and lower(coalesce(cp.email, '')) = lower(trim(p_email)))
    )
    and cp.created_at >= coalesce(p_promo_starts_at, now() - interval '30 days')
  );
$function$
;
CREATE OR REPLACE FUNCTION public.pst_user_has_prior_real_order(p_user_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.orders o
    where (
      (p_user_id is not null and o.customer_id = p_user_id)
      or (coalesce(trim(p_email), '') <> '' and lower(coalesce(o.shipping_email, '')) = lower(trim(p_email)))
    )
    and lower(coalesce(o.order_status, o.status, '')) not in ('cancelled','canceled','rejected','inventory failed','test')
    and (
      lower(coalesce(o.payment_status, '')) in ('paid','payment accepted','accepted')
      or lower(coalesce(o.order_status, o.status, '')) in ('processing','packed','shipped','delivered','complete','completed')
    )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.pst_user_has_used_discount(p_discount_id uuid, p_code text, p_user_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.discount_usage du
    where du.discount_id = p_discount_id
      and coalesce(trim(p_email), '') <> ''
      and lower(coalesce(du.customer_email, '')) = lower(trim(p_email))
  )
  or exists (
    select 1
    from public.orders o
    where (
      (p_user_id is not null and o.customer_id = p_user_id)
      or (coalesce(trim(p_email), '') <> '' and lower(coalesce(o.shipping_email, '')) = lower(trim(p_email)))
    )
    and lower(coalesce(o.order_status, o.status, '')) not in ('cancelled','canceled','rejected','inventory failed','test')
    and (
      (p_discount_id is not null and o.discount_id = p_discount_id)
      or (coalesce(trim(p_code), '') <> '' and upper(coalesce(o.discount_code, '')) = upper(trim(p_code)))
    )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.pst_validate_order_discount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_discount public.discount_codes%rowtype;
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_subtotal numeric := greatest(0,coalesce(new.subtotal_before_discount,new.subtotal,0));
  v_amount numeric := 0;
  v_use_count integer := 0;
begin
  if nullif(trim(coalesce(new.discount_code,'')),'') is null then return new; end if;
  if auth.uid() is null or new.customer_id is distinct from auth.uid() then raise exception 'Discount code could not be verified for this customer.'; end if;
  select * into v_discount from public.discount_codes where lower(trim(code))=lower(trim(new.discount_code)) for update;
  if not found or coalesce(v_discount.active,false) is not true or (v_discount.expires_at is not null and v_discount.expires_at<now()) then raise exception 'Discount code is inactive, expired, or unavailable.'; end if;
  if coalesce(v_discount.audience,'all')='selected' and not exists (
    select 1 from public.discount_customer_assignments a where a.discount_id=v_discount.id and a.customer_id=auth.uid()
  ) then raise exception 'Discount code is not assigned to this customer account.'; end if;
  if nullif(lower(trim(coalesce(v_discount.assigned_email,''))),'') is not null and lower(trim(v_discount.assigned_email))<>v_email then raise exception 'Discount code is assigned to a different customer account.'; end if;
  select count(*)::integer into v_use_count from public.discount_usage where discount_id=v_discount.id;
  if coalesce(v_discount.max_uses,0)>0 and greatest(v_use_count,coalesce(v_discount.times_used,0),coalesce(v_discount.uses,0))>=v_discount.max_uses then raise exception 'Discount code has reached its usage limit.'; end if;
  if coalesce(v_discount.one_time_use,false) and exists(select 1 from public.discount_usage where discount_id=v_discount.id and lower(trim(coalesce(customer_email,'')))=v_email) then raise exception 'One-time discount code has already been used by this account.'; end if;
  if lower(coalesce(v_discount.discount_type,''))='percent' or coalesce(v_discount.percent_off,0)>0 then
    v_amount:=least(v_subtotal,round((v_subtotal*greatest(0,coalesce(v_discount.percent_off,0))/100)::numeric,2));
  elsif lower(coalesce(v_discount.discount_type,'')) in ('amount','fixed') or coalesce(v_discount.amount_off,0)>0 then
    v_amount:=least(v_subtotal,greatest(0,coalesce(v_discount.amount_off,0)));
  else raise exception 'Discount code has no discount amount configured.'; end if;
  new.subtotal_before_discount:=v_subtotal;
  new.discount_code:=v_discount.code;
  new.discount_id:=v_discount.id;
  new.discount_type:=v_discount.discount_type;
  new.discount_percent:=coalesce(v_discount.percent_off,0);
  new.discount_amount:=v_amount;
  new.discount_code_amount:=v_amount;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pst_weighted_receipt_cost(old_qty integer, old_cost numeric, received_qty integer, received_unit_cost numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
 select case when received_unit_cost is null or received_unit_cost<=0 then old_cost
 when greatest(coalesce(old_qty,0),0)=0 or old_cost is null or old_cost<=0 then received_unit_cost
 else round(((greatest(old_qty,0)::numeric*old_cost)+(received_qty::numeric*received_unit_cost))/(greatest(old_qty,0)+received_qty),4) end
$function$
;
CREATE OR REPLACE FUNCTION public.receive_incoming_purchase_order(p_po_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  line_record public.incoming_inventory%rowtype;
  inventory_record public.product_inventory%rowtype;
  previous_qty integer;
  new_qty integer;
  receipt_time timestamptz := now();
  actor_email text := coalesce(auth.jwt() ->> 'email', '');
  received_lines integer := 0;
  received_vials integer := 0;
  skipped_received integer := 0;
  skipped_cancelled integer := 0;
  clean_po_number text := btrim(coalesce(p_po_number, ''));
begin
  if not public.is_pst_admin() then
    raise exception 'Active administrator access is required.'
      using errcode = '42501';
  end if;

  if clean_po_number = '' then
    raise exception 'PO number is required.';
  end if;

  -- Serialize receipts for the same PO, including simultaneous clicks.
  perform pg_advisory_xact_lock(hashtextextended(lower(clean_po_number), 0));

  select count(*) into skipped_received
  from public.incoming_inventory
  where lower(po_number) = lower(clean_po_number)
    and lower(coalesce(status, '')) = 'received';

  select count(*) into skipped_cancelled
  from public.incoming_inventory
  where lower(po_number) = lower(clean_po_number)
    and lower(coalesce(status, '')) = 'cancelled';

  for line_record in
    select *
    from public.incoming_inventory
    where lower(po_number) = lower(clean_po_number)
      and lower(coalesce(status, 'ordered')) not in ('received', 'cancelled')
    order by id
    for update
  loop
    if coalesce(line_record.ordered_quantity, 0) <= 0 then
      raise exception 'PO % contains a line with an invalid quantity.', clean_po_number;
    end if;

    select inventory.*
    into inventory_record
    from public.product_inventory inventory
    where inventory.id::text = coalesce(line_record.product_id, '')
       or (
         nullif(btrim(line_record.product_key), '') is not null
         and lower(inventory.product_key) = lower(btrim(line_record.product_key))
       )
    order by
      case when inventory.id::text = coalesce(line_record.product_id, '') then 0 else 1 end
    limit 1
    for update;

    if not found then
      raise exception 'PO % line % could not be matched to physical inventory.',
        clean_po_number,
        line_record.product_name;
    end if;

    previous_qty := coalesce(inventory_record.current_inventory, 0);
    new_qty := previous_qty + line_record.ordered_quantity;

    update public.product_inventory
    set
      current_inventory = new_qty,
      cost_per_unit = public.pst_weighted_receipt_cost(previous_qty, inventory_record.cost_per_unit, line_record.ordered_quantity, coalesce(nullif(line_record.kit_cost,0) / nullif(line_record.kit_vial_count,0), nullif(line_record.cost_per_unit,0))),
      updated_at = receipt_time
    where id = inventory_record.id;

    insert into public.inventory_movements (
      product_id,
      product_key,
      movement_type,
      quantity_change,
      previous_quantity,
      new_quantity,
      admin_note,
      created_by,
      created_by_email,
      created_at
    ) values (
      inventory_record.id,
      inventory_record.product_key,
      'incoming_received',
      line_record.ordered_quantity,
      previous_qty,
      new_qty,
      'Received ' || clean_po_number || ': ' ||
        coalesce(line_record.product_name, inventory_record.display_name, inventory_record.product_key) ||
        ' · ' || line_record.ordered_quantity || ' vial(s). Incoming ID: ' || line_record.id,
      auth.uid(),
      nullif(actor_email, ''),
      receipt_time
    );

    update public.incoming_inventory
    set
      status = 'received',
      received_at = receipt_time,
      received_quantity = line_record.ordered_quantity,
      updated_at = receipt_time,
      audit_note = concat_ws(
        E'\n',
        nullif(audit_note, ''),
        'Received with entire PO ' || clean_po_number || ' on ' ||
          to_char(receipt_time, 'YYYY-MM-DD HH24:MI:SS TZ') ||
          ' by ' || coalesce(nullif(actor_email, ''), 'Admin') ||
          '. Previous stock ' || previous_qty || '; new stock ' || new_qty || '.'
      )
    where id = line_record.id;

    received_lines := received_lines + 1;
    received_vials := received_vials + line_record.ordered_quantity;
  end loop;

  if received_lines = 0 then
    if skipped_received > 0 then
      raise exception 'PO % has already been fully received.', clean_po_number;
    end if;
    raise exception 'PO % has no eligible lines to receive.', clean_po_number;
  end if;

  return jsonb_build_object(
    'po_number', clean_po_number,
    'received_lines', received_lines,
    'received_vials', received_vials,
    'skipped_received', skipped_received,
    'skipped_cancelled', skipped_cancelled,
    'received_at', receipt_time
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.receive_incoming_purchase_order_lines(p_po_number text, p_line_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  line_record public.incoming_inventory%rowtype;
  inventory_record public.product_inventory%rowtype;
  previous_qty integer;
  new_qty integer;
  receipt_time timestamptz := now();
  actor_email text := coalesce(auth.jwt() ->> 'email', '');
  received_lines integer := 0;
  received_vials integer := 0;
  requested_lines integer := 0;
  eligible_lines integer := 0;
  clean_po_number text := btrim(coalesce(p_po_number, ''));
begin
  if not public.is_pst_admin() then
    raise exception 'Active administrator access is required.' using errcode = '42501';
  end if;
  if clean_po_number = '' then raise exception 'PO number is required.'; end if;
  select count(distinct requested_id) into requested_lines
  from unnest(coalesce(p_line_ids, array[]::text[])) requested_id
  where nullif(btrim(requested_id), '') is not null;
  if requested_lines = 0 then raise exception 'Select at least one PO line to receive.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(clean_po_number), 0));
  select count(*) into eligible_lines
  from public.incoming_inventory
  where lower(po_number) = lower(clean_po_number)
    and id::text = any(p_line_ids)
    and lower(coalesce(status, 'ordered')) not in ('received', 'cancelled');
  if eligible_lines <> requested_lines then
    raise exception 'One or more selected lines do not belong to PO %, were already received, or were cancelled.', clean_po_number;
  end if;
  for line_record in
    select * from public.incoming_inventory
    where lower(po_number) = lower(clean_po_number)
      and id::text = any(p_line_ids)
      and lower(coalesce(status, 'ordered')) not in ('received', 'cancelled')
    order by id for update
  loop
    if coalesce(line_record.ordered_quantity, 0) <= 0 then raise exception 'PO % contains a line with an invalid quantity.', clean_po_number; end if;
    select inventory.* into inventory_record
    from public.product_inventory inventory
    where inventory.id::text = coalesce(line_record.product_id, '')
       or (nullif(btrim(line_record.product_key), '') is not null and lower(inventory.product_key) = lower(btrim(line_record.product_key)))
    order by case when inventory.id::text = coalesce(line_record.product_id, '') then 0 else 1 end
    limit 1 for update;
    if not found then raise exception 'PO % line % could not be matched to physical inventory.', clean_po_number, line_record.product_name; end if;
    previous_qty := coalesce(inventory_record.current_inventory, 0);
    new_qty := previous_qty + line_record.ordered_quantity;
    update public.product_inventory set current_inventory = new_qty,
      cost_per_unit = public.pst_weighted_receipt_cost(previous_qty, inventory_record.cost_per_unit, line_record.ordered_quantity, coalesce(nullif(line_record.kit_cost,0) / nullif(line_record.kit_vial_count,0), nullif(line_record.cost_per_unit,0))),
      updated_at = receipt_time where id = inventory_record.id;
    insert into public.inventory_movements (product_id, product_key, movement_type, quantity_change, previous_quantity, new_quantity, admin_note, created_by, created_by_email, created_at)
    values (inventory_record.id, inventory_record.product_key, 'incoming_received', line_record.ordered_quantity, previous_qty, new_qty,
      'Received selected line from ' || clean_po_number || ': ' || coalesce(line_record.product_name, inventory_record.display_name, inventory_record.product_key) || ' · ' || line_record.ordered_quantity || ' vial(s). Incoming ID: ' || line_record.id,
      auth.uid(), nullif(actor_email, ''), receipt_time);
    update public.incoming_inventory set status = 'received', received_at = receipt_time,
      received_quantity = line_record.ordered_quantity, updated_at = receipt_time,
      audit_note = concat_ws(E'\n', nullif(audit_note, ''), 'Received selected line from ' || clean_po_number || ' on ' || to_char(receipt_time, 'YYYY-MM-DD HH24:MI:SS TZ') || ' by ' || coalesce(nullif(actor_email, ''), 'Admin') || '. Previous stock ' || previous_qty || '; new stock ' || new_qty || '.')
    where id = line_record.id;
    received_lines := received_lines + 1;
    received_vials := received_vials + line_record.ordered_quantity;
  end loop;
  return jsonb_build_object('po_number', clean_po_number, 'received_lines', received_lines, 'received_vials', received_vials, 'received_at', receipt_time);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.restore_inventory_for_order(p_order_id uuid, p_reason text DEFAULT 'Inventory restored by admin action'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_is_admin boolean := false;
  v_item record;
begin
  select exists (
    select 1 from public.admin_users au
    where (au.user_id = auth.uid() or au.email = auth.jwt() ->> 'email')
      and au.is_active = true
  ) into v_is_admin;

  if not v_is_admin then
    return jsonb_build_object('success', false, 'reason', 'not_admin', 'message', 'Only an active admin can restore inventory.');
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'order_not_found', 'message', 'Order was not found.');
  end if;

  if coalesce(v_order.inventory_deducted, false) = false then
    return jsonb_build_object('success', true, 'already_restored', false, 'message', 'Inventory was never deducted for this order, so nothing needed to be restored.');
  end if;

  if coalesce(v_order.inventory_restored, false) then
    return jsonb_build_object('success', true, 'already_restored', true, 'message', 'Inventory was already restored for this order.');
  end if;

  perform 1
  from public.product_inventory pi
  join (
    select coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key) as product_key,
           sum(oi.quantity)::integer as restore_qty
    from public.order_items oi
    left join public.product_catalog pc on pc.id::text = oi.product_id
    left join public.product_inventory direct_pi on direct_pi.product_key = oi.product_id
    where oi.order_id = p_order_id and oi.unit_price > 0
    group by coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key)
  ) resolved on resolved.product_key = pi.product_key
  order by pi.product_key
  for update of pi;

  if exists (
    select 1
    from public.order_items oi
    left join public.product_catalog pc on pc.id::text = oi.product_id
    left join public.product_inventory direct_pi on direct_pi.product_key = oi.product_id
    left join public.product_inventory pi on pi.product_key = coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key)
    where oi.order_id = p_order_id and oi.unit_price > 0 and pi.id is null
  ) then
    return jsonb_build_object('success', false, 'reason', 'inventory_match_failed', 'message', 'Inventory restoration was blocked because an order item has no exact PST item-number mapping.');
  end if;

  for v_item in
    select resolved.product_key,
           resolved.restore_qty,
           pi.id as inventory_id,
           pi.display_name,
           pi.current_inventory
    from (
      select coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key) as product_key,
             sum(oi.quantity)::integer as restore_qty
      from public.order_items oi
      left join public.product_catalog pc on pc.id::text = oi.product_id
      left join public.product_inventory direct_pi on direct_pi.product_key = oi.product_id
      where oi.order_id = p_order_id and oi.unit_price > 0
      group by coalesce(nullif(btrim(oi.product_key), ''), pc.product_key, direct_pi.product_key)
    ) resolved
    join public.product_inventory pi on pi.product_key = resolved.product_key
    order by resolved.product_key
  loop
    update public.product_inventory
    set current_inventory = current_inventory + v_item.restore_qty, updated_at = now()
    where id = v_item.inventory_id;

    insert into public.inventory_movements (
      product_id, product_key, movement_type, quantity_change,
      previous_quantity, new_quantity, admin_note, created_by, created_by_email
    ) values (
      v_item.inventory_id, v_item.product_key, 'restored_order', v_item.restore_qty,
      v_item.current_inventory, v_item.current_inventory + v_item.restore_qty,
      coalesce(p_reason, 'Inventory restored by admin action') || ' | Exact PST item-number match | Order ' || p_order_id::text,
      auth.uid(), auth.jwt() ->> 'email'
    );
  end loop;

  update public.orders
  set inventory_restored = true, inventory_restored_at = now(), updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'message', 'Inventory restored successfully by exact PST item number.', 'order_id', p_order_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_incoming_inventory_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_operating_expenses_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_site_promotions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_product_catalog_from_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.product_catalog pc
  set
    price = new.price,
    current_inventory = new.current_inventory,
    low_stock_threshold = new.low_stock_threshold,
    limited_stock_threshold = new.limited_stock_threshold,
    is_active = coalesce(new.is_active, pc.is_active),
    updated_at = now()
  where lower(trim(pc.display_name)) = lower(trim(new.display_name))
    and lower(trim(coalesce(pc.strength,''))) = lower(trim(coalesce(new.strength,'')));

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_cart_discount_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_discount public.discount_codes%rowtype;
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_used_by_customer boolean := false;
  v_use_count integer := 0;
begin
  if auth.uid() is null or v_email = '' then return jsonb_build_object('valid',false,'message','Log in before applying a discount code.'); end if;
  select * into v_discount from public.discount_codes where lower(trim(code))=lower(trim(coalesce(p_code,''))) limit 1;
  if not found then return jsonb_build_object('valid',false,'message','Discount code not found.'); end if;
  if coalesce(v_discount.active,false) is not true then return jsonb_build_object('valid',false,'message','This discount code is inactive.'); end if;
  if v_discount.expires_at is not null and v_discount.expires_at<now() then return jsonb_build_object('valid',false,'message','This discount code has expired.'); end if;
  if coalesce(v_discount.audience,'all')='selected' and not exists (
    select 1 from public.discount_customer_assignments a where a.discount_id=v_discount.id and a.customer_id=auth.uid()
  ) then return jsonb_build_object('valid',false,'message','This discount code is not assigned to your customer account.'); end if;
  if nullif(lower(trim(coalesce(v_discount.assigned_email,''))),'') is not null and lower(trim(v_discount.assigned_email))<>v_email then
    return jsonb_build_object('valid',false,'message','This discount code is assigned to a different customer account.');
  end if;
  select count(*)::integer into v_use_count from public.discount_usage where discount_id=v_discount.id;
  if coalesce(v_discount.max_uses,0)>0 and greatest(v_use_count,coalesce(v_discount.times_used,0),coalesce(v_discount.uses,0))>=v_discount.max_uses then
    return jsonb_build_object('valid',false,'message','This discount code has reached its usage limit.');
  end if;
  if coalesce(v_discount.one_time_use,false) then
    select exists(select 1 from public.discount_usage where discount_id=v_discount.id and lower(trim(coalesce(customer_email,'')))=v_email) into v_used_by_customer;
    if v_used_by_customer then return jsonb_build_object('valid',false,'message','This one-time discount code has already been used by this account.'); end if;
  end if;
  return jsonb_build_object('valid',true,'discount_id',v_discount.id,'code',v_discount.code,'discount_type',v_discount.discount_type,'percent_off',coalesce(v_discount.percent_off,0),'amount_off',coalesce(v_discount.amount_off,0));
end;
$function$
;
