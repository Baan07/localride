INSERT INTO users(name, email, password_hash, phone, role)
VALUES
  ('Admin LocalRide', 'admin@localride.test', '$2b$10$localride.seed.hash.replace', '+549000000001', 'admin'),
  ('Pasajero Demo', 'pasajero@localride.test', '$2b$10$localride.seed.hash.replace', '+549000000002', 'passenger'),
  ('Ana Ruiz', 'ana@localride.test', '$2b$10$localride.seed.hash.replace', '+549000000003', 'driver')
ON CONFLICT (email) DO NOTHING;

INSERT INTO driver_profiles(user_id, vehicle_make, vehicle_model, vehicle_color, plate, verification_status, online, rating, last_location)
SELECT id, 'Fiat', 'Cronos', 'Gris', 'AB314CD', 'approved', true, 4.90, ST_SetSRID(ST_MakePoint(-58.3816, -34.6037), 4326)::geography
FROM users WHERE email = 'ana@localride.test'
ON CONFLICT (user_id) DO NOTHING;
