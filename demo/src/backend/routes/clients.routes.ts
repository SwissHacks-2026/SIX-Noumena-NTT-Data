import { Router } from 'express';
import { ClientsController } from '../controllers/clients.controller';

const router = Router();
const ctrl = new ClientsController();

router.get('/', (req, res) => ctrl.getClients(req, res));
router.get('/:id', (req, res) => ctrl.getClient(req, res));
router.post('/:id/analysis', (req, res) => ctrl.analyzeClient(req, res));
router.post('/:id/approve', (req, res) => ctrl.approveSwap(req, res));
router.post('/:id/reject', (req, res) => ctrl.rejectSwap(req, res));

export default router;
