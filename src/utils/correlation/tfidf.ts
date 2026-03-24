/**
 * Lightweight TF-IDF scorer for text similarity.
 * Operates on pre-tokenized documents.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "this", "that", "if", "not", "out", "up", "do", "my", "we", "so",
  "can", "has", "have", "had", "get", "got", "see", "just", "about",
  "how", "what", "when", "who", "why", "all", "its", "been", "will",
  "going", "figure", "check", "look", "into", "some", "any", "able",
  "down", "they", "them", "their", "our", "new", "old", "need", "also",
  "like", "would", "could", "should", "did", "does", "make", "made",
  "more", "than", "then", "now", "here", "there", "very", "too",
  "add", "fix", "update", "change", "set", "run", "use", "try",
]);

/** Tokenize text into lowercase terms, filter stop words and short tokens */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Compute term frequency for a document */
function tf(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const total = tokens.length || 1;
  const result = new Map<string, number>();
  for (const [term, count] of counts) result.set(term, count / total);
  return result;
}

export interface TfidfCorpus {
  idf: Map<string, number>;
  vectors: Map<string, Map<string, number>>;
}

/**
 * Build a TF-IDF corpus from a set of documents.
 * @param docs Map of entityId → text content
 */
export function buildCorpus(docs: Map<string, string>): TfidfCorpus {
  const N = docs.size || 1;
  const docFreq = new Map<string, number>();
  const tokenized = new Map<string, string[]>();

  // Tokenize all docs and count document frequency
  for (const [id, text] of docs) {
    const tokens = tokenize(text);
    tokenized.set(id, tokens);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
    }
  }

  // Compute IDF
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log(N / (1 + df)));
  }

  // Compute TF-IDF vectors
  const vectors = new Map<string, Map<string, number>>();
  for (const [id, tokens] of tokenized) {
    const tfMap = tf(tokens);
    const vec = new Map<string, number>();
    for (const [term, tfVal] of tfMap) {
      const idfVal = idf.get(term) ?? 0;
      const weight = tfVal * idfVal;
      if (weight > 0) vec.set(term, weight);
    }
    vectors.set(id, vec);
  }

  return { idf, vectors };
}

/** Cosine similarity between two TF-IDF vectors */
export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [term, wA] of a) {
    magA += wA * wA;
    const wB = b.get(term);
    if (wB !== undefined) dot += wA * wB;
  }
  for (const wB of b.values()) magB += wB * wB;

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}
