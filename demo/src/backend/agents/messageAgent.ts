import axios from 'axios';
import type { SuggestedSwap, ClientDNA, DraftMessage, NewsAlert } from '../../shared/types';

const API_KEY = process.env.PHOENIQS_API_KEY!;
const API_URL = process.env.PHOENIQS_API_URL!;
const MODEL = process.env.PHOENIQS_MODEL || 'inference-gpt-oss-120b';

let msgCounter = 0;

function buildPrompt(
  swap: SuggestedSwap,
  dna: ClientDNA,
  alert: NewsAlert,
  clientName: string
): string {
  const lang = dna.communicationStyle.language === 'de' ? 'German (Sie-form, formal)' : 'English (professional, direct)';
  const style = dna.communicationStyle.preferred;
  const formatHint = dna.communicationStyle.formatPreference
    ? `Format preference: ${dna.communicationStyle.formatPreference}.`
    : '';

  // Style-specific instructions
  const styleInstructions: Record<string, string> = {
    'values-led':
      'Write with warmth and emotional intelligence. Reference the client\'s personal values and life context implicitly (not explicitly — no direct mention of personal health details). Explain why the proposed company better aligns with what matters most to this client. Be human, not transactional.',
    'data-driven':
      'Lead with numbers and structure. Use a clear table or bullet format showing the allocation impact, sector comparison, and mandate compliance. Reference specific percentages and CHF amounts. The client trusts data, not rhetoric.',
    'executive':
      'Be direct and concise. Three short paragraphs max. State the risk, state the action, state the rationale. No preamble. The client has zero tolerance for fluff. Reference reputational and governance risk in financial terms.',
    'collaborative':
      'Write in a tone of shared mission. Celebrate the positive development and frame the client\'s holding as an endorsement of the right corporate behaviour. Inspire. Make the client feel proud of their portfolio\'s alignment with their life\'s work.',
  };

  const instruction = styleInstructions[style] || styleInstructions['values-led'];

  // Opportunity vs conflict
  const isOpportunity = alert.alertType === 'opportunity';
  const isMandateConflict = alert.alertType === 'mandate_conflict';

  let situationDesc = '';
  if (isOpportunity) {
    situationDesc = `
SITUATION (OPPORTUNITY — positive alert):
The client holds ${swap.fromName || alert.affectedISINs[0] || 'a company'} in their portfolio.
News: "${alert.headline}"
This is a POSITIVE development that perfectly aligns with the client's values.
Draft a message celebrating this alignment and explaining why the RM is pleased to share this news.
No swap needed — reinforce the client's confidence in their existing holding.`;
  } else if (isMandateConflict) {
    situationDesc = `
SITUATION (MANDATE CONFLICT):
Alert: "${alert.headline}"
This CIO recommendation conflicts with the client's explicit mandate and risk preferences.
Draft a message to the RM (Sarah Meier) advising her to discuss this with the client BEFORE any rebalancing.
Explain why this conflicts with the client's investment DNA and what Sarah should say.`;
  } else {
    situationDesc = `
SITUATION (CONFLICT ALERT):
Current holding: ${swap.fromName} (${swap.fromISIN})
Alert: "${alert.headline}"
Why it conflicts: ${swap.conflict.explanation}
Proposed action: Swap from ${swap.fromName} → ${swap.toName}
Rationale for ${swap.toName}: ${swap.cioView}
Mandate status: ${swap.mandateNote}`;
  }

  return `You are a senior private banking relationship manager (Sarah Meier) drafting an advisory note for a client.

CLIENT: ${clientName}
LANGUAGE: ${lang}
COMMUNICATION STYLE: ${style}
${formatHint}

${situationDesc}

CLIENT DNA CONTEXT:
- Key priorities: ${dna.values.priorities.slice(0, 3).join('; ')}
- Red lines: ${dna.values.redLines.slice(0, 2).join('; ') || 'None stated'}
- Key quotes from CRM: ${dna.keyQuotes.slice(0, 2).map(q => `"${q}"`).join(' | ')}

INSTRUCTION:
${instruction}

CRITICAL RULES:
1. Never mention specific health diagnoses or personal medical details directly
2. Never claim certainty about future prices
3. Always frame as "RM recommends" — client always decides
4. Include a clear call-to-action (e.g., "I would welcome a brief call to discuss")
5. Sign off as: Sarah Meier, Relationship Manager

Return ONLY the message body (no JSON, no subject line — just the message text). Start with the salutation.`;
}

