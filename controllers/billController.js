const Bill = require('../moduls/bill');
const Party = require('../moduls/party');
const { recalculatePartyBills } = require('../utils/balanceHelper');

// Add Bill
exports.addBill = async (req, res) => {
  try {
    const { partyId, vehicleNumber, billDate, billAmount, remark } = req.body;

    // Check if Party exists
    const party = await Party.findById(partyId);
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }

    // Auto generate bill number
    const lastBill = await Bill.findOne().sort({ createdAt: -1 });
    let newBillNo = 'BILL-10001';
    if (lastBill && lastBill.billNo) {
      const match = lastBill.billNo.match(/BILL-(\d+)/);
      if (match) {
        const lastNum = parseInt(match[1]);
        newBillNo = `BILL-${lastNum + 1}`;
      }
    }

    const bill = new Bill({
      billNo: newBillNo,
      partyId,
      vehicleNumber,
      billDate: billDate || new Date(),
      billAmount,
      remark
    });

    await bill.save();
    await recalculatePartyBills(partyId);
    res.status(201).json(bill);
  } catch (error) {
    console.error('Error in addBill:', error);
    res.status(400).json({ message: error.message });
  }
};

// Get all Bills with Search and Pagination
exports.getBills = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Find parties that match the search query
    let partyIds = [];
    if (search) {
      const matchingParties = await Party.find({
        partyName: { $regex: search, $options: 'i' }
      }).select('_id');
      partyIds = matchingParties.map(p => p._id);
    }

    const query = {};
    if (search) {
      query.$or = [
        { billNo: { $regex: search, $options: 'i' } },
        { vehicleNumber: { $regex: search, $options: 'i' } },
        { remark: { $regex: search, $options: 'i' } }
      ];
      if (partyIds.length > 0) {
        query.$or.push({ partyId: { $in: partyIds } });
      }
    }

    const total = await Bill.countDocuments(query);
    const bills = await Bill.find(query)
      .populate('partyId', 'partyName mobileNo vehicleNumbers')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      bills,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Bill by ID
exports.getBillById = async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id).populate('partyId', 'partyName mobileNo vehicleNumbers');
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    res.status(200).json(bill);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Bill
exports.updateBill = async (req, res) => {
  try {
    const { vehicleNumber, billDate, billAmount, remark } = req.body;
    const bill = await Bill.findById(req.params.id);

    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    bill.vehicleNumber = vehicleNumber !== undefined ? vehicleNumber : bill.vehicleNumber;
    bill.billDate = billDate || bill.billDate;
    bill.billAmount = billAmount !== undefined ? billAmount : bill.billAmount;
    bill.remark = remark !== undefined ? remark : bill.remark;

    await bill.save();
    await recalculatePartyBills(bill.partyId);
    res.status(200).json(bill);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete Bill
exports.deleteBill = async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    const partyId = bill.partyId;
    await bill.deleteOne();
    await recalculatePartyBills(partyId);
    res.status(200).json({ message: 'Bill deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
