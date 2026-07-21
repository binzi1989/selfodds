CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status` text DEFAULT 'predicted' NOT NULL,
	`mode` text NOT NULL,
	`task` text NOT NULL,
	`repository` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`runner_name` text,
	`success_probability` integer NOT NULL,
	`route` text NOT NULL,
	`risk` text NOT NULL,
	`started_at` integer,
	`resolved_at` integer,
	`test_command` text,
	`build_command` text,
	`test_passed` integer,
	`build_passed` integer,
	`diff_within_scope` integer,
	`diff_files` integer,
	`diff_additions` integer,
	`diff_deletions` integer,
	`baseline_commit` text,
	`final_commit` text,
	`outcome` integer,
	`brier` real,
	`failure_code` text,
	`failure_summary` text,
	`assessment_json` text NOT NULL,
	`verification_json` text
);
--> statement-breakpoint
CREATE INDEX `agent_runs_status_created_idx` ON `agent_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_model_resolved_idx` ON `agent_runs` (`model`,`resolved_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_runner_resolved_idx` ON `agent_runs` (`runner_name`,`resolved_at`);