export async function draftMessages(
  swaps: SuggestedSwap[],
  dna: ClientDNA,
  alerts: NewsAlert[],
  clientName: string
): Promise<DraftMessage[]> {
  const messages: DraftMessage[] = [];

  // Also draft for opportunity alerts (no swap)
  const opportunityAlerts = alerts.filter(a => a.alertType === 'opportunity');
  const allItems: Array<{ swap?: SuggestedSwap; alert: NewsAlert }> = [
    ...swaps.map(s => ({ swap: s, alert: s.conflict.alert })),
    ...opportunityAlerts.map(a => ({
      swap: undefined,
      alert: a,
    })),
  ];

  for (const item of allItems) {
    const { swap, alert } = item;

    // Create a synthetic swap object for opportunity alerts
    const effectiveSwap: SuggestedSwap = swap ?? {
      id: `opp-${++msgCounter}`,
      conflict: {
        id: `opp-conflict-${msgCounter}`,
        alert,
        holding: null,
        dnaField: 'values.esgFocus',
        dnaValue: dna.values.esgFocus[0] || 'sustainability',
        conflictType: 'esg',
        severity: 'low',
        explanation: 'Positive alignment with client values',
      },
      fromISIN: alert.affectedISINs[0] || '',
      fromName: alert.affectedISINs[0] || '',
      fromCurrentCHF: 0,
      toISIN: '',
      toName: '',
      toTicker: '',
      cioRating: 'BUY',
      cioView: '',
      subAssetClass: '',
      mandateCompliant: true,
      mandateNote: 'No swap required — opportunity alert',
      status: 'pending_rm_review',
    };

    const prompt = buildPrompt(effectiveSwap, dna, alert, clientName);

    try {
      const response = await axios.post(
        `${API_URL}/chat/completions`,
        {
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1200,
        },
        {
          headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );

      const content = response.data.choices[0].message.content.trim();

      // Extract subject line
      const subjectMap: Record<string, string> = {
        'values-led': dna.communicationStyle.language === 'de'
          ? 'Portfolioüberprüfung — Handlungsbedarf'
          : 'Portfolio Review — Action Required',
        'data-driven': dna.communicationStyle.language === 'de'
          ? 'Portfolioanalyse — Rebalancierungsempfehlung'
          : 'Portfolio Analysis — Rebalancing Recommendation',
        executive: 'Portfolio Alert — Governance Risk: Immediate Review',
        collaborative: 'Exciting Portfolio Development — Your Holdings in Action',
      };

      messages.push({
        id: `msg-${++msgCounter}-${Date.now()}`,
        swapId: effectiveSwap.id,
        content,
        language: dna.communicationStyle.language === 'de' ? 'de' : 'en',
        style: dna.communicationStyle.preferred,
        subject: subjectMap[dna.communicationStyle.preferred] || 'Portfolio Update',
        status: 'pending_rm_review',
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('messageAgent error:', err.message);
      const fallbackContent = buildFallbackMessage(dna.clientId, alert, effectiveSwap);
      const subjectMap: Record<string, string> = {
        'values-led': dna.communicationStyle.language === 'de' ? 'Portfolioüberprüfung — Handlungsbedarf' : 'Portfolio Review — Action Required',
        'data-driven': dna.communicationStyle.language === 'de' ? 'Portfolioanalyse — Rebalancierungsempfehlung' : 'Portfolio Analysis — Rebalancing Recommendation',
        executive: 'Portfolio Alert — Governance Risk: Immediate Review',
        collaborative: 'Exciting Portfolio Development — Your Holdings in Action',
      };
      messages.push({
        id: `msg-${++msgCounter}-${Date.now()}`,
        swapId: effectiveSwap.id,
        content: fallbackContent,
        language: dna.communicationStyle.language === 'de' ? 'de' : 'en',
        style: dna.communicationStyle.preferred,
        subject: subjectMap[dna.communicationStyle.preferred] || 'Portfolio Update',
        status: 'pending_rm_review',
        generatedAt: new Date().toISOString(),
      });
    }
  }

  return messages;
}

// Per-client pre-written fallback messages (used when LLM is unavailable)
function buildFallbackMessage(clientId: string, alert: NewsAlert, swap: SuggestedSwap): string {
  const fallbacks: Record<string, string> = {
    schneider: `Sehr geehrter Herr Schneider,

ich hoffe, Sie befinden sich wohl und konnten Ihren Aufenthalt in Boston trotz der intensiven Umstände nutzen.

Ich schreibe Ihnen heute mit einer wichtigen Information zu unserem Pharmaportefeuille: Roche Holding AG hat angekündigt, seine Abteilung für neurologische und zentralnervöse Forschung vollständig zu schliessen. Alle laufenden Programme in diesem Bereich werden zum Quartalsende eingestellt.

Angesichts der fundamentalen Bedeutung, die Sie der Forschung im Bereich neurodegenerativer Erkrankungen beimessen — und im Kontext des Stiftungsauftrags Ihrer Familie — sehe ich hier einen klaren Handlungsbedarf. Roche verlässt exakt jenes Feld, das Ihnen und Ihrer Familie am Herzen liegt.

Ich empfehle Ihnen daher, die Roche-Position (CHF ${Math.round(swap.fromCurrentCHF).toLocaleString('de-CH')}) in Novartis umzuschichten. Novartis verfolgt eine fokussierte Strategie in der spezialisierten Medizin mit einem klaren Engagement im Bereich neurodegenerativer Erkrankungen — genau das, was Roche nun aufgibt. Die CIO-Analyse bewertet Novartis derzeit mit «Kaufen» und hebt das Potenzial für Margenexpansion hervor.

Beide Titel gehören zur Kategorie Schweizer Inlandsaktien. Ein Tausch würde Ihr Mandat vollständig im Rahmen halten.

Die endgültige Entscheidung liegt selbstverständlich bei Ihnen. Ich stehe Ihnen gerne für ein kurzes Gespräch zur Verfügung, sobald es Ihre Zeit erlaubt.

Mit freundlichen Grüssen
Sarah Meier
Relationship Manager`,

    raeber: `Sehr geehrter Herr Räber, sehr geehrte Frau Räber,

ich komme heute mit einem wichtigen Hinweis zur aktuellen CIO-Taktikempfehlung, die ich Ihnen zur Beurteilung vorlegen möchte.

Der Chief Investment Officer empfiehlt eine Umschichtung aus defensiven Werten (Nahrungsmittel & Gesundheit) in US-Technologiegiganten (Microsoft, Apple, NVIDIA, Alphabet). Die vorgeschlagene Reduktion beträgt 8–12% der betreffenden Positionen.

Als Ihr Relationship Manager ist es meine Aufgabe, Sie auf einen fundamentalen Widerspruch hinzuweisen:

| Dimension | CIO-Empfehlung | Ihr Mandat & DNA |
|---|---|---|
| Sektor | US-Tech Mega-Caps | Defensive Value (CH/EU) |
| Volatilität | Hoch | Explizit abgelehnt |
| Strategie | Taktisches Umschichten | «Ruhig, stabil, ohne aggressive Shifts» |
| Risikoprofil | Aggressiv | Konservativ |

Ich empfehle, diese Umschichtung nicht zu vollziehen. Ihr Mandat, das Sie gemeinsam mit meinem Vorgänger Thomas Keller sorgfältig aufgebaut haben, ist klar ausgerichtet: globale defensive Qualität, stabile Dividenden, keine spekulativen Positionsveränderungen.

Ich werde die CIO-Abteilung entsprechend informieren, dass wir bei Ihnen keine Anpassung vornehmen.

Falls Sie die Empfehlung dennoch diskutieren möchten, stehe ich Ihnen gerne zur Verfügung.

Mit freundlichen Grüssen
Sarah Meier
Relationship Manager`,

    huber: `Dear Marius and Elena,

I hope you are enjoying your preparations for the upcoming trip to the conservation sites in Brazil — I know how meaningful this journey is for both of you.

I wanted to share some truly exciting news from your portfolio.

Unilever — one of your core holdings — has just made what I consider to be one of the most significant corporate commitments in the consumer goods industry in years. They have announced:

1. A complete cut-off of all suppliers linked to palm oil deforestation by December 2026
2. The launch of the "Unilever Amazon Restoration Foundation" with an initial €80M endowment for reforestation in exactly the region you work in — the Brazilian Amazon

This is not a press release. This is a concrete, verifiable, and legally binding supply chain transformation — the kind of corporate accountability you have been calling for.

Your portfolio is already on the right side of history here. This holding is now doing what you have always believed capital should do: fighting on the frontlines alongside the scientists and conservationists.

No action is required. I simply wanted to ensure you knew that the work you are doing in the field, and the capital you have deployed here, are moving in the same direction.

I look forward to hearing about your time in Brazil.

With warm regards,
Sarah Meier
Relationship Manager`,

    ammann: `Dear Julian,

I am writing to flag an urgent governance issue in your Growth portfolio that requires your immediate attention.

SITUATION: The US Department of Labor has opened a federal investigation into Amazon.com (US0231351067) for systematic wage theft, illegal overtime practices, and unreported safety violations across 23 distribution centres. Judicial documents allege 18,000+ affected workers and potential liability exceeding USD 340M. Senate hearings are scheduled.

RISK ASSESSMENT:
- Current position: CHF ${Math.round(swap.fromCurrentCHF || 200000).toLocaleString()} (Growth portfolio)
- Risk type: Judicial + operational + reputational
- Press trajectory: This is early-stage — not yet mainstream. Exactly the scenario you asked to be alerted to first.
- Governance standard: Incompatible with your stated zero-tolerance mandate

RECOMMENDED ACTION: Exit Amazon position. Propose redeployment into Hermès International (FR0000052292) — CIO BUY-rated, same Foreign Developed Markets category, zero current governance flags, and a track record of ethical sourcing and labour practices that withstands scrutiny.

This is the RM recommending — not executing. Your decision, your portfolio.

I can prepare the trade ticket within the hour if you confirm.

Sarah Meier
Relationship Manager`,
  };

  return fallbacks[clientId] || `Dear ${clientId},\n\nI am writing regarding a recent development in your portfolio that warrants your attention.\n\nAlert: ${alert.headline}\n\n${swap.fromISIN ? `Proposed action: Review position in ${swap.fromName}.` : 'No immediate action required — monitoring.'}\n\nI am available to discuss at your convenience.\n\nSarah Meier\nRelationship Manager`;
}
