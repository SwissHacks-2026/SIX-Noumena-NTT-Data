import * as fs from 'fs';
import * as path from 'path';
import type {
  ClientProfile,
  CRMEntry,
  RawHolding,
  CIOEntry,
  WealthAnalysisResult,
} from '../shared/types';
import { extractClientDNA } from './agents/crmAgent';
import { enrichHoldings } from './agents/portfolioAgent';
import { fetchRelevantAlerts } from './agents/newsAgent';
import { detectConflicts } from './logic/conflictDetector';
import { resolveSwaps } from './logic/swapResolver';
import { draftMessages } from './agents/messageAgent';

const DATA_DIR = path.join(__dirname, '../data');

function loadJSON<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
}

const CLIENT_PROFILES: Record<string, ClientProfile> = {
  schneider: {
    id: 'schneider',
    name: 'Schneider',
    fullName: 'Hubertus Schneider',
    mandate: 'balanced',
    portfolioKey: 'balanced',
    totalAUM: 10_000_000,
    language: 'de',
    crmKey: 'schneider',
  },
  raeber: {
    id: 'raeber',
    name: 'Räber',
    fullName: 'Eugen & Lisa Räber',
    mandate: 'defensive',
    portfolioKey: 'defensive',
    totalAUM: 10_000_000,
    language: 'de',
    crmKey: 'raeber',
  },
  huber: {
    id: 'huber',
    name: 'Huber',
    fullName: 'Marius & Elena Huber',
    mandate: 'defensive',
    portfolioKey: 'defensive',
    totalAUM: 10_000_000,
    language: 'en',
    crmKey: 'huber',
  },
  ammann: {
    id: 'ammann',
    name: 'Ammann',
    fullName: 'Julian Ammann',
    mandate: 'growth',
    portfolioKey: 'growth',
    totalAUM: 10_000_000,
    language: 'en',
    crmKey: 'ammann',
  },
};

// In-memory result cache (5 min TTL for demo)
const analysisCache = new Map<string, { result: WealthAnalysisResult; ts: number }>();
const CACHE_TTL = 5 * 60_000;

export function listClients(): ClientProfile[] {
  return Object.values(CLIENT_PROFILES);
}

export function getClientProfile(id: string): ClientProfile | null {
  return CLIENT_PROFILES[id] ?? null;
}

export async function analyzeClient(clientId: string): Promise<WealthAnalysisResult> {
  const cached = analysisCache.get(clientId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;

  const start = Date.now();
  const profile = CLIENT_PROFILES[clientId];
  if (!profile) throw new Error(`Unknown client: ${clientId}`);

  // Load data
  const allCRM = loadJSON<Record<string, CRMEntry[]>>('clients.json');
  const allPortfolios = loadJSON<Record<string, RawHolding[]>>('portfolios.json');
  const cioList = loadJSON<CIOEntry[]>('cio-list.json');

  const crmEntries = allCRM[profile.crmKey] ?? [];
  const rawHoldings = allPortfolios[profile.portfolioKey] ?? [];

  // Phase 1: Run CRM agent and portfolio agent in parallel
  const [dna, holdings] = await Promise.all([
    extractClientDNA(clientId, crmEntries),
    enrichHoldings(rawHoldings),
  ]);

  // Phase 2: News (depends on DNA + holdings)
  const alerts = await fetchRelevantAlerts(clientId, dna, holdings);

  // Phase 3: Deterministic logic
  const conflicts = detectConflicts(alerts, holdings, dna);
  const swaps = resolveSwaps(conflicts, cioList, holdings, profile.mandate);

  // Phase 4: Draft messages
  const messages = await draftMessages(swaps, dna, alerts, profile.fullName);

  const portfolioTotalCHF = holdings.reduce((s, h) => s + h.currentCHF, 0);

  const result: WealthAnalysisResult = {
    clientId,
    clientName: profile.fullName,
    mandate: profile.mandate,
    dna,
    holdings,
    alerts,
    conflicts,
    suggestedSwaps: swaps,
    draftMessages: messages,
    portfolioTotalCHF,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };

  analysisCache.set(clientId, { result, ts: Date.now() });
  return result;
}

export function clearCache(clientId?: string) {
  if (clientId) analysisCache.delete(clientId);
  else analysisCache.clear();
}
