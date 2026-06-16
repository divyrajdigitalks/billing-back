const express = require('express');
const router = express.Router();
const historyController = require('../controllers/historyController');

router.get('/:partyId', historyController.getPartyHistory);

module.exports = router;
