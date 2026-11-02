/** Evidence and deployment checks enter as booleans; secrets never enter this model. */
export interface MarketingReadinessInput {
  rulesRecorded: boolean;
  burstPhasesPassed: boolean;
  evidenceReviewedByCc: boolean;
  evidenceApprovedByJuan: boolean;
  /** The caller evaluates landingRateLimit(env) === 'allowed'. */
  rateLimitAllowed: boolean;
  pixelIdsMatch: boolean;
  tokenPresent: boolean;
  graphVersionCorrect: boolean;
  noTestCodeInProduction: boolean;
  uaApproved: boolean;
  previewDedupAllThree: boolean;
  productionBrowserAndServer: boolean;
  consentSuppressionProven: boolean;
  staffIsolationProven: boolean;
  rollbackTested: boolean;
}

export function marketingReadiness(input: MarketingReadinessInput) {
  const checks = {
    rulesRecorded: input.rulesRecorded,
    burstPhasesPassed: input.burstPhasesPassed,
    evidenceApproved: input.evidenceReviewedByCc && input.evidenceApprovedByJuan,
    rateLimitAllowed: input.rateLimitAllowed,
    pixelIdsMatch: input.pixelIdsMatch,
    tokenPresent: input.tokenPresent,
    graphVersionCorrect: input.graphVersionCorrect,
    noTestCodeInProduction: input.noTestCodeInProduction,
    uaApproved: input.uaApproved,
    previewDedupAllThree: input.previewDedupAllThree,
    productionBrowserAndServer: input.productionBrowserAndServer,
    consentSuppressionProven: input.consentSuppressionProven,
    staffIsolationProven: input.staffIsolationProven,
    rollbackTested: input.rollbackTested,
  };
  const total = Object.keys(checks).length;
  const readyCount = Object.values(checks).filter(Boolean).length;
  return { checks, readyCount, total, ready: readyCount === total };
}
