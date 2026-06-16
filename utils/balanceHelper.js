const Bill = require('../moduls/bill');
const Payment = require('../moduls/payment');

async function recalculatePartyBills(partyId) {
  if (!partyId) return;
  
  // Get all bills sorted by billDate and createdAt
  const bills = await Bill.find({ partyId }).sort({ billDate: 1, createdAt: 1 });
  
  // Get all payments for this party
  const payments = await Payment.find({ partyId });
  
  // Calculate total amount received
  const totalReceived = payments.reduce((sum, p) => sum + p.amount, 0);
  
  // Distribute payments across bills (FIFO)
  let remainingAmount = totalReceived;
  for (const bill of bills) {
    const allocated = Math.min(bill.billAmount, remainingAmount);
    bill.paidAmount = allocated;
    bill.pendingAmount = bill.billAmount - allocated;
    await bill.save();
    remainingAmount -= allocated;
  }
}

module.exports = {
  recalculatePartyBills
};
