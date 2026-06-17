const Bill = require('../moduls/bill');
const Party = require('../moduls/party');
const { recalculatePartyBills } = require('../utils/balanceHelper');

const normalizeHeader = (header) => header.trim().toLowerCase().replace(/\s+/g, '');

const parseCsv = (content) => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];

  const headers = lines[0]
    .split(',')
    .map((header) => normalizeHeader(header.replace(/^"|"$/g, '')));

  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
    const row = {};
    headers.forEach((header, index) => {
      let value = values[index] || '';
      value = value.trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      row[header] = value;
    });
    return row;
  });
};

const getNextBillNo = async () => {
  const lastBill = await Bill.findOne().sort({ createdAt: -1 });
  let newBillNo = 'BILL-1';
  if (lastBill && lastBill.billNo) {
    const match = lastBill.billNo.match(/BILL-(\d+)/);
    if (match) {
      const lastNum = parseInt(match[1], 10);
      newBillNo = `BILL-${lastNum + 1}`;
    }
  }
  return newBillNo;
};

const findPartyFromRow = async (row) => {
  const partyId = row.partyid;
  const partyName = row.partyname;
  const mobileNumber = row.mobilenumber?.replace(/\D/g, '');

  if (partyId) {
    const party = await Party.findById(partyId);
    if (party) return party;
  }

  if (mobileNumber) {
    const party = await Party.findOne({ mobileNo: new RegExp(`${mobileNumber}$`) });
    if (party) return party;
  }

  if (partyName) {
    const party = await Party.findOne({ partyName: { $regex: `^${partyName}$`, $options: 'i' } });
    if (party) return party;
  }

  return null;
};

// Add Bill
exports.addBill = async (req, res) => {
  try {
    const { partyId, vehicleNumber, billDate, billAmount, remark, receiveAmount = 0, billNo } = req.body;

    // Check if Party exists
    const party = await Party.findById(partyId);
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }

    // Auto generate bill number
    const lastBill = await Bill.findOne().sort({ createdAt: -1 });
    let newBillNo = billNo?.trim();
    if (newBillNo) {
      const existingBill = await Bill.findOne({ billNo: newBillNo });
      if (existingBill) {
        return res.status(400).json({ message: 'Bill number already exists' });
      }
    } else {
      newBillNo = await getNextBillNo();
    }
    if (lastBill && lastBill.billNo) {
      const match = lastBill.billNo.match(/BILL-(\d+)/);
      if (match) {
        const lastNum = parseInt(match[1]);
        newBillNo = `BILL-${lastNum + 1}`;
      }
    }

    const paidAmount = parseFloat(receiveAmount) || 0;
    const pendingAmount = parseFloat(billAmount) - paidAmount;

    const bill = new Bill({
      billNo: newBillNo,
      partyId,
      vehicleNumber,
      billDate: billDate || new Date(),
      billAmount,
      paidAmount,
      pendingAmount,
      remark
    });

    await bill.save();
    
    // If receive amount > 0, create a payment record
    if (paidAmount > 0) {
      const Payment = require('../moduls/payment');
      const payment = new Payment({
        partyId,
        billId: bill._id,
        amount: paidAmount,
        paymentDate: billDate || new Date(),
        paymentMode: 'Cash',
        remark: `Payment against bill ${newBillNo}`
      });
      await payment.save();
    }

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
    
    // Find parties that match the search query (name or mobile)
    let partyIds = [];
    if (search) {
      const matchingParties = await Party.find({
        $or: [
          { partyName: { $regex: search, $options: 'i' } },
          { mobileNo: { $regex: search, $options: 'i' } }
        ]
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

exports.importCsv = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'CSV file is required' });
    }

    const csvText = file.buffer.toString('utf-8');
    const rows = parseCsv(csvText);

    if (!rows.length) {
      return res.status(400).json({ message: 'CSV file is empty or invalid' });
    }

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 2;

      const party = await findPartyFromRow(row);
      if (!party) {
        return res.status(400).json({ message: `Row ${rowNumber}: Party not found. Include partyId, partyName, or mobileNo.` });
      }

      const billAmount = parseFloat(row.billamount || row.amount || '');
      if (Number.isNaN(billAmount)) {
        return res.status(400).json({ message: `Row ${rowNumber}: Invalid bill amount.` });
      }

      const receiveAmount = parseFloat(row.receiveamount || row.paidamount || '0') || 0;
      const billDateValue = row.billdate || row['bill date'] || '';
      const billDate = billDateValue ? new Date(billDateValue) : new Date();
      if (billDateValue && Number.isNaN(billDate.getTime())) {
        return res.status(400).json({ message: `Row ${rowNumber}: Invalid bill date.` });
      }

      let rowBillNo = row.billno || row['bill no'] || '';
      rowBillNo = rowBillNo.trim();
      if (rowBillNo) {
        const duplicate = await Bill.findOne({ billNo: rowBillNo });
        if (duplicate) {
          return res.status(400).json({ message: `Row ${rowNumber}: Bill number ${rowBillNo} already exists.` });
        }
      } else {
        rowBillNo = await getNextBillNo();
      }

      const bill = new Bill({
        billNo: rowBillNo,
        partyId: party._id,
        vehicleNumber: row.vehiclenumber || row['vehicle number'] || row.vehicle || '',
        billDate,
        billAmount,
        paidAmount: receiveAmount,
        pendingAmount: billAmount - receiveAmount,
        remark: row.remark || '',
      });

      await bill.save();

      if (receiveAmount > 0) {
        const Payment = require('../moduls/payment');
        const payment = new Payment({
          partyId: party._id,
          billId: bill._id,
          amount: receiveAmount,
          paymentDate: billDate,
          paymentMode: 'Cash',
          remark: `Payment against bill ${rowBillNo}`,
        });
        await payment.save();
      }

      await recalculatePartyBills(party._id);
    }

    return res.status(200).json({ message: `Imported ${rows.length} bills successfully.` });
  } catch (error) {
    console.error('Error in importCsv:', error);
    return res.status(400).json({ message: error.message });
  }
};

exports.exportCsv = async (req, res) => {
  try {
    const bills = await Bill.find().populate('partyId', 'partyName mobileNo');
    const lines = [
      ['Bill No', 'Party Name', 'Mobile Number', 'Vehicle Number', 'Bill Date', 'Bill Amount', 'Paid Amount', 'Pending Amount', 'Remark'],
      ...bills.map((bill) => [
        bill.billNo,
        bill.partyId ? bill.partyId.partyName : '',
        bill.partyId ? bill.partyId.mobileNo : '',
        bill.vehicleNumber || '',
        bill.billDate ? new Date(bill.billDate).toISOString().split('T')[0] : '',
        bill.billAmount ?? '',
        bill.paidAmount ?? '',
        bill.pendingAmount ?? '',
        bill.remark ?? '',
      ]),
    ];

    const csvContent = lines
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell ?? '').replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(',')
      )
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bills.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Error in exportCsv:', error);
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
