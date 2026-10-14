const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  whatsappNumber: { type: String, required: true, unique: true },
  userName: { type: String, default: 'Sayang' },        // What AI calls the user
  aiName: { type: String, default: 'Fixo dev' },        // AI's own name
  userGender: { type: String, enum: ['male', 'female'], default: 'male' },
  aiGender: { type: String, enum: ['male', 'female'], default: 'female' },
  language: { type: String, enum: ['sinhala', 'english', 'both'], default: 'both' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }
});

const chatHistorySchema = new mongoose.Schema({
  whatsappNumber: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const statusSeenSchema = new mongoose.Schema({
  statusId: { type: String, required: true, unique: true },
  senderNumber: { type: String, required: true },
  content: { type: String },
  seenAt: { type: Date, default: Date.now },
  replied: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);
const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);
const StatusSeen = mongoose.model('StatusSeen', statusSeenSchema);

module.exports = { User, ChatHistory, StatusSeen };