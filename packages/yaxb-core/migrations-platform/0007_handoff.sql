-- Signing in on a kiosk by scanning (IDN-19): the level the phone that approved it was signed in
-- at, so the kiosk's short session is never stronger than the phone's sign-in.
ALTER TABLE device_grants ADD COLUMN level INTEGER;
