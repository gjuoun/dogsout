CREATE TABLE `ask_log` (
	`id` text PRIMARY KEY NOT NULL,
	`principal` text NOT NULL,
	`session_id` text,
	`requested_at` text NOT NULL,
	`keys_json` text NOT NULL,
	`key_count` integer NOT NULL,
	`decision` text NOT NULL,
	`ttl` text,
	`decided_at` text,
	`decided_via` text
);
