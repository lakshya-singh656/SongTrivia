// Server-side & Fallback Client Answer Scoring Logic

/**
 * Normalizes an answer string by:
 * 1. Trimming leading/trailing whitespace
 * 2. Converting to lowercase
 * 3. Collapsing multiple spaces into a single space
 * 4. Removing punctuation (apostrophes, quotes, commas, hyphens, periods, exclamation marks)
 */
export function normalizeAnswer(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/gi, '') // remove punctuation
    .replace(/\s+/g, ' ')      // collapse multiple whitespace
    .trim();
}

/**
 * Validates whether the submitted answer matches the correct answer
 * or any of the accepted variations.
 *
 * @param {string} submitted - User's typed answer
 * @param {string} correct - The canonical correct answer
 * @param {string[]|string} acceptedVariations - Optional array or comma-separated string of other valid answers
 * @returns {boolean}
 */
export function checkAnswerMatch(submitted, correct, acceptedVariations = []) {
  const normalizedUser = normalizeAnswer(submitted);
  if (!normalizedUser) return false;

  const normalizedCorrect = normalizeAnswer(correct);
  if (normalizedUser === normalizedCorrect) return true;

  // Process variations
  let variations = [];
  if (Array.isArray(acceptedVariations)) {
    variations = acceptedVariations;
  } else if (typeof acceptedVariations === 'string') {
    variations = acceptedVariations.split(',').map(s => s.trim());
  }

  for (const variation of variations) {
    if (normalizedUser === normalizeAnswer(variation)) {
      return true;
    }
  }

  return false;
}

/**
 * Computes points for a submission.
 * Rule: Correct answer = 10 points, Wrong answer = 0 points.
 */
export function computePoints(isCorrect) {
  return isCorrect ? 10 : 0;
}
