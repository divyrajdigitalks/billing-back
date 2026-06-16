const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');

router.post('/', billController.addBill);
router.get('/', billController.getBills);
router.get('/:id', billController.getBillById);
router.put('/:id', billController.updateBill);
router.delete('/:id', billController.deleteBill);

module.exports = router;
