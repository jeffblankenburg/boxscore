-- Fix: team subscriptions couldn't span sports that share a team slug.
--
-- email_subscriptions_team_unique (from 0013) was keyed on
-- (subscriber_id, team_id) WHERE scope='team' — it OMITS sport. Every other
-- scope's uniqueness includes sport (league: (subscriber_id, sport);
-- conference: (subscriber_id, sport, team_id)). Team was the lone exception.
--
-- Because slugs repeat across leagues ('cle' = NBA Cavaliers, MLB Guardians,
-- NFL Browns; likewise 'phi', 'was', 'chi', …), a subscriber could hold a
-- given slug in only ONE sport. Subscribing to the same-slug team in a second
-- sport hit a duplicate-key; the app's insert-then-reconcile helper filters
-- the reconcile by sport, matched zero rows, and silently no-op'd — so the
-- checkbox reverted on refresh. (Reported: a user could add the 76ers but not
-- the Cavs, because they already followed a 'cle' team in another sport.)
--
-- The app write path (setTeamSubscription) already scopes every update/insert/
-- reconcile by sport, so it's correct as-is once the index matches its intent.
-- The new index is strictly more permissive than the old one, so existing rows
-- can't violate it (verified: zero subscribers held a slug in >1 sport, which
-- is exactly the symptom).

drop index if exists public.email_subscriptions_team_unique;

create unique index if not exists email_subscriptions_team_unique
  on public.email_subscriptions (subscriber_id, sport, team_id)
  where scope = 'team';

notify pgrst, 'reload schema';
