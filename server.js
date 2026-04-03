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

async function handleAIResponse(prompt) {
  try {
    const response = await axios.post(process.env.DEEPSEEK_API_URL, {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
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

async function sendWelcomeMessage(sock, userId) {
  try {
    let botNumber;
    if (sock.user.id.includes('@')) {
      botNumber = sock.user.id.split('@')[0];
    } else if (sock.user.id.includes(':')) {
      botNumber = sock.user.id.split(':')[0];
    } else {
      botNumber = sock.user.id;
    }
    botNumber = botNumber.replace(/:\d+$/, '');
    const jid = `${botNumber}@s.whatsapp.net`;
    
    const welcomeText = `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🤖 *WIZ AI PRO* 🤖
┃   ✨ Activated ✨
╚═══❖•ೋ° °ೋ•❖═══╝

👑 *Creator:* WISDOM
📱 *Number:* ${botNumber}
⏰ *Time:* ${new Date().toLocaleString()}
🌟 *Status:* ONLINE

✨ *Features Unlocked:*
• 50+ Powerful Commands
• AI Auto-Response
• Group Management
• Media Downloads
• Anti-Delete & More!

📢 *Join our Channel:*
https://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17

Type *.help* to see all commands!

⚡ _Powered by Wiz AI Pro_`;

    await sock.sendMessage(jid, { text: welcomeText });
    console.log(`[${userId}] ✅ Welcome sent to ${jid}`);
  } catch (err) {
    console.error(`[${userId}] Welcome failed:`, err.message);
  }
}
function setupMessageHandler(sock, sessionId, userId) {
  console.log(`[${sessionId}] Setting up handlers...`);
  
  sock.ev.on('messages.upsert', async (m) => {
    console.log(`[${sessionId}] Message received!`);
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const messageText = msg.message.conversation ||
                       msg.message.extendedTextMessage?.text || '';
    const remoteJid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    try {
      const user = await User.findById(userId);
      if (!user) return;

      if (user.botSettings.autoRead) {
        await sock.readMessages([msg.key]);
      }

      if (messageText.startsWith('.')) {
        const args = messageText.slice(1).trim().split(' ');
        const cmd = args.shift().toLowerCase();

        console.log(`[${sessionId}] Command: ${cmd}`);

        if (commands[cmd]) {
          try {
            const result = await commands[cmd].handler(sock, msg, args, user);
            if (result) {
              await reply(sock, remoteJid, result, msg);
            }
            user.stats.commandsUsed += 1;
            await user.save();
          } catch (err) {
            console.error(`Command ${cmd} error:`, err);
            await reply(sock, remoteJid, '❌ Command failed: ' + err.message, msg);
          }
        } else {
          await reply(sock, remoteJid, '❌ Unknown command. Type .help for commands.', msg);
        }
      }

      if (user.botSettings.aiMode && !remoteJid.endsWith('@g.us') && !messageText.startsWith('.')) {
        console.log(`[${sessionId}] AI responding to DM`);
        const aiResponse = await handleAIResponse(messageText);
        await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
      }

      if (user.botSettings.aiMode && remoteJid.endsWith('@g.us') && 
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id) &&
          !messageText.startsWith('.')) {
        const aiResponse = await handleAIResponse(messageText.replace(/@\d+/g, '').trim());
        await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
      }

      if (antilinkGroups.has(remoteJid) && messageText.includes('http')) {
        const groupMeta = await getGroupMetadata(sock, remoteJid);
        const isSenderAdmin = groupMeta?.participants.find(p => p.id === sender)?.admin;
        if (!isSenderAdmin) {
          await sock.sendMessage(remoteJid, { delete: msg.key });
          await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} Links not allowed!`, msg);
        }
      }
    } catch (err) {
      console.error('Handler error:', err);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;

    if (action === 'add' && welcomeGroups.has(id)) {
      for (const participant of participants) {
        const welcomeMsg = `👋 Welcome @${participant.split('@')[0]}! 🎉\n\nType *.help* to see what I can do!`;
        await sock.sendMessage(id, { text: welcomeMsg, mentions: [participant] });
      }
    }

    if (action === 'remove' && goodbyeGroups.has(id)) {
      for (const participant of participants) {
        const goodbyeMsg = `👋 Goodbye @${participant.split('@')[0]}! We'll miss you.`;
        await sock.sendMessage(id, { text: goodbyeMsg, mentions: [participant] });
      }
    }
  });
}
async function createWhatsAppSession(userId, phoneNumber, res) {
  const sessionId = `wiz_${userId}_${Date.now()}`;
  const sessionDir = `./sessions/${sessionId}`;

  try {
    const existingSession = Array.from(activeSessions.values()).find(s => s.userId === userId);
    if (existingSession) {
      try {
        await existingSession.sock.logout();
      } catch (e) {}
      activeSessions.delete(existingSession.sessionId);
      try {
        await fs.remove(`./sessions/${existingSession.sessionId}`);
      } catch (e) {}
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      printQRInTerminal: false,
      browser: Browsers.macOS('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      emitOwnEvents: true,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      retryRequestDelayMs: 5000,
      maxMsgRetryCount: 5,
      fireInitQueries: true,
      shouldIgnoreJid: jid => jid?.includes('broadcast'),
      getMessage: async () => undefined
    });

    const sessionData = {
      sock,
      userId,
      phoneNumber,
      status: 'connecting',
      pairingCode: null,
      qrCode: null,
      qrCount: 0,
      reconnectAttempts: 0,
      pairingRequested: false,
      sessionId: sessionId,
      isReconnecting: false
    };

    activeSessions.set(sessionId, sessionData);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const error = lastDisconnect?.error;

      if (qr && !sessionData.pairingRequested && !state.creds.registered) {
        try {
          const qrData = await QRCode.toDataURL(qr, {
            width: 400,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#ffffff'
            }
          });

          sessionData.qrCode = qrData;
          sessionData.qrCount++;
          sessionData.status = 'qr_ready';

          console.log(`[${sessionId}] QR Code #${sessionData.qrCount} generated`);

          if (phoneNumber) {
            sessionData.pairingRequested = true;
            console.log(`[${sessionId}] Requesting pairing code in 5s...`);
            
            setTimeout(async () => {
              try {
                await requestPairingCode(sock, sessionData, phoneNumber);
              } catch (err) {
                console.log(`[${sessionId}] Pairing code failed`);
              }
            }, 5000);
          }
        } catch (e) {
          console.error('QR Error:', e);
        }
      }

      if (connection === 'open') {
        console.log(`[${sessionId}] ✅ Connected!`);
        sessionData.status = 'connected';
        sessionData.reconnectAttempts = 0;
        sessionData.isReconnecting = false;

        await User.findByIdAndUpdate(userId, {
          'whatsappSession.sessionId': sessionId,
          'whatsappSession.connected': true,
          'whatsappSession.phone': phoneNumber,
          'whatsappSession.connectedAt': new Date()
        });

        await sendWelcomeMessage(sock, userId);
        setupMessageHandler(sock, sessionId, userId);

      } else if (connection === 'close') {
        const statusCode = error?.output?.statusCode;
        console.log(`[${sessionId}] Closed. Code: ${statusCode}`);

        sessionData.status = 'disconnected';
        await User.findByIdAndUpdate(userId, {
          'whatsappSession.connected': false
        });

        if (statusCode === 515) {
          console.log(`[${sessionId}] Got 515 - recreating...`);
          
          setTimeout(async () => {
            try {
              const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(sessionDir);
              
              const newSock = makeWASocket({
                version,
                logger,
                auth: {
                  creds: newState.creds,
                  keys: makeCacheableSignalKeyStore(newState.keys, logger)
                },
                printQRInTerminal: false,
                browser: Browsers.macOS('Chrome'),
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 25000,
                markOnlineOnConnect: true,
                syncFullHistory: false
              });

              sessionData.sock = newSock;
              sessionData.status = 'connecting';
              sessionData.isReconnecting = true;
              
              newSock.ev.on('creds.update', newSaveCreds);
              
              newSock.ev.on('connection.update', async (newUpdate) => {
                const { connection: newConn } = newUpdate;
                
                if (newConn === 'open') {
                  console.log(`[${sessionId}] ✅ Reconnected!`);
                  sessionData.status = 'connected';
                  await User.findByIdAndUpdate(userId, {
                    'whatsappSession.connected': true
                  });
                  setupMessageHandler(newSock, sessionId, userId);
                  
                } else if (newConn === 'close') {
                  const newCode = newUpdate.lastDisconnect?.error?.output?.statusCode;
                  if (newCode === DisconnectReason.loggedOut) {
                    activeSessions.delete(sessionId);
                    await fs.remove(sessionDir);
                  }
                }
              });

            } catch (err) {
              console.error(`[${sessionId}] Recreate failed:`, err.message);
            }
          }, 3000);
          return;
        }

        if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
          try {
            await fs.remove(sessionDir);
          } catch (e) {}
          activeSessions.delete(sessionId);
        }

      } else if (connection === 'connecting') {
        console.log(`[${sessionId}] Connecting...`);
        sessionData.status = 'connecting';
      }
    });

    sock.ev.on('creds.update', saveCreds);

    res.json({
      sessionId,
      status: 'initializing',
      message: 'WhatsApp session initializing...'
    });

  } catch (err) {
    console.error('Session creation error:', err);
    res.status(500).json({ error: 'Failed to create session: ' + err.message });
  }
}

