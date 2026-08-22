-- CTP no longer carries — "you either get it or you don't" (Kyle 2026-08-22).
--
-- The seed shipped ctp_carry_mode = 'carry' (an unclaimed closest-to-pin pot rolled
-- forward to the round's next par 3). Kyle wants each par 3's CTP decided on that hole:
-- won by the closest player, or, with no winner, its pot returned to the buy-in
-- contributors — never carried on. That is the mode the settings validator already calls
-- 'return' (rpc_upsert_settings accepts 'carry' | 'return'; buildMoney treats anything
-- other than 'carry' as return-to-contributors).
--
-- Flip the stored value on databases already seeded with 'carry'. Fresh installs get the
-- new default from the code (money.ts / compute.ts) and from this UPDATE being a no-op.
update public.settings set value = '"return"'::jsonb
 where key = 'ctp_carry_mode' and value = '"carry"'::jsonb;
