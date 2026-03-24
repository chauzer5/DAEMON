export type SignalReason =
  | "explicit_link"
  | "ticket_id_match"
  | "mr_ref_match"
  | "branch_ticket"
  | "service_tag_match"
  | "error_code_match"
  | "person_overlap"
  | "tfidf_text"
  | "temporal_proximity"
  | "url_reference"
  | "label_overlap"
  | "query_service_match";

export interface ScoredSignal {
  a: string;
  b: string;
  score: number;
  reason: SignalReason;
}

export type ConfidenceTier = "definite" | "strong" | "probable" | "weak";

export interface CorrelationScore {
  total: number;
  signals: ScoredSignal[];
  tier: ConfidenceTier;
}

// ── Weights ──

export const SIGNAL_WEIGHTS: Record<SignalReason, number> = {
  explicit_link:       1.0,
  ticket_id_match:     0.95,
  mr_ref_match:        0.90,
  branch_ticket:       0.85,
  url_reference:       0.85,
  error_code_match:    0.75,
  service_tag_match:   0.70,
  query_service_match: 0.65,
  tfidf_text:          0.60,
  person_overlap:      0.40,
  label_overlap:       0.35,
  temporal_proximity:  0.25,
};

export const TIER_THRESHOLDS: Record<ConfidenceTier, number> = {
  definite: 0.85,
  strong:   0.60,
  probable: 0.35,
  weak:     0.15,
};

export function scoreTier(total: number): ConfidenceTier {
  if (total >= TIER_THRESHOLDS.definite) return "definite";
  if (total >= TIER_THRESHOLDS.strong) return "strong";
  if (total >= TIER_THRESHOLDS.probable) return "probable";
  return "weak";
}
