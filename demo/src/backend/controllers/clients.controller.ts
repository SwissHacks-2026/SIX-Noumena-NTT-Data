import { Request, Response } from 'express';
import { listClients, getClientProfile, analyzeClient, clearCache } from '../orchestrator';

export class ClientsController {
  async getClients(_req: Request, res: Response) {
    try {
      const clients = listClients().map(p => ({
        id: p.id,
        name: p.name,
        fullName: p.fullName,
        mandate: p.mandate,
        totalAUM: p.totalAUM,
        language: p.language,
      }));
      res.json({ success: true, data: clients });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getClient(req: Request, res: Response) {
    try {
      const profile = getClientProfile(req.params.id);
      if (!profile) return res.status(404).json({ success: false, error: 'Client not found' });
      res.json({ success: true, data: profile });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async analyzeClient(req: Request, res: Response) {
    try {
      const profile = getClientProfile(req.params.id);
      if (!profile) return res.status(404).json({ success: false, error: 'Client not found' });

      console.log(`[orchestrator] Starting analysis for ${req.params.id}...`);
      const result = await analyzeClient(req.params.id);
      console.log(`[orchestrator] Done in ${result.durationMs}ms`);

      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error('[orchestrator] Error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async approveSwap(req: Request, res: Response) {
    try {
      // In a real system this would update DB and trigger execution
      // For demo: just return success with audit record
      const { swapId, messageId } = req.body;
      clearCache(req.params.id);
      res.json({
        success: true,
        data: {
          action: 'approved',
          clientId: req.params.id,
          swapId,
          messageId,
          timestamp: new Date().toISOString(),
          note: 'RM approval recorded. Swap queued for execution. Message ready to send to client.',
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async rejectSwap(req: Request, res: Response) {
    try {
      const { swapId, reason } = req.body;
      clearCache(req.params.id);
      res.json({
        success: true,
        data: {
          action: 'rejected',
          clientId: req.params.id,
          swapId,
          reason: reason || 'No reason provided',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
