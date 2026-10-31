-- The workspace clock replaced the demo-only clock setting. A v12 database
-- stores the pinned demo clock under `demo_now`; carry the value across so a
-- demo workspace keeps its authored dates, then retire the old key.
UPDATE app_settings SET key = 'workspace_clock' WHERE key = 'demo_now';

-- Existing demo organizations keep their flag; a fresh demo seed sets it on
-- insert. This backfills the row migration 0012 could not know about.
UPDATE organizations SET is_demo = 1 WHERE id = 'org-rivergate-kitchen';
