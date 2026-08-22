export const LAST_ERROR_CODES = [
  "handler_failed",
  "unknown_kind",
  "invalid_payload",
  "lease_expired",
] as const;

export const ENQUEUE_ERROR_CODES = [
  "invalid_payload",
  "dedupe_payload_conflict",
  "storage_failure",
] as const;

export const OWNERSHIP_ERROR_CODES = ["lease_lost", "storage_failure"] as const;
export const CLAIM_EMPTY_ERROR_CODES = ["no_job", "storage_failure"] as const;

export const ONE_SHOT_OUTCOME_CODES = [
  "no_job",
  "job_succeeded",
  "job_retry_scheduled",
  "job_dead",
] as const;

export const WORKER_ERROR_CODES = [
  "worker_disabled",
  "worker_invalid_arguments",
  "worker_database_url_invalid",
  "worker_database_unavailable",
  "storage_failure",
] as const;

export type LastErrorCode = (typeof LAST_ERROR_CODES)[number];
export type OwnershipErrorCode = (typeof OWNERSHIP_ERROR_CODES)[number];
export type OneShotOutcomeCode = (typeof ONE_SHOT_OUTCOME_CODES)[number];
