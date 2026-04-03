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
    // Format phone number properly
    let cleanPhone = phoneNumber.toString().replace(/\D/g, '');
    
    console.log(`[${userId}] Sending welcome to phone:`, cleanPhone);
    console.log(`[${userId}] Socket user ID:`, sock.user?.id);
    
    // Try multiple formats
    const jid = `${cleanPhone}@s.whatsapp.net`;
    
    const welcomeText = `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🤖 *WIZ AI PRO* 🤖
┃   ✨ Activated ✨
╚═══❖•ೋ° °ೋ•❖═══╝

🎉 *Congratulations!* Your WhatsApp bot is now connected!

👑 *Owner:* WISDOM
📱 *Number:* ${cleanPhone}
⏰ *Time:* ${new Date().toLocaleString()}
🌟 *Status:* ONLINE

✨ *Your Bot Features:*
• 50+ Powerful Commands
• AI Auto-Response (when you're offline)
• Group Management
• Media Downloads
• Anti-Delete & More!

📢 *Join our Channel for Updates:*
https://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17

Type *.help* to see all commands!

⚡ _Powered by Wiz AI Pro_`;

    // Send to the owner's number
    await sock.sendMessage(jid, { text: welcomeText });
    console.log(`[${userId}] ✅ Welcome sent to ${jid}`);
    
    // Also try sending to the bot's own number as fallback
    if (sock.user?.id) {
      const botJid = sock.user.id;
      await sock.sendMessage(botJid, { text: welcomeText });
      console.log(`[${userId}] ✅ Welcome also sent to bot ${botJid}`);
    }
  } catch (err) {
    console.error(`[${userId}] Welcome failed:`, err.message);
    console.error(`[${userId}] Error stack:`, err.stack);
  }
}

module.exports = { app, activeSessions, authMiddleware, logger, handleAIResponse, sendWelcomeMessage };
