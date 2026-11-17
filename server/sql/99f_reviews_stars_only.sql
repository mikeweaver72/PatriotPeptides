-- 99f (Nov 17 2026): ratings are stars only. Applied as migration ppu_reviews_stars_only.
-- comment must be null (check ppu_reviews_stars_only); ppu_submit_review ignores p_comment and its bell text lists the 4 scores;
-- ppu_public_reviews returns no comment and its recent list includes every approved rating.
-- Full function bodies: see the migration in Supabase (same as 99e with those three changes).
alter table public.ppu_reviews add constraint ppu_reviews_stars_only check (comment is null);
