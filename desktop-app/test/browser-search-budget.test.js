const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SEARCH_BUDGET,
  SEARCH_BUDGET_LIMITS,
  normalizeSearchBudget,
  validateSearchBudget,
} = require('../src/browser-search/budget');

test('search budget exposes explicit defaults and compiled ceilings', () => {
  assert.deepEqual(DEFAULT_SEARCH_BUDGET, {
    maxSearches: 2,
    maxCandidatePages: 3,
    maxExcerptChars: 18_000,
    timeoutMs: 45_000,
  });
  assert.deepEqual(SEARCH_BUDGET_LIMITS, {
    maxSearches: { min: 1, max: 2 },
    maxCandidatePages: { min: 1, max: 3 },
    maxExcerptChars: { min: 1_000, max: 18_000 },
    timeoutMs: { min: 1_000, max: 45_000 },
  });
});

test('search budget defaults missing values and rejects policy fields or values over hard ceilings', () => {
  assert.deepEqual(normalizeSearchBudget(), DEFAULT_SEARCH_BUDGET);
  assert.deepEqual(normalizeSearchBudget({ maxSearches: 1, timeoutMs: 10_000 }), {
    maxSearches: 1,
    maxCandidatePages: 3,
    maxExcerptChars: 18_000,
    timeoutMs: 10_000,
  });
  assert.throws(() => validateSearchBudget({ ...DEFAULT_SEARCH_BUDGET, maxCandidatePages: 4 }), /搜尋預算/);
  assert.throws(() => validateSearchBudget({ ...DEFAULT_SEARCH_BUDGET, dns: 'public-only' }), /搜尋預算/);
  assert.throws(() => validateSearchBudget({ ...DEFAULT_SEARCH_BUDGET, timeoutMs: 0 }), /搜尋預算/);
});

test('settings persistence stores application-wide search budget while old settings receive defaults', () => {
  const { validateSettings } = require('../src/settings-store');
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true };
  assert.deepEqual(validateSettings({ version: 1, pets: [pet] }).searchBudget, DEFAULT_SEARCH_BUDGET);
  assert.deepEqual(validateSettings({ version: 1, pets: [pet], searchBudget: { maxSearches: 1, maxCandidatePages: 2, maxExcerptChars: 5_000, timeoutMs: 10_000 } }).searchBudget, {
    maxSearches: 1,
    maxCandidatePages: 2,
    maxExcerptChars: 5_000,
    timeoutMs: 10_000,
  });
});
