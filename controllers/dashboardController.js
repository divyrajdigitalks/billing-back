const Party = require('../moduls/party');
const Bill = require('../moduls/bill');
const Payment = require('../moduls/payment');

exports.getDashboardSummary = async (req, res) => {
  try {
    const totalParties = await Party.countDocuments();
    const totalBills = await Bill.countDocuments();

    // Total Bill Amount
    const billSum = await Bill.aggregate([
      { $group: { _id: null, total: { $sum: '$billAmount' } } }
    ]);
    const totalBillAmount = billSum.length > 0 ? billSum[0].total : 0;

    // Total Received Amount
    const paymentSum = await Payment.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalReceivedAmount = paymentSum.length > 0 ? paymentSum[0].total : 0;

    const totalPendingAmount = totalBillAmount - totalReceivedAmount;

    // Monthly Billing Chart Data (last 6 months or all)
    const monthlyBilling = await Bill.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$billDate' } },
          totalAmount: { $sum: '$billAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Monthly Collection Chart Data
    const monthlyCollections = await Payment.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$paymentDate' } },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Format monthly data for chart consumption on frontend
    // Format: { month: '2026-01', billing: 12000, collection: 8000 }
    const chartMap = {};
    monthlyBilling.forEach(item => {
      chartMap[item._id] = { month: item._id, billing: item.totalAmount, collection: 0 };
    });
    monthlyCollections.forEach(item => {
      if (chartMap[item._id]) {
        chartMap[item._id].collection = item.totalAmount;
      } else {
        chartMap[item._id] = { month: item._id, billing: 0, collection: item.totalAmount };
      }
    });

    const monthlyChartData = Object.values(chartMap).sort((a, b) => a.month.localeCompare(b.month));

    res.status(200).json({
      totalParties,
      totalBills,
      totalBillAmount,
      totalReceivedAmount,
      totalPendingAmount,
      monthlyChartData
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
