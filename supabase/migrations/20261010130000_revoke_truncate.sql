-- 2026-10-10 — Take TRUNCATE (and the unused REFERENCES / TRIGGER) away from the API roles.
--
-- Supabase's default privileges grant anon and authenticated TRUNCATE, REFERENCES and TRIGGER
-- on every table created in `public`. RLS does not apply to TRUNCATE, so a role that can reach
-- one could empty a table in a single statement, policies notwithstanding. PostgREST exposes
-- no TRUNCATE today, but nothing in the app needs these privileges, so they go (pinned review
-- 2026-09-28). Reads stay on SELECT + RLS; every write stays behind a SECURITY DEFINER RPC.
--
-- Default privileges (for postgres, the role migrations run as) are revoked too, so a table added by a later migration does not
-- quietly bring them back.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
