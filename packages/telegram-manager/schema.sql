CREATE TABLE "telegram_pairings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "secret_hash" text NOT NULL,
  "suggested_username" text NOT NULL UNIQUE,
  "owner_user_id" text,
  "bot_id" text,
  "bot_username" text,
  "expires_at" timestamp with time zone NOT NULL
);
