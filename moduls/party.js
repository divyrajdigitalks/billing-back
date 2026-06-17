const mongoose = require('mongoose');

const partySchema = new mongoose.Schema({
  partyName: {
    type: String,
    required: [true, 'Party name is required'],
    trim: true
  },
  mobileNo: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  vehicleNumbers: {
    type: [String],
    default: []
  },
  remark: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Party', partySchema);
