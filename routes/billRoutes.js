const express = require('express');
const multer = require('multer');
const router = express.Router();
const billController = require('../controllers/billController');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/', billController.addBill);
router.post('/import/csv', upload.single('file'), billController.importCsv);
router.get('/export/csv', billController.exportCsv);
router.get('/', billController.getBills);
router.get('/:id', billController.getBillById);
router.put('/:id', billController.updateBill);
router.delete('/:id', billController.deleteBill);

module.exports = router;
