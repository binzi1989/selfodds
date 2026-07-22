CREATE TABLE `agency_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`profile_id` text NOT NULL,
	`profile_name` text NOT NULL,
	`profile_version` text,
	`definition_hash` text,
	`probability` integer NOT NULL,
	`raw_probability` integer,
	`calibrated_probability` integer,
	`confidence` text,
	`risk` text,
	`route` text,
	`verdict` text,
	`findings_json` text,
	`veto_reason` text,
	`calibration_metadata_json` text,
	`metadata_json` text,
	`outcome` integer,
	`brier` real,
	`raw_brier` real,
	`calibrated_brier` real,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agency_votes_run_idx` ON `agency_votes` (`run_id`);--> statement-breakpoint
CREATE INDEX `agency_votes_profile_resolved_idx` ON `agency_votes` (`profile_id`,`resolved_at`);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `profile_version` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `definition_hash` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `task_class` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `selection_strategy` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `raw_probability` integer;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `calibrated_probability` integer;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `calibration_method` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `calibration_sample_size` integer;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `calibration_metadata_json` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `raw_brier` real;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `calibrated_brier` real;--> statement-breakpoint
CREATE INDEX `agent_runs_profile_resolved_idx` ON `agent_runs` (`profile_id`,`resolved_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_task_class_resolved_idx` ON `agent_runs` (`task_class`,`resolved_at`);