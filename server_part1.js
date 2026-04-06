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
const cheerio = require('cheerio');
const FormData = require('form-data');
const ytdl = require('@distube/ytdl-core');
const { pipeline } = require('stream/promises');
require('dotenv').config();

const User = require('./models/User');
const { commands, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, reply } = require('./commands');

const app = express();
const activeSessions = new Map();

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

async function handleAIResponse(prompt, context = 'general') {
  try {
    let systemPrompt = 'You are a helpful assistant.';

    if (context === 'dm_conversation') {
      systemPrompt = `You are Wiz AI Pro, a friendly WhatsApp bot assistant. The owner is currently offline.
Respond in a casual, warm Nigerian Pidgin English style like "I dey, how your side?" or "Wetin dey happen?".
Be conversational, use emojis, and let them know the owner will reply soon. Keep responses short and friendly.`;
    }

    const response = await axios.post(process.env.DEEPSEEK_API_URL, {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content;
  } catch (err) {
    return 'AI service unavailable. Please try again later.';
  }
}

async function sendWelcomeMessage(sock, userId, phoneNumber) {
  try {
    let cleanPhone = phoneNumber.toString().replace(/\D/g, '');

    console.log(`[${userId}] Sending welcome to phone:`, cleanPhone);
    console.log(`[${userId}] Socket user ID:`, sock.user?.id);

    const jid = `${cleanPhone}@s.whatsapp.net`;

    const welcomeText = `╔═══════════════════════════╗
║  🤖 *WIZ AI PRO* 🤖        ║
║  ⚡ *PREMIUM EDITION* ⚡    ║
╚═══════════════════════════╝

🎉 *Bot Activated Successfully!*

👑 *Owner:* WISDOM
📱 *Number:* ${cleanPhone}
⏰ *Time:* ${new Date().toLocaleString()}
🌟 *Status:* ONLINE ✅

╔═══════════════════════════╗
║  📊 *BOT STATISTICS*       ║
╠═══════════════════════════╣
║  • 200+ Commands          ║
║  • 9 Categories           ║
║  • AI-Powered             ║
║  • 24/7 Online            ║
╚═══════════════════════════╝

✨ *FEATURE CATEGORIES:*

👥 *Group Management* (19 cmds)
🛡️ *Moderation* (8 cmds)
🤖 *AI & Smart Tools* (7 cmds)
💰 *Economy System* (8 cmds)
🎮 *Games* (6 cmds)
😂 *Fun* (10 cmds)
🛠️ *Utility* (12 cmds)
📺 *Media Download* (17 cmds)
👑 *Owner Only* (5 cmds)

🚀 *QUICK START:*
Type *.menu* - See all commands
Type *.help* - Command details
Type *.ping* - Check status

📢 *Join our Channel:*
https://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17

⚡ _Powered by Wiz AI Pro v2.0_
🤖 _Your Ultimate WhatsApp Assistant_`;

    await sock.sendMessage(jid, { text: welcomeText });
    console.log(`[${userId}] ✅ Welcome sent to ${jid}`);

  } catch (err) {
    console.error(`[${userId}] Welcome failed:`, err.message);
    console.error(`[${userId}] Error stack:`, err.stack);
  }
}

module.exports = { app, activeSessions, authMiddleware, logger, handleAIResponse, sendWelcomeMessage };
