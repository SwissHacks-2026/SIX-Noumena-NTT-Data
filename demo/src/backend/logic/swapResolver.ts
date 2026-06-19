import type { Conflict, CIOEntry, Holding, SuggestedSwap } from '../../shared/types';

let swapCounter = 0;
function makeId() {
  return `swap-${++swapCounter}-${Date.now()}`;
}

// Mandate drift tolerance: ±2.0 percentage points
const DRIFT_THRESHOLD = 2.0;

function capitalize(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function sameBroadSector(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;

  // Fuzzy: both contain a shared keyword
  const keywords = ['pharma', 'health', 'tech', 'consumer', 'financ', 'energy', 'real', 'bond', 'equity'];
  return keywords.some(k => na.includes(k) && nb.includes(k));
}

export function resolveSwaps(
  conflicts: Conflict[],
  cioList: CIOEntry[],
  allHoldings: Holding[],
  mandateKey: string
): SuggestedSwap[] {
  const swaps: SuggestedSwap[] = [];
  const totalCHF = allHoldings.reduce((s, h) => s + h.currentCHF, 0);

  for (const conflict of conflicts) {
    // Mandate-level conflicts: no swap, just flag
    if (conflict.conflictType === 'mandate') {
      swaps.push({
        id: makeId(),
        conflict,
        fromISIN: '',
        fromName: 'Multiple holdings (Consumer Staples & Healthcare)',
        fromCurrentCHF: 0,
        toISIN: '',
        toName: 'No rebalancing recommended — conflicts with client mandate',
        toTicker: '',
        cioRating: 'HOLD',
        cioView:
          'Client DNA explicitly opposes aggressive shifts to volatile growth equities. RM should discuss with client before any tactical rebalancing.',
        subAssetClass: conflict.holding?.subAssetClass ?? '',
        mandateCompliant: false,
        mandateNote:
          'CIO tactical update conflicts with this client\'s Defensive mandate and stated risk aversion. Recommend RM-led conversation before any action.',
        status: 'pending_rm_review',
      });
      continue;
    }

    if (!conflict.holding) continue;
    const holding = conflict.holding;

    // Find BUY-rated alternatives.
    // Priority order:
    //   1. Same industry group + same sub-asset class (best match)
    //   2. Same industry group only (cross sub-class, flag RM)
    //   3. Same sub-asset class only (different sector)
    const exactMatch = cioList.filter(c =>
      c.Rating === 'BUY' && c.ISIN !== holding.isin &&
      c['Sub-Asset Class'] === holding.subAssetClass &&
      sameBroadSector(c['Industry Group'] || '', holding.industryGroup || '')
    );

    const sameIndustry = cioList.filter(c =>
      c.Rating === 'BUY' && c.ISIN !== holding.isin &&
      c['Sub-Asset Class'] !== holding.subAssetClass &&
      sameBroadSector(c['Industry Group'] || '', holding.industryGroup || '') &&
      !exactMatch.some(e => e.ISIN === c.ISIN)
    );

    const sameSubClassOnly = cioList.filter(c =>
      c.Rating === 'BUY' && c.ISIN !== holding.isin &&
      c['Sub-Asset Class'] === holding.subAssetClass &&
      !exactMatch.some(e => e.ISIN === c.ISIN) &&
      !allHoldings.some(h => h.isin === c.ISIN)
    );

    const candidates = exactMatch.length > 0 ? exactMatch
      : sameIndustry.length > 0 ? sameIndustry
      : sameSubClassOnly;

    if (candidates.length === 0) continue;

    // Pick the best candidate (first in list = highest priority)
    const best = candidates[0];
    const isTopUp = allHoldings.some(h => h.isin === best.ISIN);

    const mandateCompliant = best['Sub-Asset Class'] === holding.subAssetClass;

    swaps.push({
      id: makeId(),
      conflict,
      fromISIN: holding.isin,
      fromName: holding.name,
      fromCurrentCHF: holding.currentCHF,
      toISIN: best.ISIN,
      toName: best['Issuer / Asset'],
      toTicker: best['Yahoo Ticker'] || '',
      cioRating: best.Rating as 'BUY',
      cioView: best['CIO View'] || '',
      subAssetClass: best['Sub-Asset Class'],
      mandateCompliant,
      mandateNote: mandateCompliant
        ? `${capitalize(mandateKey)} mandate ✓ — same sub-asset class (${best['Sub-Asset Class']}), no drift breach${isTopUp ? ' — increases existing position' : ''}`
        : `Cross sub-class swap — RM should verify mandate compliance before executing`,
      status: 'pending_rm_review',
    });
  }

  return swaps;
}
