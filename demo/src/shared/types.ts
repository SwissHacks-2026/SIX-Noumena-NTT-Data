// ── Legacy types (kept for existing analysis POC) ─────────────────────────────
export interface StockData {
  symbol: string;
  name: string;
  currentPrice: number;
  currency: string;
  change: number;
  changePercent: number;
  timestamp: string;
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment?: SentimentAnalysis;
}

export interface SentimentAnalysis {
  score: number;
  magnitude: number;
  label: 'BEARISH' | 'NEUTRAL' | 'BULLISH';
  confidence: number;
}

export interface PortfolioRecommendation {
  symbol: string;
  currentPrice: number;
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;
  reasoning: string;
  suggestedAction: 'ADD' | 'REMOVE' | 'MAINTAIN';
  targetPrice?: number;
  stopLoss?: number;
}

export interface IntegrationProbe {
  name: string;
  configured: boolean;
  ok: boolean;
  durationMs: number;
  request: { method: string; url: string; headers?: Record<string, string>; body?: unknown };
  response?: { status?: number; body: string };
  error?: string;
}

export interface AnalysisRequest {
  symbol: string;
  days?: number;
}

export interface LegacyAnalysisResult {
  stock: StockData;
  news: NewsArticle[];
  sentiment: SentimentAnalysis;
  recommendation: PortfolioRecommendation;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Wealth Advisory Dashboard types ───────────────────────────────────────────

export interface CRMEntry {
  Date: number; // Excel serial date
  Medium: string;
  'RM Name': string;
  'Client Contact': string;
  Note: string;
}

export interface RawHolding {
  'Asset Class': string;
  'Sub-Asset Class': string;
  Region: string;
  'Industry Group': string;
  'Issuer / Asset': string;
  'Security / Details': string;
  ISIN: string;
  'Target (CHF)': number;
  'Current (CHF)': number;
  Valor: string;
  MIC: string;
  'Yahoo Ticker': string;
}

export interface CIOEntry {
  Rating: 'BUY' | 'HOLD' | 'SELL' | string;
  'Rating Since': number;
  'Asset Class': string;
  'Sub-Asset Class': string;
  Region: string;
  'Industry Group': string;
  'Issuer / Asset': string;
  'Security / Details': string;
  ISIN: string;
  'CIO View': string;
  Valor: string;
  MIC: string;
  'Yahoo Ticker': string;
  'As Of': number;
}

export interface Holding {
  isin: string;
  name: string;
  assetClass: string;
  subAssetClass: string;
  industryGroup: string;
  region: string;
  ticker: string;
  valor: string;
  mic: string;
  targetCHF: number;
  currentCHF: number;
  currentPrice: number | null;
  currency: string;
  priceChange: number | null;
  priceChangePercent: number | null;
  portfolioWeight: number;
  priceSource: 'SIX' | 'Yahoo' | 'stored';
}

export interface LifeEvent {
  date: string;
  type: string;
  description: string;
  portfolioImpact: string;
}

export interface CommunicationStyle {
  language: 'de' | 'en' | 'fr';
  tone: 'formal' | 'informal';
  preferred: 'values-led' | 'data-driven' | 'executive' | 'collaborative';
  formatPreference?: string;
}

export interface ClientDNA {
  clientId: string;
  values: {
    priorities: string[];
    redLines: string[];
    preferredSectors: string[];
    avoidedSectors: string[];
    esgFocus: string[];
  };
  investmentBehavior: {
    riskTolerance: 'conservative' | 'moderate' | 'aggressive';
    timeHorizon: string;
    liquidity: string;
    mandate: string;
  };
  lifeEvents: LifeEvent[];
  communicationStyle: CommunicationStyle;
  keyQuotes: string[];
  confidence: number;
  sourcedFrom: number[];
}

export type AlertType = 'conflict' | 'opportunity' | 'mandate_conflict' | 'market';

export interface NewsAlert {
  id: string;
  headline: string;
  summary: string;
  source: string;
  publishedAt: string;
  url?: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  relevanceScore: number;
  affectedISINs: string[];
  affectedSectors: string[];
  alertType: AlertType;
  isMock: boolean;
}

export interface Conflict {
  id: string;
  alert: NewsAlert;
  holding: Holding | null;
  dnaField: string;
  dnaValue: string;
  conflictType: 'values' | 'sector' | 'esg' | 'mandate' | 'reputation';
  severity: 'high' | 'medium' | 'low';
  explanation: string;
}

export interface SuggestedSwap {
  id: string;
  conflict: Conflict;
  fromISIN: string;
  fromName: string;
  fromCurrentCHF: number;
  toISIN: string;
  toName: string;
  toTicker: string;
  cioRating: 'BUY' | 'HOLD' | 'SELL';
  cioView: string;
  subAssetClass: string;
  mandateCompliant: boolean;
  mandateNote: string;
  status: 'pending_rm_review' | 'approved' | 'rejected';
}

export interface DraftMessage {
  id: string;
  swapId: string;
  content: string;
  language: 'de' | 'en';
  style: 'values-led' | 'data-driven' | 'executive' | 'collaborative';
  subject: string;
  status: 'pending_rm_review' | 'approved' | 'rejected' | 'sent';
  generatedAt: string;
}

export interface WealthAnalysisResult {
  clientId: string;
  clientName: string;
  mandate: string;
  dna: ClientDNA;
  holdings: Holding[];
  alerts: NewsAlert[];
  conflicts: Conflict[];
  suggestedSwaps: SuggestedSwap[];
  draftMessages: DraftMessage[];
  portfolioTotalCHF: number;
  generatedAt: string;
  durationMs: number;
}

export interface ClientProfile {
  id: string;
  name: string;
  fullName: string;
  mandate: 'defensive' | 'balanced' | 'growth';
  portfolioKey: string;
  totalAUM: number;
  language: 'de' | 'en';
  crmKey: string;
}
