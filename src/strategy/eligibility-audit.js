function round(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;

  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function createCriterion(name, passed, details = {}) {
  return {
    name,
    passed: Boolean(passed),
    ...details
  };
}

function summarizeCriteria(criteria = [], fallbackBlockedBy = null, forcedScore = null) {
  const safeCriteria = Array.isArray(criteria) ? criteria : [];
  const passed = safeCriteria.filter((criterion) => criterion.passed).length;
  const failed = safeCriteria.length - passed;
  const blockedBy = failed > 0
    ? safeCriteria.find((criterion) => !criterion.passed)?.name || fallbackBlockedBy
    : fallbackBlockedBy;
  const score = forcedScore === null || forcedScore === undefined
    ? (safeCriteria.length > 0 ? round((passed / safeCriteria.length) * 100) : 0)
    : round(forcedScore);

  return {
    conditions: safeCriteria.reduce((accumulator, criterion) => {
      accumulator[criterion.name] = criterion.passed;
      return accumulator;
    }, {}),
    criteriaPassed: passed,
    criteriaFailed: failed,
    blockedBy: blockedBy || null,
    score
  };
}

function selectClosestCandidate(candidates = []) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  return safeCandidates
    .map((candidate) => ({
      ...candidate,
      audit: summarizeCriteria(candidate.criteria, candidate.blockedBy)
    }))
    .sort((left, right) => {
      if (right.audit.score !== left.audit.score) {
        return right.audit.score - left.audit.score;
      }

      return left.audit.criteriaFailed - right.audit.criteriaFailed;
    })[0] || null;
}

function buildEligibilityAudit({ strategyName, direction = null, valid = false, criteria = [], candidates = [], score = null, blockedBy = null, reason = null, context = {} }) {
  const closestCandidate = selectClosestCandidate(candidates);
  const activeCriteria = Array.isArray(criteria) && criteria.length > 0
    ? criteria
    : closestCandidate?.criteria || [];
  const summary = summarizeCriteria(activeCriteria, blockedBy || closestCandidate?.audit?.blockedBy || reason, score);

  return {
    strategyName,
    valid: Boolean(valid),
    direction: direction || null,
    ...summary,
    reason: reason || null,
    closestDirection: direction || closestCandidate?.direction || null,
    candidates: candidates.map((candidate) => ({
      direction: candidate.direction || null,
      ...summarizeCriteria(candidate.criteria, candidate.blockedBy)
    })),
    context
  };
}

function invalidEligibilityAudit(strategyName, reason, context = {}) {
  return buildEligibilityAudit({
    strategyName,
    valid: false,
    direction: null,
    criteria: [],
    score: 0,
    blockedBy: reason,
    reason,
    context
  });
}

module.exports = {
  buildEligibilityAudit,
  createCriterion,
  invalidEligibilityAudit
};
