/**
 * H-CYCLE の週次投影は、DB / clock / LLM を持たない pure module である。
 *
 * Gate と Misconception の現在行は過去の状態を表さない。入力には、A7-B で
 * append-only に保存する state / failure-capture / follow-up evidence だけを渡す。
 */

export const H_CYCLE_POLICY_VERSION_V1 = "h_cycle_evidence_v1" as const;
export const H_CYCLE_COHORT_KINDS_V1 = Object.freeze({
  selfAssessmentRate: "period_first_observed_revision",
  actionableCheckCount: "as_of_actionable_revision_snapshot",
  explicitPromotionRate: "as_of_actionable_revision",
  answeredPromotedGateRate: "period_origin_gate",
  gradedPromotedGateRate: "period_origin_gate",
  failedTriageRate: "as_of_verified_failed_state_event",
  scheduledFollowupRate: "as_of_accepted_direct_capture",
  evidenceClosureRate: "period_origin_gate",
} as const);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const MASTERY_VALUES = ["clear", "partial", "stuck", "parked"] as const;
const GATE_STATUSES = [
  "pending",
  "answered",
  "grading",
  "grading_failed",
  "passed",
  "failed",
  "self_graded_pass",
  "self_graded_fail",
  "dismissed",
  "parked",
] as const;
const CAPTURE_STATUSES = ["pending", "accepted", "ignored", "expired"] as const;

export type HCycleMastery = (typeof MASTERY_VALUES)[number];
export type HCycleGateStatus = (typeof GATE_STATUSES)[number];
export type HCycleCaptureStatus = (typeof CAPTURE_STATUSES)[number];

export type EvidenceRate =
  | Readonly<{ status: "measured"; numerator: number; denominator: number; ratio: number }>
  | Readonly<{ status: "not_applicable"; numerator: 0; denominator: 0; reason: "zero_denominator" }>
  | Readonly<{ status: "incomplete"; numerator: number; denominator: number; reason: string }>;

export type HCycleCount =
  | Readonly<{ status: "measured"; count: number }>
  | Readonly<{ status: "incomplete"; count: number; reason: string }>;

export type HCyclePeriodV1 = Readonly<{
  weekKey: string;
  start: Date;
  end: Date;
  asOf: Date;
}>;

export type HCycleSourceRevisionV1 = Readonly<{
  sourceKind: "daily" | "weekly";
  textbookKey: string;
  source: "auto" | "compiled";
  checkIndex: number;
  sourceRevisionHash: string;
  firstObservedAt: Date;
  masteryEvents: readonly Readonly<{ mastery: HCycleMastery; recordedAt: Date }>[];
}>;

export type HCyclePromotionV1 = Readonly<{
  gateId: string;
  sourceKind: "daily" | "weekly";
  textbookKey: string;
  source: "auto" | "compiled";
  checkIndex: number;
  sourceRevisionHash: string;
  originCreatedAt: Date;
}>;

export type HCycleGateStateEventV1 = Readonly<{
  id: string;
  gateId: string;
  ordinal: number;
  status: HCycleGateStatus;
  recordedAt: Date;
}>;

export type HCycleFailureCaptureV1 = Readonly<{
  id: string;
  failedStateEventId: string;
  captureId: string;
  capturedAt: Date;
  sourceTool: string;
  parsedGateId: string | null;
  status: HCycleCaptureStatus;
  reviewedAt: Date | null;
  misconceptionId: string | null;
}>;

export type HCycleFollowupObservationV1 = Readonly<{
  id: string;
  failureCaptureId: string;
  misconceptionId: string;
  scheduledFor: Date;
  observedAt: Date;
}>;

export type HCycleEvidenceProjectionInputV1 = Readonly<{
  period: HCyclePeriodV1;
  sourceRevisions: readonly HCycleSourceRevisionV1[];
  promotions: readonly HCyclePromotionV1[];
  gateStateEvents: readonly HCycleGateStateEventV1[];
  failureCaptures: readonly HCycleFailureCaptureV1[];
  followupObservations: readonly HCycleFollowupObservationV1[];
}>;

export type HCycleEvidenceProjectionV1 = Readonly<{
  schema: "h_cycle_evidence_projection_v1";
  policyVersion: typeof H_CYCLE_POLICY_VERSION_V1;
  period: Readonly<{ weekKey: string; start: string; end: string; asOf: string }>;
  cohortKinds: typeof H_CYCLE_COHORT_KINDS_V1;
  selfAssessmentRate: EvidenceRate;
  actionableCheckCount: HCycleCount;
  explicitPromotionRate: EvidenceRate;
  answeredPromotedGateRate: EvidenceRate;
  gradedPromotedGateRate: EvidenceRate;
  failedTriageRate: EvidenceRate;
  scheduledFollowupRate: EvidenceRate;
  evidenceClosureRate: EvidenceRate;
  diagnostics: Readonly<Record<string, number>>;
}>;

