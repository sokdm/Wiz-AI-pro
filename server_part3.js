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

  try {
    // Only cleanup on fresh start, not reconnect
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
      sessionDir: sessionDir
    };

    activeSessions.set(sessionId, sessionData);

    // Connection handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const error = lastDisconnect?.error;
      const statusCode = error?.output?.statusCode;

      // QR Generated - show options
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

          // Request pairing code if phone provided
          if (phoneNumber && !sessionData.pairingRequested) {
            sessionData.pairingRequested = true;
            await requestPairingCode(sock, sessionData, phoneNumber);
          }
        } catch (e) {
          console.error('QR Error:', e);
        }
      }

      // Successfully connected
      if (connection === 'open') {
        console.log(`[${sessionId}] ✅ Connected!`);
        sessionData.status = 'connected';
        sessionData.hasConnected = true;

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

      } else if (connection === 'close') {
        console.log(`[${sessionId}] Closed. Code: ${statusCode}, Reason: ${DisconnectReason[statusCode] || 'unknown'}`);

        // 515 Restart Required - recreate socket immediately with same session
        if (statusCode === 515) {
          console.log(`[${sessionId}] 🔄 Restart required, recreating connection...`);
          
          // Clean up old socket
          activeSessions.delete(sessionId);
          
          // Small delay then reconnect with same session directory
          setTimeout(() => {
            console.log(`[${sessionId}] 🔄 Reconnecting with fresh socket...`);
            createWhatsAppSession(userId, phoneNumber, null, true, sessionDir).catch(err => {
              console.error(`[${sessionId}] Reconnect failed:`, err);
            });
          }, 2000);
          
          return;
        }

        // Mark disconnected
        sessionData.status = 'disconnected';
        await User.findByIdAndUpdate(userId, {
          'whatsappSession.connected': false
        });

        // Logged out - cleanup
        if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
          console.log(`[${sessionId}] Logged out`);
          activeSessions.delete(sessionId);
          try {
            await fs.remove(sessionDir);
          } catch (e) {}
          return;
        }

        // Timeout - pairing expired
        if (statusCode === 408) {
          console.log(`[${sessionId}] ⏰ Pairing timeout! Refresh to get new code.`);
          activeSessions.delete(sessionId);
          return;
        }

      } else if (connection === 'connecting') {
        console.log(`[${sessionId}] Connecting...`);
        sessionData.status = 'connecting';
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Send initial response if provided
    if (res) {
      res.json({
        sessionId,
        status: 'initializing',
        message: 'WhatsApp session initializing...'
      });
    }

  } catch (err) {
    console.error('Session creation error:', err);
    if (res) {
      res.status(500).json({ error: 'Failed to create session: ' + err.message });
    }
  }
}

module.exports = { createWhatsAppSession, requestPairingCode };
