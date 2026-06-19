import type { NewsAlert, Holding, ClientDNA, Conflict } from '../../shared/types';

let conflictCounter = 0;

function makeId() {
  return `conflict-${++conflictCounter}-${Date.now()}`;
}

function textMatches(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some(t => lower.includes(t.toLowerCase()));
}

export function detectConflicts(
  alerts: NewsAlert[],
  holdings: Holding[],
  dna: ClientDNA
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const alert of alerts) {
    // Mandate conflict (no holding involved)
    if (alert.alertType === 'mandate_conflict') {
      conflicts.push({
        id: makeId(),
        alert,
        holding: null,
        dnaField: 'investmentBehavior.riskTolerance',
        dnaValue: dna.investmentBehavior.riskTolerance,
        conflictType: 'mandate',
        severity: 'high',
        explanation:
          `CIO tactical update conflicts with client's ${dna.investmentBehavior.riskTolerance} mandate. ` +
          `Client's DNA explicitly prohibits aggressive shifts into volatile growth equities.`,
      });
      continue;
    }

    // Opportunity alert — not a conflict, skip
    if (alert.alertType === 'opportunity') continue;

    // Find affected holdings — prefer explicit ISINs; fall back to sector only when no ISINs specified
    const affectedHoldings = holdings.filter(h => {
      if (alert.affectedISINs.length > 0) return alert.affectedISINs.includes(h.isin);
      return alert.affectedSectors.some(s => h.industryGroup?.includes(s) || h.assetClass?.includes(s));
    });

    for (const holding of affectedHoldings.slice(0, 2)) {
      // Check red lines
      for (let i = 0; i < dna.values.redLines.length; i++) {
        const redLine = dna.values.redLines[i];
        if (textMatches(`${alert.headline} ${alert.summary}`, redLine.split(' '))) {
          conflicts.push({
            id: makeId(),
            alert,
            holding,
            dnaField: `values.redLines[${i}]`,
            dnaValue: redLine,
            conflictType: 'values',
            severity: 'high',
            explanation: `Alert directly contradicts client's stated red line: "${redLine}". Immediate RM review required.`,
          });
          break;
        }
      }

      // Check avoided sectors
      for (let i = 0; i < dna.values.avoidedSectors.length; i++) {
        const avoided = dna.values.avoidedSectors[i];
        if (
          holding.industryGroup?.toLowerCase().includes(avoided.toLowerCase()) ||
          holding.assetClass?.toLowerCase().includes(avoided.toLowerCase())
        ) {
          conflicts.push({
            id: makeId(),
            alert,
            holding,
            dnaField: `values.avoidedSectors[${i}]`,
            dnaValue: avoided,
            conflictType: 'sector',
            severity: 'medium',
            explanation: `Holding "${holding.name}" is in a sector the client has explicitly asked to avoid: "${avoided}".`,
          });
          break;
        }
      }

      // Reputation conflict (negative news + client values clean governance)
      if (
        alert.sentiment === 'negative' &&
        alert.alertType === 'conflict' &&
        conflicts.every(c => c.holding?.isin !== holding.isin)
      ) {
        const govImpact = dna.values.priorities.some(p =>
          ['governance', 'reputation', 'ethical', 'esg', 'corporate'].some(k => p.toLowerCase().includes(k))
        );
        if (govImpact || dna.values.esgFocus.length > 0) {
          conflicts.push({
            id: makeId(),
            alert,
            holding,
            dnaField: 'values.priorities',
            dnaValue: dna.values.priorities[0] || 'clean governance',
            conflictType: 'reputation',
            severity: 'high',
            explanation: `Negative news about "${holding.name}" poses reputational risk incompatible with client's stated governance standards.`,
          });
        } else {
          conflicts.push({
            id: makeId(),
            alert,
            holding,
            dnaField: 'investmentBehavior.riskTolerance',
            dnaValue: dna.investmentBehavior.riskTolerance,
            conflictType: 'reputation',
            severity: 'medium',
            explanation: `Material negative news about "${holding.name}" warrants RM review.`,
          });
        }
      }
    }
  }

  // Deduplicate by holding + alert
  const seen = new Set<string>();
  return conflicts.filter(c => {
    const key = `${c.alert.id}::${c.holding?.isin ?? 'none'}::${c.conflictType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
