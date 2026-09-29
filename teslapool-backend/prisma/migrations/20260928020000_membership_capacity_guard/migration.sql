-- Database-level overbooking guard (defence in depth).
--
-- pools.occupied_seats has a CHECK, but a counter is only as good as the code that
-- writes it: concurrent writers that skip the application's row lock each write the
-- same stale value and every copy passes the CHECK. This trigger instead locks the
-- pool row itself and sums the REAL active seats, so no code path can place more
-- passengers in a pool than it has seats. The application already holds this lock
-- (pool -> ride order), so the lock here is re-entrant and cannot deadlock.
CREATE OR REPLACE FUNCTION teslapool_guard_pool_capacity() RETURNS trigger AS $$
DECLARE
  pool_capacity SMALLINT;
  active_seats  INTEGER;
BEGIN
  IF NEW.status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  SELECT capacity INTO pool_capacity FROM pools WHERE id = NEW.pool_id FOR UPDATE;
  SELECT COALESCE(SUM(seats), 0) INTO active_seats
    FROM pool_memberships
   WHERE pool_id = NEW.pool_id AND status = 'ACTIVE' AND id <> NEW.id;
  IF active_seats + NEW.seats > pool_capacity THEN
    RAISE EXCEPTION 'TESLAPOOL_CAPACITY_GUARD: pool % would hold % seats (capacity %)',
      NEW.pool_id, active_seats + NEW.seats, pool_capacity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pool_memberships_capacity_guard"
  BEFORE INSERT OR UPDATE OF status, seats, pool_id ON "pool_memberships"
  FOR EACH ROW EXECUTE FUNCTION teslapool_guard_pool_capacity();