async function requestPairingCode(sock, sessionData, phoneNumber) {
  try {
    let cleanPhone = phoneNumber.toString().replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.substring(1);
    }
    if (!cleanPhone.startsWith('234') && cleanPhone.length === 10) {
      cleanPhone = '234' + cleanPhone;
    }
    if (cleanPhone.length < 12 || cleanPhone.length > 15) {
      console.log(`[${sessionData.userId}] Invalid phone:`, cleanPhone);
      return;
    }

    console.log(`[${sessionData.userId}] Requesting pairing code for:`, cleanPhone);
    const code = await sock.requestPairingCode(cleanPhone);

    if (code && code.length >= 6) {
      sessionData.pairingCode = code;
      console.log(`[${sessionData.userId}] ✅ Pairing code:`, code);
    } else {
      console.log(`[${sessionData.userId}] Invalid code:`, code);
    }
  } catch (err) {
    console.log(`[${sessionData.userId}] ❌ Pairing error:`, err.message);
    sessionData.pairingRequested = false;
    throw err;
  }
}
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const user = new User({ username, email, password });
    await user.save();
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, username, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found' });
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid password' });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        whatsappSession: user.whatsappSession,
        botSettings: user.botSettings
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      phoneNumber: req.user.phoneNumber,
      whatsappSession: req.user.whatsappSession,
      botSettings: req.user.botSettings,
      stats: req.user.stats,
      subscription: req.user.subscription
    }
  });
});

