const DEFAULT_SEARCH_BUDGET = Object.freeze({
  maxSearches: 2,
  maxCandidatePages: 3,
  maxExcerptChars: 18_000,
  timeoutMs: 45_000,
});

const SEARCH_BUDGET_LIMITS = Object.freeze({
  maxSearches: Object.freeze({ min: 1, max: 2 }),
  maxCandidatePages: Object.freeze({ min: 1, max: 3 }),
  maxExcerptChars: Object.freeze({ min: 1_000, max: 18_000 }),
  timeoutMs: Object.freeze({ min: 1_000, max: 45_000 }),
});

const SEARCH_BUDGET_KEYS = Object.keys(SEARCH_BUDGET_LIMITS);

function invalidBudget() {
  return new Error('搜尋預算設定不正確。');
}

function validateSearchBudget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidBudget();
  if (Object.keys(value).some((key) => !SEARCH_BUDGET_KEYS.includes(key))) throw invalidBudget();
  const budget = {};
  for (const key of SEARCH_BUDGET_KEYS) {
    const number = value[key];
    const { min, max } = SEARCH_BUDGET_LIMITS[key];
    if (!Number.isSafeInteger(number) || number < min || number > max) throw invalidBudget();
    budget[key] = number;
  }
  return budget;
}

function normalizeSearchBudget(value) {
  if (value === undefined) return { ...DEFAULT_SEARCH_BUDGET };
  return validateSearchBudget({ ...DEFAULT_SEARCH_BUDGET, ...value });
}

module.exports = { DEFAULT_SEARCH_BUDGET, SEARCH_BUDGET_LIMITS, normalizeSearchBudget, validateSearchBudget };
