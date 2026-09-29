-- "Tesla" in the PRD is Dhaka slang for an auto-rickshaw (Jashim's three-seat "Bullet"), not a
-- separate vehicle class. Collapse TESLA and CNG_AUTO_RICKSHAW into one AUTO_RICKSHAW type.
-- PostgreSQL cannot drop enum values, so the type is rebuilt and existing rows are mapped.
ALTER TYPE "VehicleType" RENAME TO "VehicleType_old";
CREATE TYPE "VehicleType" AS ENUM ('AUTO_RICKSHAW', 'RICKSHAW', 'BIKE_RIDESHARE');

ALTER TABLE "vehicles" ALTER COLUMN "vehicle_type" TYPE "VehicleType"
  USING (CASE WHEN "vehicle_type"::text IN ('TESLA', 'CNG_AUTO_RICKSHAW') THEN 'AUTO_RICKSHAW' ELSE "vehicle_type"::text END)::"VehicleType";
ALTER TABLE "ride_requests" ALTER COLUMN "vehicle_type" TYPE "VehicleType"
  USING (CASE WHEN "vehicle_type"::text IN ('TESLA', 'CNG_AUTO_RICKSHAW') THEN 'AUTO_RICKSHAW' ELSE "vehicle_type"::text END)::"VehicleType";

DROP TYPE "VehicleType_old";