export type HCycleEvidencePolicyStatusV1 =
  | "baseline_collecting"
  | "inconclusive"
  | "supported"
  | "rejected";

export type HCycleEvidencePolicyResultV1 = Readonly<{
  schema: "h_cycle_evidence_policy_v1";
  policyVersion: typeof H_CYCLE_POLICY_VERSION_V1;
  status: HCycleEvidencePolicyStatusV1;
  requiredAdjacentWindows: 2;
  evaluatedWeekKeys: readonly string[];
  reasons: readonly string[];
}>;

type SourceRevision = HCycleSourceRevisionV1 & {
  key: string;
  firstObservedAtMs: number;
  masteryHistoryValid: boolean;
};
type Promotion = HCyclePromotionV1 & { key: string; originCreatedAtMs: number };
type StateEvent = HCycleGateStateEventV1 & { recordedAtMs: number };
type FailureCapture = HCycleFailureCaptureV1 & { capturedAtMs: number; reviewedAtMs: number | null };
type FollowupObservation = HCycleFollowupObservationV1 & {
  observedAtMs: number;
  scheduledForMs: number;
};

type GateStateAtAsOf = Readonly<{
  state: HCycleGateStatus;
  stateEvent: StateEvent | null;
  answered: boolean;
  valid: boolean;
}>;

type FailureCaptureAtAsOf = Readonly<{
  capture: FailureCapture;
  terminal: boolean;
  accepted: boolean;
  valid: boolean;
}>;

const objectFreeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function isOneOf<const T extends readonly string[]>(values: T, raw: unknown): raw is T[number] {
  return typeof raw === "string" && (values as readonly string[]).includes(raw);
}

function dateMs(raw: unknown): number | null {
  if (!(raw instanceof Date)) return null;
  const value = raw.getTime();
  return Number.isFinite(value) ? value : null;
}

function isNonEmptyString(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim().length > 0;
}

function isSafeNonNegativeInteger(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0;
}

function sourceKey(input: {
  sourceKind: string;
  textbookKey: string;
  source: string;
  checkIndex: number;
  sourceRevisionHash: string;
}): string {
  return [input.sourceKind, input.textbookKey, input.source, String(input.checkIndex), input.sourceRevisionHash].join("\u001f");
}

function measured(numerator: number, denominator: number): EvidenceRate {
  if (denominator === 0) {
    return objectFreeze({ status: "not_applicable" as const, numerator: 0 as const, denominator: 0 as const, reason: "zero_denominator" as const });
  }
  return objectFreeze({ status: "measured" as const, numerator, denominator, ratio: numerator / denominator });
}

function incomplete(numerator: number, denominator: number, reason: string): EvidenceRate {
  if (denominator === 0) {
    return objectFreeze({ status: "not_applicable" as const, numerator: 0 as const, denominator: 0 as const, reason: "zero_denominator" as const });
  }
  return objectFreeze({ status: "incomplete" as const, numerator, denominator, reason });
}

function increment(diagnostics: Map<string, number>, reason: string): void {
  diagnostics.set(reason, (diagnostics.get(reason) ?? 0) + 1);
}

