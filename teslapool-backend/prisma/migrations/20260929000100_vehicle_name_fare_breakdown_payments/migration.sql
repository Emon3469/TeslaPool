-- ── Vehicle name (e.g. "Bullet") ─────────────────────────────────────────────
ALTER TABLE "vehicles" ADD COLUMN "name" VARCHAR(40);
UPDATE "vehicles" SET "name" = "registration_number" WHERE "name" IS NULL;   -- backfill legacy rows
ALTER TABLE "vehicles" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_name_chk" CHECK (length(btrim("name")) BETWEEN 1 AND 40);

-- ── Frozen, itemised solo fare + payment method on each ride ────────────────
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TESLAPAY');
ALTER TABLE "ride_requests"
  ADD COLUMN "traffic_level" VARCHAR(10),
  ADD COLUMN "pricing_duration_min" DOUBLE PRECISION,
  ADD COLUMN "base_fare_poysha" INTEGER,
  ADD COLUMN "distance_charge_poysha" INTEGER,
  ADD COLUMN "time_charge_poysha" INTEGER,
  ADD COLUMN "payment_method" "PaymentMethod" NOT NULL DEFAULT 'CASH';
-- All-or-nothing breakdown (legacy rows created before this migration have none), never negative.
ALTER TABLE "ride_requests"
  ADD CONSTRAINT "ride_requests_breakdown_chk" CHECK (
    ("base_fare_poysha" IS NULL AND "distance_charge_poysha" IS NULL AND "time_charge_poysha" IS NULL AND "pricing_duration_min" IS NULL AND "traffic_level" IS NULL)
    OR ("base_fare_poysha" >= 0 AND "distance_charge_poysha" >= 0 AND "time_charge_poysha" >= 0 AND "pricing_duration_min" > 0
        AND "traffic_level" IN ('LOW', 'MEDIUM', 'HIGH', 'GRIDLOCK')));

-- ── Simulated TeslaPay wallet (database-owned balance) ──────────────────────
ALTER TABLE "users" ADD COLUMN "wallet_balance_poysha" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_wallet_non_negative_chk" CHECK ("wallet_balance_poysha" >= 0);

CREATE TYPE "WalletTransactionType" AS ENUM ('TOP_UP', 'RIDE_PAYMENT', 'RIDE_EARNING');
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ride_request_id" UUID,
    "type" "WalletTransactionType" NOT NULL,
    "amount_poysha" INTEGER NOT NULL,
    "balance_after_poysha" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_transactions_amount_chk" CHECK ("amount_poysha" <> 0),
    CONSTRAINT "wallet_transactions_balance_chk" CHECK ("balance_after_poysha" >= 0),
    -- Direction must match the type: top-ups and earnings credit, ride payments debit.
    CONSTRAINT "wallet_transactions_sign_chk" CHECK (
      ("type" IN ('TOP_UP', 'RIDE_EARNING') AND "amount_poysha" > 0) OR ("type" = 'RIDE_PAYMENT' AND "amount_poysha" < 0)),
    CONSTRAINT "wallet_transactions_ride_chk" CHECK (("type" = 'TOP_UP') = ("ride_request_id" IS NULL))
);
CREATE INDEX "wallet_transactions_user_id_created_at_idx" ON "wallet_transactions"("user_id", "created_at" DESC);
-- A ride is paid / earned at most once: settlement is idempotent at the database level.
CREATE UNIQUE INDEX "wallet_transactions_one_per_ride_and_type"
  ON "wallet_transactions"("ride_request_id", "type") WHERE "ride_request_id" IS NOT NULL;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The ledger is the source of truth: inserting a row locks the user, computes balance_after,
-- refuses an overdraft, and moves the balance, all atomically with the insert.
CREATE OR REPLACE FUNCTION teslapool_apply_wallet_transaction() RETURNS trigger AS $$
DECLARE
  current_balance INTEGER;
BEGIN
  SELECT wallet_balance_poysha INTO current_balance FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'wallet owner % not found', NEW.user_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.balance_after_poysha := current_balance + NEW.amount_poysha;
  IF NEW.balance_after_poysha < 0 THEN
    RAISE EXCEPTION 'TESLAPOOL_INSUFFICIENT_FUNDS: balance % poysha, debit % poysha', current_balance, -NEW.amount_poysha
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE users SET wallet_balance_poysha = NEW.balance_after_poysha WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallet_transactions_apply"
  BEFORE INSERT ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION teslapool_apply_wallet_transaction();
CREATE TRIGGER "wallet_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION teslapool_reject_mutation();

-- ── Payments: one immutable settlement per completed ride ───────────────────
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_poysha" INTEGER NOT NULL,
    "settled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_chk" CHECK ("amount_poysha" >= 0)
);
CREATE UNIQUE INDEX "payments_ride_request_id_key" ON "payments"("ride_request_id");
CREATE INDEX "payments_passenger_id_idx" ON "payments"("passenger_id");
CREATE INDEX "payments_driver_id_settled_at_idx" ON "payments"("driver_id", "settled_at");
ALTER TABLE "payments" ADD CONSTRAINT "payments_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "payments_append_only"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION teslapool_reject_mutation();
