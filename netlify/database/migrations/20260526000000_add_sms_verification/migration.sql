CREATE TABLE IF NOT EXISTS sms_verifications (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'general',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sms_verifications_phone_purpose ON sms_verifications (phone, purpose, verified);
CREATE INDEX idx_sms_verifications_expires ON sms_verifications (expires_at);
