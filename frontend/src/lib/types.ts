/** Shapes returned by the API. Kept narrow: only the fields the interface reads. */

/** One field error from an RFC 9457 problem document: the field, the problem, the fix. */
export type FieldError = { field: string; detail: string; fix: string };

export type Money = { paise: number; currency: string; display: string };

export type Session = {
  id: string;
  name: string;
  email: string;
  locale: string;
  department_id: string | null;
  startup_id: string | null;
  roles: string[];
  scoped_roles: { role: string; scope_type: string; scope_id: string | null }[];
};

export type Task = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  action_label: string;
  link: string;
  due_at: string | null;
  overdue: boolean;
  priority: number;
  entity_type: string;
  entity_id: string;
  role: string;
};

export type Kpi = {
  id: string;
  name: string;
  unit: string;
  kind: string;
  direction: "lower" | "higher";
  direction_label: string;
  baseline_value: number | null;
  baseline_sd: number | null;
  baseline_source: string;
  baseline_method: string;
  baseline_plan: string;
  target_value: number | null;
  is_primary: boolean;
  problems: string[];
};

export type Criterion = {
  id: string;
  name: string;
  description: string;
  weight: number;
  anchors: Record<string, string>;
  round_number: number;
};

export type QualityFlag = {
  code: string;
  severity: string;
  field: string;
  message: string;
};

export type BlockingProblem = { field: string; detail: string; fix: string };

export type Challenge = {
  id: string;
  reference: string;
  state: string;
  title: string;
  outcome_statement: string;
  problem_statement?: string;
  current_situation?: string;
  constraints?: string;
  pilot_scope?: string;
  commercial_terms?: string;
  sector: string | null;
  state_code: string | null;
  district: string | null;
  department_id: string;
  department_name: string | null;
  budget_ceiling: Money | null;
  pilot_duration_weeks: number;
  application_deadline: string | null;
  clarification_cutoff: string | null;
  evaluation_deadline: string | null;
  published_at: string | null;
  version: number;
  location_required?: boolean;
  ip_option?: string;
  eligibility_rules?: Record<string, unknown>;
  template_versions?: Record<string, string>;
  ai_draft_meta?: Record<string, unknown>;
  quality_flags?: QualityFlag[];
  kpis?: Kpi[];
  criteria?: Criterion[];
  created_by?: string;
  approved_by?: string | null;
  return_comments?: string | null;
  cancel_reason?: string | null;
  blocking_problems?: BlockingProblem[];
  available_actions?: string[];
  application_count?: number;
  clarifications?: Clarification[];
  corrigenda?: Corrigendum[];
};

export type Clarification = {
  id: string;
  question: string;
  answer: string | null;
  published_at: string | null;
  answered?: boolean;
};

export type Corrigendum = {
  number: number;
  summary: string;
  changes: Record<string, { from: string; to: string }>;
  issued_at: string | null;
};

export type EligibilityRule = {
  code: string;
  name: string;
  passed: boolean;
  blocking: boolean;
  reason: string;
  fix: string;
  relaxed: boolean;
  citation: string;
};

export type Eligibility = {
  outcome: string;
  rule_results: EligibilityRule[];
  relaxations_applied: { rule: string; name: string; citation: string }[];
  screened_at?: string;
  overridden_by: string | null;
  override_reason: string | null;
  clarification_window_ends?: string | null;
};

export type Application = {
  id: string;
  reference: string;
  challenge_id: string;
  challenge_title: string | null;
  startup_id: string;
  startup_name: string | null;
  state: string;
  proposal_summary: string;
  approach: string;
  kpi_commitments: { kpi_id: string; committed_value: number; note?: string }[];
  pilot_cost: Money | null;
  timeline_weeks: number;
  data_declaration: string;
  ip_declaration: string;
  conflict_declaration: boolean;
  submitted_at: string | null;
  locked_at: string | null;
  shortlist_rank: number | null;
  version: number;
  blocking_problems: BlockingProblem[];
  eligibility: Eligibility | null;
  my_result?: {
    rank: number;
    weighted_score: number;
    criteria: { name: string; weight: number; mean: number }[];
    note: string;
  };
};

export type Match = {
  rank: number;
  startup_id: string;
  startup_name: string | null;
  sectors: string[];
  dpiit_status: string | null;
  score: number;
  components: Record<string, number>;
  reasons: string[];
  invited_at: string | null;
};

export type RankingRow = {
  rank: number;
  application_id: string;
  reference: string;
  blind_label: string;
  startup_id?: string;
  weighted_score: number;
  mean_score: number;
  stdev: number;
  disagreement: number;
  evaluator_count: number;
  flags: string[];
  complete: boolean;
  pilot_cost_paise: number;
  criteria: {
    criterion_id: string;
    name: string;
    weight: number;
    mean: number;
    stdev: number;
    spread: number;
    flagged: boolean;
    contribution: number;
    scores_received: number;
  }[];
};

export type DesignOutcome = {
  duration_weeks: number;
  units: number;
  comparison_units: number;
  power: number;
  expected_cost_paise: number;
  cost_p5_paise: number;
  cost_p95_paise: number;
  minimum_detectable_effect: number;
  sd_of_differences: number;
  within_budget: boolean;
  iterations: number;
  label: string;
  notes: string[];
};

