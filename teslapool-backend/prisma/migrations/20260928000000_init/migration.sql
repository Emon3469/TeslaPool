-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CNG_AUTO_RICKSHAW', 'RICKSHAW', 'BIKE_RIDESHARE');

-- CreateEnum
CREATE TYPE "Zone" AS ENUM ('BANANI', 'GULSHAN', 'MOHAKHALI', 'UTTARA', 'MIRPUR', 'DHANMONDI', 'FARMGATE', 'AZIMPUR', 'BASHUNDHARA_RA', 'MOTIJHEEL');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('OPEN', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'LEFT', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PredictionType" AS ENUM ('ETA', 'FARE');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "phone" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "registration_number" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_requests" (
    "id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "pickup_zone" "Zone" NOT NULL,
    "dropoff_zone" "Zone" NOT NULL,
    "pickup_lat" DOUBLE PRECISION,
    "pickup_lng" DOUBLE PRECISION,
    "dropoff_lat" DOUBLE PRECISION,
    "dropoff_lng" DOUBLE PRECISION,
    "requested_seats" SMALLINT NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "estimated_distance_km" DOUBLE PRECISION NOT NULL,
    "distance_source" VARCHAR(32) NOT NULL,
    "estimated_duration_min" DOUBLE PRECISION NOT NULL,
    "quoted_fare_poysha" INTEGER NOT NULL,
    "fare_source" VARCHAR(16) NOT NULL,
    "final_fare_poysha" INTEGER,
    "status" "RideStatus" NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "status" "PoolStatus" NOT NULL DEFAULT 'OPEN',
    "capacity" SMALLINT NOT NULL,
    "occupied_seats" SMALLINT NOT NULL DEFAULT 0,
    "planned_stops" JSONB NOT NULL DEFAULT '[]',
    "route_data" JSONB,
    "total_distance_km" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_memberships" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "seats" SMALLINT NOT NULL,
    "pickup_sequence" SMALLINT NOT NULL,
    "dropoff_sequence" SMALLINT NOT NULL,
    "detour_km" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shared_fraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "solo_fare_poysha" INTEGER NOT NULL,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "fare_poysha" INTEGER NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pool_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_events" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "pool_id" UUID,
    "event_type" VARCHAR(40) NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20),
    "actor_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_events" (
    "id" UUID NOT NULL,
    "ride_request_id" UUID,
    "model_name" VARCHAR(64) NOT NULL,
    "model_version" VARCHAR(32) NOT NULL,
    "prediction_type" "PredictionType" NOT NULL,
    "prediction_value" DOUBLE PRECISION NOT NULL,
    "used_for_decision" BOOLEAN NOT NULL,
    "feature_snapshot" JSONB NOT NULL,
    "metadata" JSONB,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" SMALLINT,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registration_number_key" ON "vehicles"("registration_number");

-- CreateIndex
CREATE INDEX "vehicles_driver_id_idx" ON "vehicles"("driver_id");

-- CreateIndex
CREATE INDEX "ride_requests_passenger_id_created_at_idx" ON "ride_requests"("passenger_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ride_requests_status_idx" ON "ride_requests"("status");

-- CreateIndex
CREATE INDEX "pools_status_created_at_idx" ON "pools"("status", "created_at");

-- CreateIndex
CREATE INDEX "pools_driver_id_idx" ON "pools"("driver_id");

-- CreateIndex
CREATE INDEX "pools_vehicle_id_idx" ON "pools"("vehicle_id");

-- CreateIndex
CREATE INDEX "pool_memberships_pool_id_status_idx" ON "pool_memberships"("pool_id", "status");

-- CreateIndex
CREATE INDEX "pool_memberships_passenger_id_idx" ON "pool_memberships"("passenger_id");

-- CreateIndex
CREATE INDEX "pool_memberships_ride_request_id_idx" ON "pool_memberships"("ride_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "ride_events_seq_key" ON "ride_events"("seq");

-- CreateIndex
CREATE INDEX "ride_events_ride_request_id_created_at_idx" ON "ride_events"("ride_request_id", "created_at");

-- CreateIndex
CREATE INDEX "ride_events_pool_id_idx" ON "ride_events"("pool_id");

-- CreateIndex
CREATE INDEX "prediction_events_ride_request_id_idx" ON "prediction_events"("ride_request_id");

-- CreateIndex
CREATE INDEX "prediction_events_model_name_model_version_created_at_idx" ON "prediction_events"("model_name", "model_version", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_memberships" ADD CONSTRAINT "pool_memberships_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_memberships" ADD CONSTRAINT "pool_memberships_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_memberships" ADD CONSTRAINT "pool_memberships_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_events" ADD CONSTRAINT "prediction_events_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written constraints (not expressible in schema.prisma).
-- The database is the last line of defence: even a buggy code path cannot
-- overbook a vehicle, double-book a ride, or rewrite history.
-- ════════════════════════════════════════════════════════════════════════════

-- Users
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));

-- Vehicles
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_capacity_chk" CHECK ("capacity" BETWEEN 1 AND 8);

-- Ride requests
ALTER TABLE "ride_requests"
  ADD CONSTRAINT "ride_requests_seats_chk" CHECK ("requested_seats" BETWEEN 1 AND 8),
  ADD CONSTRAINT "ride_requests_distinct_zones_chk" CHECK ("pickup_zone" <> "dropoff_zone"),
  ADD CONSTRAINT "ride_requests_distance_chk" CHECK ("estimated_distance_km" > 0),
  ADD CONSTRAINT "ride_requests_duration_chk" CHECK ("estimated_duration_min" > 0),
  ADD CONSTRAINT "ride_requests_quoted_fare_chk" CHECK ("quoted_fare_poysha" >= 0),
  ADD CONSTRAINT "ride_requests_final_fare_chk" CHECK ("final_fare_poysha" IS NULL OR "final_fare_poysha" >= 0),
  ADD CONSTRAINT "ride_requests_pickup_coords_chk" CHECK (
    ("pickup_lat" IS NULL AND "pickup_lng" IS NULL) OR
    ("pickup_lat" BETWEEN -90 AND 90 AND "pickup_lng" BETWEEN -180 AND 180)),
  ADD CONSTRAINT "ride_requests_dropoff_coords_chk" CHECK (
    ("dropoff_lat" IS NULL AND "dropoff_lng" IS NULL) OR
    ("dropoff_lat" BETWEEN -90 AND 90 AND "dropoff_lng" BETWEEN -180 AND 180));

-- A passenger may have at most one ride in progress (also makes duplicate submissions harmless).
CREATE UNIQUE INDEX "ride_requests_one_active_per_passenger"
  ON "ride_requests" ("passenger_id")
  WHERE "status" IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED');

-- Pools: occupancy can never exceed capacity, whatever the application does.
ALTER TABLE "pools"
  ADD CONSTRAINT "pools_capacity_chk" CHECK ("capacity" BETWEEN 1 AND 8),
  ADD CONSTRAINT "pools_occupancy_chk" CHECK ("occupied_seats" >= 0 AND "occupied_seats" <= "capacity"),
  ADD CONSTRAINT "pools_distance_chk" CHECK ("total_distance_km" >= 0),
  ADD CONSTRAINT "pools_version_chk" CHECK ("version" >= 1);

-- One live pool per vehicle and per driver.
CREATE UNIQUE INDEX "pools_one_active_per_vehicle"
  ON "pools" ("vehicle_id") WHERE "status" IN ('OPEN', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED');
CREATE UNIQUE INDEX "pools_one_active_per_driver"
  ON "pools" ("driver_id") WHERE "status" IN ('OPEN', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED');

-- Memberships
ALTER TABLE "pool_memberships"
  ADD CONSTRAINT "pool_memberships_seats_chk" CHECK ("seats" >= 1),
  ADD CONSTRAINT "pool_memberships_sequence_chk" CHECK ("pickup_sequence" >= 0 AND "dropoff_sequence" > "pickup_sequence"),
  ADD CONSTRAINT "pool_memberships_detour_chk" CHECK ("detour_km" >= 0),
  ADD CONSTRAINT "pool_memberships_shared_chk" CHECK ("shared_fraction" BETWEEN 0 AND 1),
  ADD CONSTRAINT "pool_memberships_discount_chk" CHECK ("discount_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "pool_memberships_fares_chk" CHECK ("solo_fare_poysha" >= 0 AND "fare_poysha" >= 0 AND "fare_poysha" <= "solo_fare_poysha");

-- A ride request can hold at most ONE active membership: no duplicate joins, no double-pooling.
-- (Partial, so a passenger who left a pool may later rejoin it with a new membership row.)
CREATE UNIQUE INDEX "pool_memberships_one_active_per_ride"
  ON "pool_memberships" ("ride_request_id") WHERE "status" = 'ACTIVE';

-- Idempotency
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_key_chk" CHECK (length("key") BETWEEN 1 AND 128);

-- Immutable audit tables: history is append-only.
CREATE OR REPLACE FUNCTION teslapool_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ride_events_append_only"
  BEFORE UPDATE OR DELETE ON "ride_events"
  FOR EACH ROW EXECUTE FUNCTION teslapool_reject_mutation();

CREATE TRIGGER "prediction_events_append_only"
  BEFORE UPDATE OR DELETE ON "prediction_events"
  FOR EACH ROW EXECUTE FUNCTION teslapool_reject_mutation();
