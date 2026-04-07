const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore, downloadMediaMessage } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs-extra');
const pino = require('pino');
const axios = require('axios');
require('dotenv').config();

const User = require('./models/User');
const { commands, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, reply } = require('./commands');

const app = express();
const activeSessions = new Map();

// Store active sockets for monitoring
const activeSockets = new Map();

// ==================== MIDDLEWARE SETUP ====================

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const logger = pino({ level: 'silent' });

// ==================== AI RESPONSE HANDLER ====================

async function handleAIResponse(prompt, context = 'general', ownerName = 'Wisdom') {
  try {
    let systemPrompt = 'You are a helpful assistant.';

    if (context === 'dm_conversation') {
      systemPrompt = `You are Wiz AI Pro, a friendly WhatsApp bot assistant. The owner ${ownerName} is currently offline.
Respond in a casual, warm Nigerian Pidgin English style like "I dey, how your side?" or "Wetin dey happen?".
Be conversational, use emojis, and let them know ${ownerName} will reply soon. Keep responses short and friendly.
NEVER use markdown asterisks (*) or formatting. Write naturally.`;
    }

    const response = await axios.post(process.env.DEEPSEEK_API_URL, {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2000,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let text = response.data.choices[0].message.content;
    text = text.replace(/\*\*/g, '').replace(/\*/g, '');
    text = text.replace(/_/g, '');
    text = text.replace(/```/g, '');

    return text;
  } catch (err) {
    return 'AI service unavailable. Please try again later.';
  }
}

// ==================== MESSAGE STREAMING ====================

async function sendStreamResponse(sock, remoteJid, text, quotedMsg) {
  const MAX_LENGTH = 4000;

  if (text.length <= MAX_LENGTH) {
    await sock.sendMessage(remoteJid, { text: text }, { quoted: quotedMsg });
    return;
  }

  const chunks = [];
  let currentChunk = '';
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > MAX_LENGTH) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());

  for (let i = 0; i < chunks.length; i++) {
    await sock.sendMessage(remoteJid, {
      text: chunks[i] + (i < chunks.length - 1 ? '\n\n...' : '')
    }, i === 0 ? { quoted: quotedMsg } : {});

    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}

// ==================== WELCOME MESSAGE ====================

async function sendWelcomeMessage(sock, userId, phoneNumber) {
  try {
    let cleanPhone = phoneNumber.toString().replace(/\D/g, '');
    console.log(`[${userId}] Sending welcome to phone:`, cleanPhone);
    console.log(`[${userId}] Socket user ID:`, sock.user?.id);

    const jid = `${cleanPhone}@s.whatsapp.net`;

    const welcomeText = `╔═══════════════════════════╗
║  🤖 WIZ AI PRO 🤖         ║
║  ⚡ PREMIUM EDITION ⚡     ║
╚═══════════════════════════╝

🎉 Bot Activated Successfully!

👑 Owner: WISDOM
📱 Number: ${cleanPhone}
⏰ Time: ${new Date().toLocaleString()}
🌟 Status: ONLINE ✅

╔═══════════════════════════╗
║  📊 BOT STATISTICS        ║
╠═══════════════════════════╣
║  • 250+ Commands          ║
║  • 10 Categories          ║
║  • AI-Powered             ║
║  • Smart Auto-Reply       ║
║  • 24/7 Online            ║
╚═══════════════════════════╝

✨ CATEGORIES:
👥 Group | 🛡️ Mod | 🤖 AI
💰 Economy | 🎮 Games | 😂 Fun
🛠️ Utility | 📺 Media | 👑 Owner

🚀 QUICK START:
.menu - All commands
.help - Command details
.ping - Check status

📢 Channel: https://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17

⚡ Powered by Wiz AI Pro v3.0
🤖 Your Ultimate Assistant`;

    await sock.sendMessage(jid, { text: welcomeText });
    console.log(`[${userId}] ✅ Welcome sent to ${jid}`);

  } catch (err) {
    console.error(`[${userId}] Welcome failed:`, err.message);
  }
}

// ==================== SOCKET MONITORING ====================

function registerSocket(userId, socket) {
  activeSockets.set(userId, {
    socket,
    connectedAt: Date.now(),
    lastPing: Date.now()
  });
}

function unregisterSocket(userId) {
  activeSockets.delete(userId);
}

// ==================== EXPORTS ====================

module.exports = { 
  app, 
  activeSessions, 
  authMiddleware, 
  logger, 
  handleAIResponse, 
  sendStreamResponse, 
  sendWelcomeMessage,
  registerSocket,
  unregisterSocket,
  activeSockets
};
