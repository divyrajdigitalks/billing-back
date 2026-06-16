const Payment = require('../moduls/payment');
const Party = require('../moduls/party');
const { recalculatePartyBills } = require('../utils/balanceHelper');

// Add Payment
exports.addPayment = async (req, res) => {
  try {
    const { partyId, paymentDate, amount, paymentMode, remark } = req.body;

    const party = await Party.findById(partyId);
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }

    const payment = new Payment({
      partyId,
      paymentDate: paymentDate || new Date(),
      amount,
      paymentMode,
      remark
    });

    await payment.save();
    await recalculatePartyBills(partyId);
    res.status(201).json(payment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all Payments with Search and Pagination
exports.getPayments = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Find parties matching search
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
        { paymentMode: { $regex: search, $options: 'i' } },
        { remark: { $regex: search, $options: 'i' } }
      ];
      if (partyIds.length > 0) {
        query.$or.push({ partyId: { $in: partyIds } });
      }
    }

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
      .populate('partyId', 'partyName mobileNo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      payments,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Payment by ID
exports.getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id).populate('partyId', 'partyName mobileNo');
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    res.status(200).json(payment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Payment
exports.updatePayment = async (req, res) => {
  try {
    const { paymentDate, amount, paymentMode, remark } = req.body;
    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    payment.paymentDate = paymentDate || payment.paymentDate;
    payment.amount = amount !== undefined ? amount : payment.amount;
    payment.paymentMode = paymentMode || payment.paymentMode;
    payment.remark = remark !== undefined ? remark : payment.remark;

    await payment.save();
    await recalculatePartyBills(payment.partyId);
    res.status(200).json(payment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete Payment
exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    const partyId = payment.partyId;
    await payment.deleteOne();
    await recalculatePartyBills(partyId);
    res.status(200).json({ message: 'Payment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
