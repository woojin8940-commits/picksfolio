CREATE TABLE "site_data" (
  "username" text PRIMARY KEY,
  "data" jsonb NOT NULL DEFAULT '{}',
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
