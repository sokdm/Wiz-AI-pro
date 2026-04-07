const { app, activeSessions, authMiddleware, activeSockets } = require('./server_part1');
const { createWhatsAppSession } = require('./server_part3');
const User = require('./models/User');
const { commands } = require('./commands');
const jwt = require('jsonwebtoken');
const axios = require('axios');

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const user = new User({
      username,
      email,
      password,
      botSettings: {
        autoReply: true,
        welcomeMessage: true,
        antiDelete: false,
        autoRead: true,
        aiMode: true
      }
    });
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

// ==================== WHATSAPP ROUTES ====================

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

// ==================== DASHBOARD ROUTES ====================

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

// ==================== HEALTH CHECK (Keep-Alive) ====================

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    bot: 'Wiz AI Pro',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    activeSessions: activeSockets.size
  });
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 8090;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║     🤖 WIZ AI PRO SERVER 🤖        ║
║                                    ║
║  ✅ Server running on port ${PORT}     ║
║  📱 WhatsApp Bot Ready             ║
║  🌐 API Endpoints Active           ║
║  🔄 Auto-Reconnect Enabled         ║
║  💓 Keep-Alive Enabled             ║
║                                    ║
║  👑 Created by: WISDOM             ║
╚════════════════════════════════════╝
  `);
  
  // Self-ping to prevent Render idle timeout
  if (process.env.RENDER_EXTERNAL_URL) {
    const selfUrl = process.env.RENDER_EXTERNAL_URL + '/health';
    setInterval(async () => {
      try {
        await axios.get(selfUrl, { timeout: 30000 });
        console.log(`[KeepAlive] Self-ping success at ${new Date().toISOString()}`);
      } catch (err) {
        console.error(`[KeepAlive] Self-ping failed: ${err.message}`);
      }
    }, 10 * 60 * 1000); // Every 10 minutes
    
    console.log(`✅ Self-ping started: ${selfUrl}`);
  }
});

module.exports = {};
