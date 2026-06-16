const Party = require('../moduls/party');
const Bill = require('../moduls/bill');
const Payment = require('../moduls/payment');

exports.getPartyHistory = async (req, res) => {
  try {
    const { partyId } = req.params;

    const partyInfo = await Party.findById(partyId);
    if (!partyInfo) {
      return res.status(404).json({ message: 'Party not found' });
    }

    // Fetch all bills for this party
    const bills = await Bill.find({ partyId }).lean();
    // Fetch all payments for this party
    const payments = await Payment.find({ partyId }).lean();

    // Map bills to transaction format
    const billTransactions = bills.map(b => ({
      _id: b._id,
      date: b.billDate,
      type: 'Bill Created',
      billNo: b.billNo,
      billAmount: b.billAmount,
      receivedAmount: 0,
      remark: b.remark || ''
    }));

    // Map payments to transaction format
    const paymentTransactions = payments.map(p => ({
      _id: p._id,
      date: p.paymentDate,
      type: 'Payment Received',
      billNo: '-',
      billAmount: 0,
      receivedAmount: p.amount,
      remark: `Mode: ${p.paymentMode}${p.remark ? ` - ${p.remark}` : ''}`
    }));

    // Combine and sort by date ascending
    const transactions = [...billTransactions, ...paymentTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate running totals and balance
    let cumulativeBill = 0;
    let cumulativeReceived = 0;
    
    const transactionsWithBalance = transactions.map(tx => {
      cumulativeBill += tx.billAmount;
      cumulativeReceived += tx.receivedAmount;
      const pendingAmount = cumulativeBill - cumulativeReceived;
      
      return {
        ...tx,
        pendingAmount,
        runningBalance: pendingAmount
      };
    });

    // We can also update individual bills' paidAmount/pendingAmount if they match chronologically or just keep them synced overall.
    // The total pending amount overall for the party:
    const totalBillAmount = cumulativeBill;
    const totalReceivedAmount = cumulativeReceived;
    const totalPendingAmount = totalBillAmount - totalReceivedAmount;

    res.status(200).json({
      partyInfo,
      totalBillAmount,
      totalReceivedAmount,
      totalPendingAmount,
      transactions: transactionsWithBalance
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
