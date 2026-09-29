-- pools.occupied_seats is owned by the database: recomputed from ACTIVE memberships
-- after every membership change, so the counter can never drift from reality,
-- whatever the application writes or forgets to write.
CREATE OR REPLACE FUNCTION teslapool_sync_pool_occupancy() RETURNS trigger AS $$
BEGIN
  UPDATE pools p
     SET occupied_seats = (SELECT COALESCE(SUM(m.seats), 0) FROM pool_memberships m
                            WHERE m.pool_id = p.id AND m.status = 'ACTIVE')
   WHERE p.id = NEW.pool_id
      OR (TG_OP = 'UPDATE' AND p.id = OLD.pool_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pool_memberships_sync_occupancy"
  AFTER INSERT OR UPDATE OF status, seats, pool_id ON "pool_memberships"
  FOR EACH ROW EXECUTE FUNCTION teslapool_sync_pool_occupancy();
