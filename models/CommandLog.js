const mongoose = require('mongoose');

const commandLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  command: String,
  groupId: String,
  groupName: String,
  executedAt: { type: Date, default: Date.now },
  success: Boolean,
  response: String
});

module.exports = mongoose.model('CommandLog', commandLogSchema);
