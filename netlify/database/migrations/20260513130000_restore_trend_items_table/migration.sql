CREATE TABLE "trend_items" (
	"id" serial PRIMARY KEY,
	"cid" integer NOT NULL,
	"category_label" text NOT NULL,
	"rank" integer NOT NULL,
	"keyword" text NOT NULL,
	"title" text NOT NULL,
	"trend" text NOT NULL,
	"change_rate" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