export type SimulationRun = {
  id: string;
  pilot_id: string;
  status: string;
  seed: number;
  iterations: number;
  engine_version: string;
  runtime_ms: number | null;
  inputs: Record<string, unknown>;
  results: {
    proposed: DesignOutcome;
    recommendation: DesignOutcome | null;
    recommendation_found: boolean;
    recommendation_message: string;
    comparison: DesignOutcome[];
    analytical_power: number;
    analytical_gap: number;
    grid_searched: number;
    seed: number;
    iterations: number;
    engine_version: string;
    runtime_ms: number;
  } | null;
  error: string | null;
  created_at: string;
  explanation?: string[];
};

export type PilotDesign = {
  id: string;
  primary_kpi_id: string;
  primary_kpi_name: string;
  unit: string;
  duration_weeks: number;
  units: number;
  comparison_units: number;
  measurements_per_week: number;
  planned_unit_periods: number;
  pass_mark: number;
  analysis_method: string;
  alpha: number;
  expected_power: number | null;
  expected_cost: Money | null;
  minimum_detectable_effect: number | null;
  baseline_mean: number;
  baseline_sd: number;
  claimed_effect: number;
  frozen_at: string | null;
  frozen: boolean;
  amendments: { description: string; approved: boolean; at: string }[];
  simulation_run_id: string | null;
};

export type Milestone = {
  id: string;
  pilot_id: string;
  seq: number;
  title: string;
  deliverable: string;
  evidence_required: string;
  amount_paise: number;
  amount?: Money;
  due_date: string;
  state: string;
  state_label: string;
  held_by_role: string | null;
  sla_due_at: string | null;
  days_remaining: number | null;
  overdue: boolean;
  escalation_level: number;
  resubmission_count: number;
  rejection_reason: string | null;
  unmet_requirement: string | null;
  submission_note: string | null;
  version: number;
  state_history: { state: string; at: string; sla_due_at: string | null }[];
  pilot_reference?: string;
  startup_name?: string;
  release?: {
    reference_no: string;
    amount: Money;
    released_on: string;
    mode: string;
    remarks: string | null;
  } | null;
};

export type Agreement = {
  id: string;
  number: number;
  ip_option: string;
  data_terms: Record<string, unknown>;
  milestones: {
    seq: number;
    title: string;
    deliverable: string;
    evidence_required: string;
    amount_paise: number;
    due_date: string;
  }[];
  sha256: string | null;
  pdf_file_id: string | null;
  drafted_by: string;
  approved_by: string | null;
  approved_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  esign_reference: string | null;
  change_request: string | null;
  template_versions: Record<string, string>;
  changes_from_previous: { field: string; from: unknown; to: unknown }[];
};

export type Pilot = {
  id: string;
  reference: string;
  state: string;
  challenge_id: string;
  challenge_title: string | null;
  startup_id: string;
  startup_name: string | null;
  department_id: string;
  application_id: string;
  design_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  termination_reason: string | null;
  cyber_completed_at: string | null;
  cyber_checklist: Record<string, boolean>;
  total_value: Money | null;
  version: number;
  available_actions: string[];
  design: PilotDesign | null;
  agreement: Partial<Agreement> | null;
  milestones: Milestone[];
};

export type ScoreComponent = {
  code: string;
  name: string;
  points: number;
  max_points: number;
  explanation: string;
};

export type EvidenceReport = {
  id: string;
  reference: string;
  pilot_id: string;
  status: string;
  confidence_score: number | null;
  band: string | null;
  dataset_hash: string;
  seed: number;
  engine_version: string;
  validator_id: string | null;
  validator_name?: string | null;
  signed_at: string | null;
  remarks: string | null;
  pdf_file_id: string | null;
  version: number;
  analysis: Record<string, any>;
  components: {
    score: number;
    band: string;
    band_guidance: string;
    components: ScoreComponent[];
    issued: boolean;
    message: string;
  };
  deviations: { description: string; approved: boolean; at: string }[];
  limitations: string[];
  checklist: Record<string, boolean>;
  dataset_check?: {
    unchanged: boolean;
    recorded_hash: string;
    current_hash: string;
    detail: string;
  };
};

export type Passport = {
  id: string;
  reference: string;
  solution_name: string;
  category: string;
  sector: string | null;
  state_code: string | null;
  district: string | null;
  context: Record<string, unknown>;
  result_summary: Record<string, any>;
  confidence_score: number;
  band: string;
  validator_name: string;
  validated_on: string;
  links: Record<string, string | null>;
  passport_version: number;
  startup_name: string | null;
  department_name: string | null;
  share_token?: string;
  status_note: string;
  adoption_requests?: {
    id: string;
    department_id: string;
    intent: string;
    state: string;
    created_at: string;
  }[];
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  action_required: boolean;
  due_at: string | null;
  created_at: string;
  read: boolean;
};

export type JobStatus = {
  id: string;
  type: string;
  queue: string;
  status: string;
  progress: number;
  attempts: number;
  max_attempts: number;
  result: Record<string, unknown> | null;
  error: string | null;
  done: boolean;
};

export type AuditEntry = {
  seq: number;
  at: string;
  at_ist?: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  department_id?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  prev_hash?: string;
  hash: string;
};
