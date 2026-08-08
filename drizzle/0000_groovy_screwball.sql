CREATE TABLE `sightings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`activity` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`happened_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
