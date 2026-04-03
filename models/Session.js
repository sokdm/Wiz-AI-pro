const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true, unique: true },
  phoneNumber: { type: String },
  status: { type: String, enum: ['connecting', 'connected', 'disconnected'], default: 'connecting' },
  pairingCode: String,
  qrCode: String,
  sockData: Object,
  lastActivity: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Session', sessionSchema);
