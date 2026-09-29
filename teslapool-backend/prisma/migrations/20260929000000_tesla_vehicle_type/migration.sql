-- The PRD's vehicle: a three-seat, battery-powered "Tesla" (electric three-wheeler), e.g. Jashim's "Bullet".
-- Kept in its own migration: PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE "VehicleType" ADD VALUE IF NOT EXISTS 'TESLA' BEFORE 'CNG_AUTO_RICKSHAW';
