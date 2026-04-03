const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phoneNumber: { type: String },
  isActive: { type: Boolean, default: true },
  subscription: {
    plan: { type: String, enum: ['free', 'basic', 'pro', 'enterprise'], default: 'free' },
    expiresAt: { type: Date }
  },
  whatsappSession: {
    sessionId: String,
    connected: { type: Boolean, default: false },
    phone: String,
    connectedAt: Date
  },
  botSettings: {
    autoReply: { type: Boolean, default: false },
    welcomeMessage: { type: Boolean, default: true },
    antiDelete: { type: Boolean, default: false },
    autoRead: { type: Boolean, default: true },
    aiMode: { type: Boolean, default: false }
  },
  stats: {
    messagesProcessed: { type: Number, default: 0 },
    commandsUsed: { type: Number, default: 0 },
    groupsManaged: { type: Number, default: 0 }
  }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
