const Party = require('../moduls/party');
const Bill = require('../moduls/bill');
const Payment = require('../moduls/payment');

// Add Party
exports.addParty = async (req, res) => {
  try {
    const { partyName, mobileNo, address, vehicleNumbers, remark } = req.body;
    
    const party = new Party({
      partyName,
      mobileNo,
      address,
      vehicleNumbers: Array.isArray(vehicleNumbers) ? vehicleNumbers : [],
      remark
    });

    await party.save();
    res.status(201).json(party);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all Parties with Search and Pagination
exports.getParties = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10, sortBy = 'partyName', order = 'asc' } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { partyName: { $regex: search, $options: 'i' } },
        { mobileNo: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { vehicleNumbers: { $elemMatch: { $regex: search, $options: 'i' } } }
      ];
    }

    const sortOrder = order === 'desc' ? -1 : 1;
    const sort = { [sortBy]: sortOrder };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Party.countDocuments(query);
    const parties = await Party.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Calculate totals for each party in bulk (no N+1 queries)
    const partyIds = parties.map(p => p._id);

    // Group bills by partyId
    const billTotals = await Bill.aggregate([
      { $match: { partyId: { $in: partyIds } } },
      { $group: { _id: '$partyId', totalBillAmount: { $sum: '$billAmount' } } }
    ]);

    // Group payments by partyId
    const paymentTotals = await Payment.aggregate([
      { $match: { partyId: { $in: partyIds } } },
      { $group: { _id: '$partyId', totalPaidAmount: { $sum: '$amount' } } }
    ]);

    const billMap = billTotals.reduce((map, curr) => {
      if (curr._id) map[curr._id.toString()] = curr.totalBillAmount;
      return map;
    }, {});

    const paymentMap = paymentTotals.reduce((map, curr) => {
      if (curr._id) map[curr._id.toString()] = curr.totalPaidAmount;
      return map;
    }, {});

    const partiesWithTotals = parties.map((party) => {
      const totalBillAmount = billMap[party._id.toString()] || 0;
      const totalPaidAmount = paymentMap[party._id.toString()] || 0;
      const totalDueAmount = totalBillAmount - totalPaidAmount;

      return {
        ...party.toObject(),
        totalBillAmount,
        totalPaidAmount,
        totalDueAmount
      };
    });

    res.status(200).json({
      parties: partiesWithTotals,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Party by ID
exports.getPartyById = async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    res.status(200).json(party);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Party
exports.updateParty = async (req, res) => {
  try {
    const { partyName, mobileNo, address, vehicleNumbers, remark } = req.body;
    const party = await Party.findById(req.params.id);

    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }

    party.partyName = partyName || party.partyName;
    party.mobileNo = mobileNo || party.mobileNo;
    party.address = address !== undefined ? address : party.address;
    party.vehicleNumbers = Array.isArray(vehicleNumbers) ? vehicleNumbers : party.vehicleNumbers;
    party.remark = remark !== undefined ? remark : party.remark;

    await party.save();
    res.status(200).json(party);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete Party
exports.deleteParty = async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    await party.deleteOne();
    res.status(200).json({ message: 'Party deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
