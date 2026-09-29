-- Bangladeshi plates such as "DHAKA-METRO-TA-11-2233" exceed 20 characters.
ALTER TABLE "vehicles" ALTER COLUMN "registration_number" TYPE VARCHAR(32);
