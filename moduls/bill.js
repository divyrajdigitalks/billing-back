const mongoose = require('mongoose');

const billSchema = new mongoose.Schema({
  billNo: {
    type: String,
    required: true,
    unique: true
  },
  partyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Party',
    required: [true, 'Party is required']
  },
  vehicleNumber: {
    type: String,
    trim: true
  },
  billDate: {
    type: Date,
    required: [true, 'Bill date is required'],
    default: Date.now
  },
  billAmount: {
    type: Number,
    required: [true, 'Bill amount is required'],
    min: [0, 'Bill amount cannot be negative']
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  pendingAmount: {
    type: Number,
    default: function() {
      return this.billAmount - this.paidAmount;
    }
  },
  remark: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

billSchema.pre('save', function() {
  this.pendingAmount = this.billAmount - this.paidAmount;
});

module.exports = mongoose.model('Bill', billSchema);
