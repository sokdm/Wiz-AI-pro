const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore, makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const User = require('./models/User');
const { sendWelcomeMessage, activeSessions, logger } = require('./server_part1');
const { setupMessageHandler } = require('./server_part2');

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
      return null;
    }

    console.log(`[${sessionData.userId}] Requesting pairing code for:`, cleanPhone);

    const code = await sock.requestPairingCode(cleanPhone);

    if (code && code.length >= 6) {
      sessionData.pairingCode = code;
      console.log(`[${sessionData.userId}] ✅ Pairing code:`, code);
      console.log(`[${sessionData.userId}] ⏳ Enter this code in WhatsApp NOW!`);
      return code;
    } else {
      console.log(`[${sessionData.userId}] Invalid code:`, code);
      return null;
    }
  } catch (err) {
    console.log(`[${sessionData.userId}] ❌ Pairing error:`, err.message);
    return null;
  }
}

async function createWhatsAppSession(userId, phoneNumber, res, isReconnect = false, existingSessionDir = null) {
  const sessionId = existingSessionDir ? existingSessionDir.split('/').pop() : `wiz_${userId}_${Date.now()}`;
  const sessionDir = existingSessionDir || `./sessions/${sessionId}`;
  let welcomeSent = false;
  let handlerSetup = false;
  let heartbeatInterval = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  try {
    if (!isReconnect) {
      const existingSession = Array.from(activeSessions.values()).find(s => s.userId === userId);
      if (existingSession) {
        console.log(`[${sessionId}] Cleaning up existing session...`);
        try {
          await existingSession.sock.logout();
        } catch (e) {}
        activeSessions.delete(existingSession.sessionId);
        try {
          await fs.remove(`./sessions/${existingSession.sessionId}`);
        } catch (e) {}
      }
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
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
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
      sessionId: sessionId,
      pairingRequested: false,
      hasConnected: false,
      sessionDir: sessionDir,
      heartbeatInterval: null
    };

    activeSessions.set(sessionId, sessionData);

    const clearTimers = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (sessionData.heartbeatInterval) {
        clearInterval(sessionData.heartbeatInterval);
        sessionData.heartbeatInterval = null;
      }
    };

    const startHeartbeat = () => {
      clearTimers();
      heartbeatInterval = setInterval(() => {
        if (sessionData.status === 'connected' && sock.ws?.readyState === 1) {
          console.log(`[${sessionId}] Heartbeat: Connection alive at ${new Date().toISOString()}`);
        } else if (sessionData.status !== 'connected') {
          clearTimers();
        }
      }, 60000);
      sessionData.heartbeatInterval = heartbeatInterval;
    };

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const error = lastDisconnect?.error;
      const statusCode = error?.output?.statusCode;

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

          if (phoneNumber && !sessionData.pairingRequested) {
            sessionData.pairingRequested = true;
            await requestPairingCode(sock, sessionData, phoneNumber);
          }
        } catch (e) {
          console.error('QR Error:', e);
        }
      }

      if (connection === 'open') {
        console.log(`[${sessionId}] ✅ Connected!`);
        sessionData.status = 'connected';
        sessionData.hasConnected = true;
        reconnectAttempts = 0;

        await User.findByIdAndUpdate(userId, {
          'whatsappSession.sessionId': sessionId,
          'whatsappSession.connected': true,
          'whatsappSession.phone': phoneNumber,
          'whatsappSession.connectedAt': new Date()
        });

        if (!welcomeSent) {
          await sendWelcomeMessage(sock, userId, phoneNumber);
          welcomeSent = true;
        }

        if (!handlerSetup) {
          setupMessageHandler(sock, sessionId, userId);
          handlerSetup = true;
          console.log(`[${sessionId}] Handler setup complete`);
        }

        startHeartbeat();
      } else if (connection === 'close') {
        console.log(`[${sessionId}] Closed. Code: ${statusCode}, Reason: ${DisconnectReason[statusCode] || 'unknown'}`);
        
        clearTimers();

        if (statusCode === 515) {
          console.log(`[${sessionId}] 🔄 Restart required, recreating connection...`);
          activeSessions.delete(sessionId);
          setTimeout(() => {
            console.log(`[${sessionId}] 🔄 Reconnecting with fresh socket...`);
            createWhatsAppSession(userId, phoneNumber, null, true, sessionDir).catch(err => {
              console.error(`[${sessionId}] Reconnect failed:`, err);
            });
          }, 2000);
          return;
        }

        sessionData.status = 'disconnected';
        await User.findByIdAndUpdate(userId, {
          'whatsappSession.connected': false
        });

        if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
          console.log(`[${sessionId}] Logged out`);
          activeSessions.delete(sessionId);
          try {
            await fs.remove(sessionDir);
          } catch (e) {}
          return;
        }

        if (statusCode === 408 || statusCode === DisconnectReason.timedOut) {
          console.log(`[${sessionId}] ⏰ Connection timeout, attempting reconnect...`);
          reconnectAttempts++;
          if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            setTimeout(() => {
              console.log(`[${sessionId}] 🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
              createWhatsAppSession(userId, phoneNumber, null, true, sessionDir).catch(err => {
                console.error(`[${sessionId}] Reconnect failed:`, err);
              });
            }, 3000 * reconnectAttempts);
          } else {
            console.log(`[${sessionId}] Max reconnect attempts reached.`);
            activeSessions.delete(sessionId);
          }
          return;
        }

        if (statusCode === 428 || statusCode === DisconnectReason.restartRequired) {
          console.log(`[${sessionId}] Connection closed, attempting reconnect...`);
          reconnectAttempts++;
          if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            setTimeout(() => {
              console.log(`[${sessionId}] 🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
              createWhatsAppSession(userId, phoneNumber, null, true, sessionDir).catch(err => {
                console.error(`[${sessionId}] Reconnect failed:`, err);
              });
            }, 3000 * reconnectAttempts);
          } else {
            console.log(`[${sessionId}] Max reconnect attempts reached.`);
            activeSessions.delete(sessionId);
          }
          return;
        }
      } else if (connection === 'connecting') {
        console.log(`[${sessionId}] Connecting...`);
        sessionData.status = 'connecting';
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ws?.on('error', (err) => {
      console.log(`[${sessionId}] Socket error:`, err.message);
    });

    if (res) {
      res.json({
        sessionId,
        status: 'initializing',
        message: 'WhatsApp session initializing...'
      });
    }

  } catch (err) {
    console.error('Session creation error:', err);
    clearTimers();
    if (res) {
      res.status(500).json({ error: 'Failed to create session: ' + err.message });
    }
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  if (err.code !== 'ECONNABORTED' && err.code !== 'ECONNRESET') {
    process.exit(1);
  }
});

module.exports = { createWhatsAppSession, requestPairingCode };