app.post('/api/whatsapp/pair', authMiddleware, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber || phoneNumber.length < 10) {
      return res.status(400).json({ error: 'Valid phone number required' });
    }
    await createWhatsAppSession(req.user._id, phoneNumber, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/status/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    if (!session) {
      const user = await User.findById(req.user._id);
      return res.json({
        status: user.whatsappSession?.connected ? 'connected' : 'disconnected',
        connected: user.whatsappSession?.connected || false,
        phone: user.whatsappSession?.phone
      });
    }
    res.json({
      status: session.status,
      phone: session.phoneNumber,
      pairingCode: session.pairingCode,
      qrCode: session.qrCode,
      connected: session.status === 'connected'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/disconnect', authMiddleware, async (req, res) => {
  try {
    const session = activeSessions.get(req.user.whatsappSession?.sessionId);
    if (session) {
      try {
        await session.sock.logout();
      } catch (e) {}
      activeSessions.delete(req.user.whatsappSession.sessionId);
    }
    await User.findByIdAndUpdate(req.user._id, {
      'whatsappSession.connected': false,
      'whatsappSession.sessionId': null
    });
    res.json({ message: 'Disconnected successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/settings', authMiddleware, async (req, res) => {
  try {
    const { autoReply, welcomeMessage, antiDelete, autoRead, aiMode } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      'botSettings.autoReply': autoReply,
      'botSettings.welcomeMessage': welcomeMessage,
      'botSettings.antiDelete': antiDelete,
      'botSettings.autoRead': autoRead,
      'botSettings.aiMode': aiMode
    });
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      stats: user.stats,
      commands: Object.keys(commands).length,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: process.platform
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/commands', authMiddleware, (req, res) => {
  const commandList = Object.entries(commands).map(([name, cmd]) => ({
    name,
    category: cmd.category,
    adminOnly: cmd.adminOnly || false,
    ownerOnly: cmd.ownerOnly || false
  }));
  res.json({ commands: commandList });
});

app.get('/api/servers', authMiddleware, (req, res) => {
  res.json({
    servers: [
      { id: 'ng-1', name: 'Nigeria Server 1', location: 'Lagos', status: 'online', ping: '15ms' },
      { id: 'ng-2', name: 'Nigeria Server 2', location: 'Abuja', status: 'online', ping: '22ms' },
      { id: 'global-1', name: 'Global Server', location: 'Europe', status: 'online', ping: '120ms' }
    ],
    current: 'ng-1'
  });
});

const PORT = process.env.PORT || 8090;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║     🤖 WIZ AI PRO SERVER 🤖        ║
║                                    ║
║  ✅ Server running on port ${PORT}     ║
║  📱 WhatsApp Bot Ready            ║
║  🌐 API Endpoints Active          ║
║                                    ║
║  👑 Created by: WISDOM            ║
╚════════════════════════════════════╝
  `);
});
