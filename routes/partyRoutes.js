const express = require('express');
const router = express.Router();
const partyController = require('../controllers/partyController');

router.post('/', partyController.addParty);
router.get('/', partyController.getParties);
router.get('/:id', partyController.getPartyById);
router.put('/:id', partyController.updateParty);
router.delete('/:id', partyController.deleteParty);

module.exports = router;
