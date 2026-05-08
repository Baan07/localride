CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('passenger', 'driver', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('requested', 'accepted', 'driver_arriving', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'rejected', 'refunded', 'cash_due');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  phone text,
  role user_role NOT NULL DEFAULT 'passenger',
  blocked_at timestamptz,
  blocked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason text;

CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  vehicle_color text NOT NULL,
  plate text NOT NULL UNIQUE,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  online boolean NOT NULL DEFAULT false,
  rating numeric(3,2) NOT NULL DEFAULT 5.00,
  last_location geography(Point, 4326),
  last_location_at timestamptz
);

CREATE INDEX IF NOT EXISTS driver_profiles_location_idx ON driver_profiles USING gist(last_location);
CREATE INDEX IF NOT EXISTS driver_profiles_online_idx ON driver_profiles(online, verification_status);

CREATE TABLE IF NOT EXISTS fare_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL DEFAULT 'Mi localidad',
  base_fare numeric(12,2) NOT NULL DEFAULT 900,
  minimum_fare numeric(12,2) NOT NULL DEFAULT 1500,
  price_per_km numeric(12,2) NOT NULL DEFAULT 420,
  price_per_minute numeric(12,2) NOT NULL DEFAULT 80,
  platform_fee_percent numeric(5,2) NOT NULL DEFAULT 12,
  cancellation_grace_minutes integer NOT NULL DEFAULT 3,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid REFERENCES users(id),
  status trip_status NOT NULL DEFAULT 'requested',
  pickup_address text NOT NULL,
  dropoff_address text NOT NULL,
  pickup_location geography(Point, 4326) NOT NULL,
  dropoff_location geography(Point, 4326) NOT NULL,
  distance_meters integer NOT NULL,
  duration_seconds integer NOT NULL,
  fare_amount numeric(12,2) NOT NULL,
  platform_fee numeric(12,2) NOT NULL,
  payment_method text NOT NULL,
  passenger_rating integer CHECK (passenger_rating BETWEEN 1 AND 5),
  passenger_rating_comment text,
  cancellation_reason text,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trips_pickup_location_idx ON trips USING gist(pickup_location);
CREATE INDEX IF NOT EXISTS trips_status_idx ON trips(status, created_at DESC);
CREATE INDEX IF NOT EXISTS trips_driver_idx ON trips(driver_id, status);
CREATE INDEX IF NOT EXISTS trips_passenger_idx ON trips(passenger_id, status);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS passenger_rating integer CHECK (passenger_rating BETWEEN 1 AND 5);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS passenger_rating_comment text;
ALTER TABLE fare_rules ADD COLUMN IF NOT EXISTS minimum_fare numeric(12,2) NOT NULL DEFAULT 1500;

CREATE TABLE IF NOT EXISTS driver_trip_dismissals (
  driver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, trip_id)
);

CREATE TABLE IF NOT EXISTS trip_locations (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES users(id),
  location geography(Point, 4326) NOT NULL,
  heading numeric(6,2),
  speed_kmh numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_locations_trip_idx ON trip_locations(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trip_locations_location_idx ON trip_locations USING gist(location);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_reference text,
  preference_id text,
  init_point text,
  status payment_status NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_idx ON payments(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_trip_idx ON payments(trip_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  cache_key text PRIMARY KEY,
  query text NOT NULL,
  provider text NOT NULL DEFAULT 'nominatim',
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE INDEX IF NOT EXISTS geocode_cache_expires_idx ON geocode_cache(expires_at);

CREATE TABLE IF NOT EXISTS user_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  address text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  kind text NOT NULL DEFAULT 'recent',
  use_count integer NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_locations_user_idx ON user_locations(user_id, last_used_at DESC);
CREATE INDEX IF NOT EXISTS user_locations_location_idx ON user_locations USING gist(location);

CREATE TABLE IF NOT EXISTS error_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  method text,
  path text,
  status integer NOT NULL,
  message text NOT NULL,
  stack text,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS error_logs_created_idx ON error_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, subscription)
);

INSERT INTO fare_rules(city, base_fare, minimum_fare, price_per_km, price_per_minute, platform_fee_percent)
VALUES ('Mi localidad', 900, 1500, 420, 80, 12)
ON CONFLICT DO NOTHING;
