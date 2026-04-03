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

async function createWhatsAppSession(userId, phoneNumber, res) {
  const sessionId = `wiz_${userId}_${Date.now()}`;
  const sessionDir = `./sessions/${sessionId}`;
  let welcomeSent = false;

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

        // Send welcome message on first connection
        if (!welcomeSent) {
          await sendWelcomeMessage(sock, userId, phoneNumber);
          welcomeSent = true;
        }
        
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
                  
                  // Send welcome on reconnect if not sent before
                  if (!welcomeSent) {
                    await sendWelcomeMessage(newSock, userId, phoneNumber);
                    welcomeSent = true;
                  }
                  
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

module.exports = { createWhatsAppSession, requestPairingCode };
