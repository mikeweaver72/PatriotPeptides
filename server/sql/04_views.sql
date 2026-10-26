create or replace view public.catalog_listing as  SELECT i.display_name,
    i.strength,
    i.price,
    i.category,
    c.sort_name
   FROM (product_inventory i
     LEFT JOIN product_catalog c ON ((c.product_key = i.product_key)))
  WHERE ((i.is_active = true) AND (i.price IS NOT NULL));
