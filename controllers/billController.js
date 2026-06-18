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

const parseDateFlexible = (value) => {
  if (!value) return null;
  // Try native parse first
  let d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;

  // Try dd-mm-yyyy or dd/mm/yyyy
  const m = String(value).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    let year = m[3];
    if (year.length === 2) year = '20' + year;
    const iso = `${year}-${month}-${day}`;
    d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Try replacing slashes with dashes and parse again
  d = new Date(String(value).replace(/\//g, '-'));
  if (!Number.isNaN(d.getTime())) return d;

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

    // Auto generate or validate bill number
    let newBillNo = billNo?.trim();
    if (newBillNo) {
      const existingBill = await Bill.findOne({ billNo: newBillNo });
      if (existingBill) {
        return res.status(400).json({ message: 'Bill number already exists' });
      }
    } else {
      newBillNo = await getNextBillNo();
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
    const { search = '', page = 1, limit = 10, startDate = '', endDate = '', status = '' } = req.query;
    console.log('getBills req.query:', req.query);

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
    
    // Search filter
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

    // Date range filter
    if (startDate || endDate) {
      query.billDate = {};
      if (startDate) {
        // Create date from YYYY-MM-DD and set to start of day in local timezone
        const [year, month, day] = startDate.split('-').map(Number);
        const startDateObj = new Date(year, month - 1, day, 0, 0, 0, 0);
        console.log('startDate:', startDate, 'startDateObj:', startDateObj);
        query.billDate.$gte = startDateObj;
      }
      if (endDate) {
        // Create date from YYYY-MM-DD and set to end of day in local timezone
        const [year, month, day] = endDate.split('-').map(Number);
        const endDateObj = new Date(year, month - 1, day, 23, 59, 59, 999);
        console.log('endDate:', endDate, 'endDateObj:', endDateObj);
        query.billDate.$lte = endDateObj;
      }
    }

    // Status filter
    if (status) {
      console.log('status:', status);
      if (status === 'pending') {
        query.pendingAmount = { $gt: 0 };
      } else if (status === 'done') {
        query.pendingAmount = { $lte: 0 };
      }
    }
    
    console.log('getBills query:', query);

    const total = await Bill.countDocuments(query);
    const bills = await Bill.find(query)
      .populate('partyId', 'partyName mobileNo vehicleNumbers')
      .sort({ billDate: -1, createdAt: -1 }) // Sort by billDate descending, then createdAt descending
      .skip(skip)
      .limit(parseInt(limit));
    
    console.log('Found bills count:', bills.length);
    if (bills.length > 0) {
      console.log('First bill billDate:', bills[0].billDate, 'typeof:', typeof bills[0].billDate);
    }

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
      let resolvedParty = party;
      if (!resolvedParty) {
        // Try to create party automatically if partyName and mobile number present
        const partyName = row.partyname;
        const mobileDigits = row.mobilenumber?.replace(/\D/g, '');
        if (partyName && mobileDigits && mobileDigits.length >= 10) {
          const normalizedMobile = mobileDigits.length === 10 ? `+91${mobileDigits}` : `+${mobileDigits}`;
          const newParty = new Party({ partyName: partyName.trim(), mobileNo: normalizedMobile, address: row.address || '', vehicleNumbers: row.vehiclenumbers ? (Array.isArray(row.vehiclenumbers) ? row.vehiclenumbers : [row.vehiclenumbers]) : [] , remark: row.remark || '' });
          await newParty.save();
          resolvedParty = newParty;
        } else {
          return res.status(400).json({ message: `Row ${rowNumber}: Party not found. Include partyId, partyName, and mobileNo (10 digits) to auto-create.` });
        }
      }

      const billAmount = parseFloat(row.billamount || row.amount || '');
      if (Number.isNaN(billAmount)) {
        return res.status(400).json({ message: `Row ${rowNumber}: Invalid bill amount.` });
      }

      const receiveAmount = parseFloat(row.receiveamount || row.paidamount || '0') || 0;
      const billDateValue = row.billdate || row['bill date'] || '';
      let billDate = new Date();
      if (billDateValue) {
        const parsed = parseDateFlexible(billDateValue);
        if (!parsed) {
          return res.status(400).json({ message: `Row ${rowNumber}: Invalid bill date. Accepted formats: YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY.` });
        }
        billDate = parsed;
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
        partyId: resolvedParty._id,
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
          partyId: resolvedParty._id,
          billId: bill._id,
          amount: receiveAmount,
          paymentDate: billDate,
          paymentMode: 'Cash',
          remark: `Payment against bill ${rowBillNo}`,
        });
        await payment.save();
      }

      await recalculatePartyBills(resolvedParty._id);
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
