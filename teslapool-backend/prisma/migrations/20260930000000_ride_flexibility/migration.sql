-- Per-rider urgency. It sets the rider's OWN detour limit (URGENT: almost direct, FLEXIBLE: accepts more);
-- every route must satisfy every rider's limit, so one rider's urgency never lengthens another's trip beyond theirs.
CREATE TYPE "RideFlexibility" AS ENUM ('URGENT', 'STANDARD', 'FLEXIBLE');
ALTER TABLE "ride_requests" ADD COLUMN "flexibility" "RideFlexibility" NOT NULL DEFAULT 'STANDARD';