function freezeDiagnostics(diagnostics: Map<string, number>): Readonly<Record<string, number>> {
  return objectFreeze(
    Object.fromEntries(
      [...diagnostics.entries()]
        .filter(([, count]) => count > 0)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function isoWeekKeyForJstMonday(startMs: number): string {
  // `assertPeriod` establishes that this instant is JST Monday 00:00. Shift it
  // into a UTC-shaped date only for calendar arithmetic; never consult the
  // host timezone.
  const jstMonday = new Date(startMs + JST_OFFSET_MS);
  const mondayMs = Date.UTC(
    jstMonday.getUTCFullYear(),
    jstMonday.getUTCMonth(),
    jstMonday.getUTCDate(),
  );
  const thursday = new Date(mondayMs);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const janFourth = new Date(Date.UTC(isoYear, 0, 4));
  const janFourthWeekday = janFourth.getUTCDay() || 7;
  const firstMondayMs = janFourth.getTime() - (janFourthWeekday - 1) * DAY_MS;
  const week = Math.floor((mondayMs - firstMondayMs) / WEEK_MS) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function assertPeriod(period: HCyclePeriodV1): Readonly<{ startMs: number; endMs: number; asOfMs: number }> {
  if (!isNonEmptyString(period.weekKey) || !/^\d{4}-W\d{2}$/.test(period.weekKey)) {
    throw new Error("invalid_h_cycle_period_week_key");
  }
  const startMs = dateMs(period.start);
  const endMs = dateMs(period.end);
  const asOfMs = dateMs(period.asOf);
  if (startMs === null || endMs === null || asOfMs === null || endMs - startMs !== WEEK_MS || asOfMs !== endMs) {
    throw new Error("invalid_h_cycle_period_bounds");
  }
  // JST Monday 00:00 is Sunday 15:00 UTC. This keeps the pure boundary strict
  // without consulting a process timezone or a clock.
  const start = new Date(startMs);
  if (
    start.getUTCDay() !== 0
    || start.getUTCHours() !== 15
    || start.getUTCMinutes() !== 0
    || start.getUTCSeconds() !== 0
    || start.getUTCMilliseconds() !== 0
  ) {
    throw new Error("invalid_h_cycle_period_jst_boundary");
  }
  if (period.weekKey !== isoWeekKeyForJstMonday(startMs)) {
    throw new Error("invalid_h_cycle_period_week_key");
  }
  return objectFreeze({ startMs, endMs, asOfMs });
}

function inPeriod(timestampMs: number, startMs: number, endMs: number): boolean {
  return timestampMs >= startMs && timestampMs < endMs;
}

function beforeAsOf(timestampMs: number, asOfMs: number): boolean {
  return timestampMs < asOfMs;
}

function normalizeSources(
  input: readonly HCycleSourceRevisionV1[],
  asOfMs: number,
  diagnostics: Map<string, number>,
): SourceRevision[] {
  const known = new Set<string>();
  const normalized: SourceRevision[] = [];
  for (const revision of input) {
    const firstObservedAtMs = dateMs(revision.firstObservedAt);
    if (firstObservedAtMs === null) {
      increment(diagnostics, "invalid_source_revision");
      continue;
    }
    if (!beforeAsOf(firstObservedAtMs, asOfMs)) continue;
    if (
      !isOneOf(["daily", "weekly"] as const, revision.sourceKind)
      || !isNonEmptyString(revision.textbookKey)
      || !isOneOf(["auto", "compiled"] as const, revision.source)
      || !isSafeNonNegativeInteger(revision.checkIndex)
      || !isNonEmptyString(revision.sourceRevisionHash)
    ) {
      increment(diagnostics, "invalid_source_revision");
      continue;
    }
    const key = sourceKey(revision);
    if (known.has(key)) {
      increment(diagnostics, "duplicate_source_revision");
      continue;
    }
    known.add(key);
    let masteryHistoryValid = true;
    const eventTimes = new Map<number, HCycleMastery>();
    for (const event of revision.masteryEvents) {
      const recordedAtMs = dateMs(event.recordedAt);
      if (recordedAtMs === null) {
        masteryHistoryValid = false;
        increment(diagnostics, "invalid_mastery_event");
        continue;
      }
      if (!beforeAsOf(recordedAtMs, asOfMs)) continue;
      if (!isOneOf(MASTERY_VALUES, event.mastery) || recordedAtMs < firstObservedAtMs) {
        masteryHistoryValid = false;
        increment(diagnostics, "invalid_mastery_event");
        continue;
      }
      const previous = eventTimes.get(recordedAtMs);
      if (previous !== undefined && previous !== event.mastery && beforeAsOf(recordedAtMs, asOfMs)) {
        masteryHistoryValid = false;
        increment(diagnostics, "ambiguous_mastery_event");
      }
      eventTimes.set(recordedAtMs, event.mastery);
    }
    normalized.push({ ...revision, key, firstObservedAtMs, masteryHistoryValid });
  }
  return normalized;
}

function normalizePromotions(
  input: readonly HCyclePromotionV1[],
  sourceByKey: ReadonlyMap<string, SourceRevision>,
  asOfMs: number,
  diagnostics: Map<string, number>,
): Promotion[] {
  const gates = new Set<string>();
  const normalized: Promotion[] = [];
  for (const promotion of input) {
    const originCreatedAtMs = dateMs(promotion.originCreatedAt);
    if (originCreatedAtMs === null) {
      increment(diagnostics, "invalid_promotion");
      continue;
    }
    if (!beforeAsOf(originCreatedAtMs, asOfMs)) continue;
    if (
      !isNonEmptyString(promotion.gateId)
      || !isOneOf(["daily", "weekly"] as const, promotion.sourceKind)
      || !isNonEmptyString(promotion.textbookKey)
      || !isOneOf(["auto", "compiled"] as const, promotion.source)
      || !isSafeNonNegativeInteger(promotion.checkIndex)
      || !isNonEmptyString(promotion.sourceRevisionHash)
    ) {
      increment(diagnostics, "invalid_promotion");
      continue;
    }
    if (gates.has(promotion.gateId)) {
      increment(diagnostics, "duplicate_promotion_gate");
      continue;
    }
    gates.add(promotion.gateId);
    const key = sourceKey(promotion);
    const revision = sourceByKey.get(key);
    if (revision === undefined) {
      increment(diagnostics, "promotion_without_source_revision");
      continue;
    }
    if (revision !== undefined && originCreatedAtMs < revision.firstObservedAtMs) {
      increment(diagnostics, "origin_before_source_observation");
      continue;
    }
    normalized.push({ ...promotion, key, originCreatedAtMs });
  }
  return normalized;
}

function allowedTransition(previous: HCycleGateStatus, next: HCycleGateStatus): boolean {
  if (previous === "pending") return next === "answered" || next === "dismissed" || next === "parked";
  if (previous === "answered") return next === "grading";
  if (previous === "grading") return next === "passed" || next === "failed" || next === "grading_failed";
  if (previous === "grading_failed") return next === "answered" || next === "self_graded_pass" || next === "self_graded_fail" || next === "dismissed";
  if (previous === "failed") return next === "answered" || next === "dismissed";
  if (previous === "self_graded_fail") return next === "answered";
  if (previous === "parked") return next === "pending";
  return false;
}

function normalizeStates(
  input: readonly HCycleGateStateEventV1[],
  promotionByGateId: ReadonlyMap<string, Promotion>,
  asOfMs: number,
  diagnostics: Map<string, number>,
): Map<string, GateStateAtAsOf> {
  const byGate = new Map<string, StateEvent[]>();
  const ids = new Set<string>();
  for (const event of input) {
    const recordedAtMs = dateMs(event.recordedAt);
    if (recordedAtMs === null) {
      increment(diagnostics, "invalid_gate_state_event");
      continue;
    }
    if (!beforeAsOf(recordedAtMs, asOfMs)) continue;
    if (
      !isNonEmptyString(event.id)
      || !isNonEmptyString(event.gateId)
      || !isSafeNonNegativeInteger(event.ordinal)
      || event.ordinal === 0
      || !isOneOf(GATE_STATUSES, event.status)
    ) {
      increment(diagnostics, "invalid_gate_state_event");
      continue;
    }
    if (ids.has(event.id)) {
      increment(diagnostics, "duplicate_gate_state_event");
      continue;
    }
    ids.add(event.id);
    if (!promotionByGateId.has(event.gateId)) {
      increment(diagnostics, "state_event_without_promotion");
      continue;
    }
    const existing = byGate.get(event.gateId) ?? [];
    existing.push({ ...event, recordedAtMs });
    byGate.set(event.gateId, existing);
  }

  const states = new Map<string, GateStateAtAsOf>();
  for (const [gateId, promotion] of promotionByGateId.entries()) {
    const events = [...(byGate.get(gateId) ?? [])].sort((left, right) => left.ordinal - right.ordinal);
    let previous: HCycleGateStatus = "pending";
    let previousTime = promotion.originCreatedAtMs;
    let valid = true;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.ordinal !== index + 1) {
        valid = false;
        increment(diagnostics, "non_contiguous_gate_state_ordinal");
        break;
      }
      if (event.recordedAtMs < promotion.originCreatedAtMs || event.recordedAtMs < previousTime) {
        valid = false;
        increment(diagnostics, "non_monotonic_gate_state_time");
        break;
      }
      if (!allowedTransition(previous, event.status)) {
        valid = false;
        increment(diagnostics, "invalid_gate_state_transition");
        break;
      }
      previous = event.status;
      previousTime = event.recordedAtMs;
    }
    states.set(
      gateId,
      objectFreeze({
        state: previous,
        stateEvent: events.length > 0 ? events[events.length - 1] : null,
        answered: events.some((event) => event.status === "answered"),
        valid,
      }),
    );
  }
  return states;
}

function normalizeFailureCaptures(
  input: readonly HCycleFailureCaptureV1[],
  failedEvents: ReadonlyMap<string, StateEvent>,
  asOfMs: number,
  diagnostics: Map<string, number>,
): Map<string, FailureCaptureAtAsOf[]> {
  const byFailedEvent = new Map<string, FailureCaptureAtAsOf[]>();
  const ids = new Set<string>();
  const captureIds = new Set<string>();
  for (const capture of input) {
    const capturedAtMs = dateMs(capture.capturedAt);
    if (capturedAtMs === null) {
      increment(diagnostics, "invalid_failure_capture");
      continue;
    }
    if (!beforeAsOf(capturedAtMs, asOfMs)) continue;
    const reviewedAtMs = capture.reviewedAt === null ? null : dateMs(capture.reviewedAt);
    if (
      !isNonEmptyString(capture.id)
      || !isNonEmptyString(capture.failedStateEventId)
      || !isNonEmptyString(capture.captureId)
      || (capture.reviewedAt !== null && reviewedAtMs === null)
      || !isOneOf(CAPTURE_STATUSES, capture.status)
    ) {
      increment(diagnostics, "invalid_failure_capture");
      continue;
    }
    if (ids.has(capture.id) || captureIds.has(capture.captureId)) {
      increment(diagnostics, "duplicate_failure_capture");
      continue;
    }
    ids.add(capture.id);
    captureIds.add(capture.captureId);
    const failedEvent = failedEvents.get(capture.failedStateEventId);
    if (failedEvent === undefined) {
      increment(diagnostics, "failure_capture_without_failed_event");
      continue;
    }
    let valid = true;
    if (
      capture.sourceTool !== "gate"
      || capture.parsedGateId !== failedEvent.gateId
      || capturedAtMs < failedEvent.recordedAtMs
      || (reviewedAtMs !== null && reviewedAtMs < capturedAtMs)
    ) {
      valid = false;
      increment(diagnostics, "malformed_failure_capture_mapping");
    }
    const terminal = (capture.status === "accepted" || capture.status === "ignored")
      && reviewedAtMs !== null
      && beforeAsOf(reviewedAtMs, asOfMs);
    byFailedEvent.set(
      capture.failedStateEventId,
      [
        ...(byFailedEvent.get(capture.failedStateEventId) ?? []),
        objectFreeze({
          capture: { ...capture, capturedAtMs, reviewedAtMs },
          terminal,
          accepted: terminal && capture.status === "accepted",
          valid,
        }),
      ],
    );
  }
  return byFailedEvent;
}

function normalizeFollowups(
  input: readonly HCycleFollowupObservationV1[],
  failureCaptures: ReadonlyMap<string, FailureCaptureAtAsOf>,
  asOfMs: number,
  diagnostics: Map<string, number>,
): Map<string, FollowupObservation> {
  const byFailureCaptureId = new Map<string, FollowupObservation>();
  const ids = new Set<string>();
  for (const observation of input) {
    const observedAtMs = dateMs(observation.observedAt);
    if (observedAtMs === null) {
      increment(diagnostics, "invalid_followup_observation");
      continue;
    }
    if (!beforeAsOf(observedAtMs, asOfMs)) continue;
    const scheduledForMs = dateMs(observation.scheduledFor);
    if (
      !isNonEmptyString(observation.id)
      || !isNonEmptyString(observation.failureCaptureId)
      || !isNonEmptyString(observation.misconceptionId)
      || scheduledForMs === null
    ) {
      increment(diagnostics, "invalid_followup_observation");
      continue;
    }
    if (ids.has(observation.id) || byFailureCaptureId.has(observation.failureCaptureId)) {
      increment(diagnostics, "duplicate_followup_observation");
      continue;
    }
    ids.add(observation.id);
    const failureCapture = failureCaptures.get(observation.failureCaptureId);
    if (failureCapture === undefined) {
      increment(diagnostics, "followup_without_failure_capture");
      continue;
    }
    if (
      !failureCapture.accepted
      || !failureCapture.valid
      || failureCapture.capture.misconceptionId !== observation.misconceptionId
      || failureCapture.capture.reviewedAtMs === null
      || observedAtMs < failureCapture.capture.reviewedAtMs
    ) {
      increment(diagnostics, "malformed_followup_observation");
      continue;
    }
    byFailureCaptureId.set(observation.failureCaptureId, { ...observation, observedAtMs, scheduledForMs });
  }
  return byFailureCaptureId;
}

function latestMasteryAtAsOf(revision: SourceRevision, asOfMs: number): HCycleMastery | null {
  const events = revision.masteryEvents
    .map((event) => ({ mastery: event.mastery, recordedAtMs: dateMs(event.recordedAt) }))
    .filter((event): event is { mastery: HCycleMastery; recordedAtMs: number } => event.recordedAtMs !== null && beforeAsOf(event.recordedAtMs, asOfMs))
    .sort((left, right) => left.recordedAtMs - right.recordedAtMs);
  return events.length === 0 ? null : events[events.length - 1].mastery;
}

function mostSpecificReason(reasons: readonly string[], fallback: string): string {
  return [...reasons].sort()[0] ?? fallback;
}

/**
 * Projects exactly one already-completed JST week. It never reads the current
 * Gate / Misconception row and never mutates the input or any external state.
 */
export function projectHCycleEvidenceV1(input: HCycleEvidenceProjectionInputV1): HCycleEvidenceProjectionV1 {
  const { startMs, endMs, asOfMs } = assertPeriod(input.period);
  const diagnostics = new Map<string, number>();
  const sources = normalizeSources(input.sourceRevisions, asOfMs, diagnostics);
  const sourceByKey = new Map(sources.map((revision) => [revision.key, revision]));
  const promotions = normalizePromotions(input.promotions, sourceByKey, asOfMs, diagnostics);
  const promotionByGateId = new Map(promotions.map((promotion) => [promotion.gateId, promotion]));
  const states = normalizeStates(input.gateStateEvents, promotionByGateId, asOfMs, diagnostics);

  const failedEvents = new Map<string, StateEvent>();
  for (const [gateId, state] of states.entries()) {
    const events = input.gateStateEvents
      .map((event) => ({ ...event, recordedAtMs: dateMs(event.recordedAt) }))
      .filter((event): event is StateEvent => event.gateId === gateId && event.recordedAtMs !== null && beforeAsOf(event.recordedAtMs, asOfMs) && event.status === "failed");
    for (const event of events) failedEvents.set(event.id, event);
    if (!state.valid) increment(diagnostics, "invalid_gate_state_history");
  }

  const failureCapturesByFailedEvent = normalizeFailureCaptures(input.failureCaptures, failedEvents, asOfMs, diagnostics);
  const failureCaptureById = new Map<string, FailureCaptureAtAsOf>();
  for (const captures of failureCapturesByFailedEvent.values()) {
    for (const capture of captures) failureCaptureById.set(capture.capture.id, capture);
  }
  const followupsByFailureCaptureId = normalizeFollowups(input.followupObservations, failureCaptureById, asOfMs, diagnostics);

  const observedInPeriod = sources.filter((revision) => inPeriod(revision.firstObservedAtMs, startMs, endMs));
  const selfAssessed = observedInPeriod.filter(
    (revision) => revision.masteryHistoryValid && latestMasteryAtAsOf(revision, asOfMs) !== null,
  );
  const invalidSelfAssessment = observedInPeriod.some((revision) => !revision.masteryHistoryValid);
  const selfAssessmentRate = invalidSelfAssessment
    ? incomplete(selfAssessed.length, observedInPeriod.length, "invalid_mastery_event")
    : measured(selfAssessed.length, observedInPeriod.length);

  const actionableSourceSnapshot = sources.filter((revision) => {
    if (!beforeAsOf(revision.firstObservedAtMs, asOfMs)) return false;
    return revision.masteryHistoryValid;
  });
  const actionableRevisions = actionableSourceSnapshot.filter((revision) => {
    const mastery = latestMasteryAtAsOf(revision, asOfMs);
    return mastery === "partial" || mastery === "stuck";
  });
  const hasInvalidActionableSnapshot = sources.some(
    (revision) => beforeAsOf(revision.firstObservedAtMs, asOfMs) && !revision.masteryHistoryValid,
  );
  const actionableCheckCount: HCycleCount = hasInvalidActionableSnapshot
    ? objectFreeze({ status: "incomplete" as const, count: actionableRevisions.length, reason: "invalid_mastery_event" })
    : objectFreeze({ status: "measured" as const, count: actionableRevisions.length });
  const promotedActionableCount = actionableRevisions.filter((revision) => {
    return promotions.some((promotion) => promotion.key === revision.key && beforeAsOf(promotion.originCreatedAtMs, asOfMs));
  }).length;
  const explicitPromotionRate = measured(promotedActionableCount, actionableRevisions.length);

  const outcomeCohort = promotions.filter((promotion) => inPeriod(promotion.originCreatedAtMs, startMs, endMs));
  const invalidStateGates = outcomeCohort.filter((promotion) => states.get(promotion.gateId)?.valid !== true);
  const answeredGates = outcomeCohort.filter((promotion) => states.get(promotion.gateId)?.answered === true);
  const answeredPromotedGateRate = invalidStateGates.length > 0
    ? incomplete(answeredGates.length, outcomeCohort.length, "invalid_gate_state_history")
    : answeredGates.length === outcomeCohort.length
      ? measured(answeredGates.length, outcomeCohort.length)
      : incomplete(answeredGates.length, outcomeCohort.length, "pending_gate");

  const gradedGates = outcomeCohort.filter((promotion) => {
    const state = states.get(promotion.gateId);
    return state?.valid === true && (state.state === "passed" || state.state === "failed");
  });
  const incompleteGradeReasons = outcomeCohort
    .filter((promotion) => !gradedGates.includes(promotion))
    .map((promotion) => {
      const state = states.get(promotion.gateId);
      if (state?.valid !== true) return "invalid_gate_state_history";
      if (state.state === "self_graded_pass" || state.state === "self_graded_fail") return "self_graded_gate";
      if (state.state === "grading_failed") return "grading_failed";
      if (state.state === "dismissed" || state.state === "parked") return "non_evaluable_gate";
      return "pending_gate";
    });
  const gradedPromotedGateRate = incompleteGradeReasons.length === 0
    ? measured(gradedGates.length, outcomeCohort.length)
    : incomplete(gradedGates.length, outcomeCohort.length, mostSpecificReason(incompleteGradeReasons, "pending_gate"));

  const failureEvents = [...failedEvents.values()]
    .filter((event) => promotionByGateId.has(event.gateId));
  let terminalFailures = 0;
  const triageReasons: string[] = [];
  for (const failure of failureEvents) {
    const captures = failureCapturesByFailedEvent.get(failure.id) ?? [];
    if (captures.length === 0) {
      triageReasons.push("missing_gate_capture");
      continue;
    }
    if (captures.some((capture) => !capture.valid)) {
      triageReasons.push("malformed_capture_mapping");
      continue;
    }
    if (captures.every((capture) => capture.terminal)) {
      terminalFailures += 1;
    } else {
      triageReasons.push("pending_capture");
    }
  }
  const failedTriageRate = triageReasons.length === 0
    ? measured(terminalFailures, failureEvents.length)
    : incomplete(terminalFailures, failureEvents.length, mostSpecificReason(triageReasons, "pending_capture"));

  const acceptedDirectCaptures = [...failureCapturesByFailedEvent.values()]
    .flat()
    .filter((capture) => capture.valid && capture.accepted);
  let observedFollowups = 0;
  const followupReasons: string[] = [];
  for (const capture of acceptedDirectCaptures) {
    if (followupsByFailureCaptureId.has(capture.capture.id)) {
      observedFollowups += 1;
    } else {
      followupReasons.push("missing_followup_observation");
    }
  }
  const scheduledFollowupRate = followupReasons.length === 0
    ? measured(observedFollowups, acceptedDirectCaptures.length)
    : incomplete(observedFollowups, acceptedDirectCaptures.length, mostSpecificReason(followupReasons, "missing_followup_observation"));

  let closedGates = 0;
  const closureReasons: string[] = [];
  for (const promotion of outcomeCohort) {
    const state = states.get(promotion.gateId);
    if (state?.valid !== true) {
      closureReasons.push("invalid_gate_state_history");
      continue;
    }
    if (state.state === "passed") {
      closedGates += 1;
      continue;
    }
    if (state.state !== "failed" || state.stateEvent === null) {
      if (state.state === "self_graded_pass" || state.state === "self_graded_fail") closureReasons.push("self_graded_gate");
      else if (state.state === "grading_failed") closureReasons.push("grading_failed");
      else if (state.state === "dismissed" || state.state === "parked") closureReasons.push("non_evaluable_gate");
      else closureReasons.push("pending_gate");
      continue;
    }
    const captures = failureCapturesByFailedEvent.get(state.stateEvent.id) ?? [];
    if (captures.length === 0) {
      closureReasons.push("missing_gate_capture");
      continue;
    }
    if (captures.some((capture) => !capture.valid)) {
      closureReasons.push("malformed_capture_mapping");
      continue;
    }
    if (captures.some((capture) => !capture.terminal)) {
      closureReasons.push("pending_capture");
      continue;
    }
    if (!captures.some((capture) => capture.accepted)) {
      closureReasons.push("ignored_capture");
      continue;
    }
    const hasAcceptedFollowup = captures.some((capture) => capture.accepted && followupsByFailureCaptureId.has(capture.capture.id));
    if (hasAcceptedFollowup) {
      closedGates += 1;
    } else {
      closureReasons.push("missing_followup_observation");
    }
  }
  const evidenceClosureRate = closureReasons.length === 0
    ? measured(closedGates, outcomeCohort.length)
    : incomplete(closedGates, outcomeCohort.length, mostSpecificReason(closureReasons, "pending_gate"));

  return objectFreeze({
    schema: "h_cycle_evidence_projection_v1" as const,
    policyVersion: H_CYCLE_POLICY_VERSION_V1,
    period: objectFreeze({
      weekKey: input.period.weekKey,
      start: input.period.start.toISOString(),
      end: input.period.end.toISOString(),
      asOf: input.period.asOf.toISOString(),
    }),
    cohortKinds: H_CYCLE_COHORT_KINDS_V1,
    selfAssessmentRate,
    actionableCheckCount,
    explicitPromotionRate,
    answeredPromotedGateRate,
    gradedPromotedGateRate,
    failedTriageRate,
    scheduledFollowupRate,
    evidenceClosureRate,
    diagnostics: freezeDiagnostics(diagnostics),
  });
}

function isMeasured(rate: EvidenceRate): rate is Extract<EvidenceRate, { status: "measured" }> {
  return rate.status === "measured";
}

function hasIntegrityError(projection: HCycleEvidenceProjectionV1): boolean {
  return Object.values(projection.diagnostics).some((count) => count > 0);
}

function isEligiblePolicyWindow(projection: HCycleEvidenceProjectionV1): readonly string[] {
  const reasons: string[] = [];
  if (projection.gradedPromotedGateRate.status === "not_applicable") reasons.push("zero_origin_cohort");
  else if (!isMeasured(projection.gradedPromotedGateRate)) reasons.push("incomplete_graded_gate_rate");
  if (projection.evidenceClosureRate.status === "incomplete") reasons.push("incomplete_evidence_closure_rate");
  if (projection.failedTriageRate.status === "incomplete") reasons.push("incomplete_failed_triage_rate");
  if (projection.scheduledFollowupRate.status === "incomplete") reasons.push("incomplete_scheduled_followup_rate");
  if (hasIntegrityError(projection)) reasons.push("integrity_error");
  return Object.freeze([...new Set(reasons)].sort());
}

function parsedPeriodBounds(projection: HCycleEvidenceProjectionV1): Readonly<{ startMs: number; endMs: number }> | null {
  const startMs = Date.parse(projection.period.start);
  const endMs = Date.parse(projection.period.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs !== WEEK_MS) return null;
  return objectFreeze({ startMs, endMs });
}

/**
 * Applies the two-adjacent-completed-week policy to pure week projections.
 * The caller supplies only completed windows; this function never consults a clock.
 */
export function evaluateHCycleEvidencePolicyV1(
  projections: readonly HCycleEvidenceProjectionV1[],
): HCycleEvidencePolicyResultV1 {
  const ordered = [...projections]
    .map((projection) => ({ projection, bounds: parsedPeriodBounds(projection) }))
    .sort((left, right) => (left.bounds?.startMs ?? Number.POSITIVE_INFINITY) - (right.bounds?.startMs ?? Number.POSITIVE_INFINITY));
  if (ordered.length < 2) {
    return objectFreeze({
      schema: "h_cycle_evidence_policy_v1" as const,
      policyVersion: H_CYCLE_POLICY_VERSION_V1,
      status: "baseline_collecting" as const,
      requiredAdjacentWindows: 2 as const,
      evaluatedWeekKeys: Object.freeze(ordered.map(({ projection }) => projection.period.weekKey)),
      reasons: Object.freeze(["fewer_than_two_completed_windows"]),
    });
  }

  const adjacentPairs: Array<readonly [HCycleEvidenceProjectionV1, HCycleEvidenceProjectionV1]> = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous.bounds !== null && current.bounds !== null && previous.bounds.endMs === current.bounds.startMs) {
      adjacentPairs.push([previous.projection, current.projection]);
    }
  }
  if (adjacentPairs.length === 0) {
    return objectFreeze({
      schema: "h_cycle_evidence_policy_v1" as const,
      policyVersion: H_CYCLE_POLICY_VERSION_V1,
      status: "baseline_collecting" as const,
      requiredAdjacentWindows: 2 as const,
      evaluatedWeekKeys: Object.freeze(ordered.map(({ projection }) => projection.period.weekKey)),
      reasons: Object.freeze(["no_adjacent_completed_windows"]),
    });
  }

  const [first, second] = adjacentPairs[adjacentPairs.length - 1];
  const pair = [first, second] as const;
  const eligibilityReasons = pair.flatMap((projection) => isEligiblePolicyWindow(projection));
  if (eligibilityReasons.length > 0) {
    return objectFreeze({
      schema: "h_cycle_evidence_policy_v1" as const,
      policyVersion: H_CYCLE_POLICY_VERSION_V1,
      status: "inconclusive" as const,
      requiredAdjacentWindows: 2 as const,
      evaluatedWeekKeys: Object.freeze(pair.map((projection) => projection.period.weekKey)),
      reasons: Object.freeze([...new Set(eligibilityReasons)].sort()),
    });
  }

  const rejected = pair.some((projection) => {
    const graded = projection.gradedPromotedGateRate;
    const failedTriage = projection.failedTriageRate;
    const scheduled = projection.scheduledFollowupRate;
    return (isMeasured(graded) && graded.ratio < 0.5)
      || (isMeasured(failedTriage) && failedTriage.ratio < 1)
      || (isMeasured(scheduled) && scheduled.ratio < 1);
  });
  return objectFreeze({
    schema: "h_cycle_evidence_policy_v1" as const,
    policyVersion: H_CYCLE_POLICY_VERSION_V1,
    status: rejected ? "rejected" : "supported",
    requiredAdjacentWindows: 2 as const,
    evaluatedWeekKeys: Object.freeze(pair.map((projection) => projection.period.weekKey)),
    reasons: Object.freeze([]),
  });
}
