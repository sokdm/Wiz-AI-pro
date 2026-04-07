const { handleAIResponse, sendStreamResponse, sendWelcomeMessage, activeSessions } = require('./server_part1');
const User = require('./models/User');
const { commands, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, reply, antispamGroups, spamTracker, isBanned, getWarnings, filters } = require('./commands');
const { PIDGIN_RESPONSES, detectIntent, getRandomResponse, checkFilterAndKick } = require('./commands_part7');

const userAIContexts = new Map();
const userLastResponseTime = new Map();
const chatbotCooldown = new Map();

// Smart DM reply tracking per user
const dmReplyTracker = new Map();
const MAX_DM_REPLIES = 4;
const DM_COOLDOWN = 30 * 60 * 1000;

// Owner presence tracking per bot instance
const ownerStatusMap = new Map();
const OWNER_OFFLINE_TIMEOUT = 5 * 60 * 1000;

function checkSpam(groupId, userId) {
  if (!antispamGroups.has(groupId)) return false;
  const key = `${groupId}-${userId}`;
  const now = Date.now();
  const userSpam = spamTracker.get(key) || { count: 0, firstMessage: now, muted: false };

  if (now - userSpam.firstMessage > 10000) {
    userSpam.count = 0;
    userSpam.firstMessage = now;
    userSpam.muted = false;
  }

  userSpam.count++;
  spamTracker.set(key, userSpam);

  if (userSpam.count >= 5 && !userSpam.muted) {
    userSpam.muted = true;
    spamTracker.set(key, userSpam);
    return true;
  }
  return false;
}

function checkFilter(groupId, text) {
  const groupFilters = filters[groupId] || [];
  const lowerText = text.toLowerCase();
  return groupFilters.some(word => lowerText.includes(word));
}

function isOwnerOnline(userId) {
  const status = ownerStatusMap.get(userId);
  if (!status) return false;
  return Date.now() - status.lastActivity < OWNER_OFFLINE_TIMEOUT;
}

function updateOwnerActivity(userId, phone) {
  ownerStatusMap.set(userId, {
    lastActivity: Date.now(),
    phone: phone
  });
}

function getDMTracker(userId) {
  if (!dmReplyTracker.has(userId)) {
    dmReplyTracker.set(userId, {
      count: 0,
      lastReply: 0,
      hasWarned: false
    });
  }
  return dmReplyTracker.get(userId);
}

function resetDMTracker(userId) {
  dmReplyTracker.delete(userId);
}

// ==================== MESSAGE HANDLER SETUP ====================

function setupMessageHandler(sock, sessionId, userId) {
  console.log(`[${sessionId}] Setting up handlers...`);

  let ownerPhone = null;
  let ownerName = 'Wisdom';

  User.findById(userId).then(user => {
    if (user) {
      ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
      ownerName = user.username || 'Wisdom';
    }
  });

  // Keep-alive ping every 30 seconds (WhatsApp heartbeat)
  const keepAliveInterval = setInterval(() => {
    if (sock.user) {
      sock.sendPresenceUpdate('available');
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 30000);

  // Additional heartbeat every minute for logging
  const heartbeatInterval = setInterval(() => {
    if (sock.user) {
      console.log(`[${sessionId}] Heartbeat: Connection alive at ${new Date().toISOString()}`);
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 60000);

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg) return;

    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const remoteJid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');
    const senderPhone = sender.split('@')[0].split(':')[0];

    // Track owner activity
    if (ownerPhone && senderPhone === ownerPhone) {
      updateOwnerActivity(userId, senderPhone);
      resetDMTracker(remoteJid);
      console.log(`[${sessionId}] Owner ${ownerName} is active`);
    }

    // Skip bot's own welcome messages
    if (msg.key.fromMe === true && messageText.startsWith('╔═══❖')) {
      return;
    }

    if (!msg.message) return;

    try {
      const user = await User.findById(userId);
      if (!user) return;

      if (user.botSettings.autoRead) {
        await sock.readMessages([msg.key]);
      }

      // Group moderation checks
      if (isGroup) {
        if (isBanned(remoteJid, sender)) {
          try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
          return;
        }

        if (checkSpam(remoteJid, sender)) {
          try {
            await sock.sendMessage(remoteJid, { delete: msg.key });
            await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} don send too many messages! Cool down.`, msg);
          } catch {}
          return;
        }

        const wasKicked = await checkFilterAndKick(sock, msg, remoteJid, messageText, sender);
        if (wasKicked) return;

        if (checkFilter(remoteJid, messageText)) {
          const groupMeta = await getGroupMetadata(sock, remoteJid);
          const participant = groupMeta?.participants.find(p => p.id === sender);
          const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');

          if (!isSenderAdmin) {
            await sock.sendMessage(remoteJid, { delete: msg.key });
            await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} watch your language!`, msg);
            return;
          }
        }
      }

      // Handle commands
      if (messageText.startsWith('.')) {
        const args = messageText.slice(1).trim().split(' ');
        const cmd = args.shift().toLowerCase();

        if (commands[cmd]) {
          try {
            if (commands[cmd].category === 'group' && !isGroup) {
              await reply(sock, remoteJid, '❌ This command only works in groups!', msg);
              return;
            }

            if (commands[cmd].ownerOnly) {
              const isOwner = senderPhone === ownerPhone;
              if (!isOwner) {
                await reply(sock, remoteJid, '❌ Owner only command!', msg);
                return;
              }
            }

            const result = await commands[cmd].handler(sock, msg, args, user);
            if (result) {
              await sendStreamResponse(sock, remoteJid, result, msg);
            }

            // Add XP
            if (!user.stats) user.stats = {};
            if (!user.stats.xp) user.stats.xp = 0;
            user.stats.xp += 10;
            user.stats.commandsUsed = (user.stats.commandsUsed || 0) + 1;
            await user.save();

          } catch (err) {
            console.error(`[${sessionId}] Command ${cmd} error:`, err);
            await reply(sock, remoteJid, '❌ Command failed: ' + err.message, msg);
          }
        } else {
          await reply(sock, remoteJid, '❌ Unknown command. Type .menu for commands.', msg);
        }
        return;
      }

      // Group chatbot
      if (isGroup && global.chatbotGroups && global.chatbotGroups.has(remoteJid) && !messageText.startsWith('.')) {
        if (sender === sock.user.id) return;

        const cooldownKey = `${remoteJid}-${sender}`;
        const lastReply = chatbotCooldown.get(cooldownKey) || 0;
        if (Date.now() - lastReply < 3000) return;

        const isMentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id);
        const isReplyToBot = msg.message.extendedTextMessage?.contextInfo?.participant === sock.user.id;
        const shouldRespond = isMentioned || isReplyToBot || Math.random() < 0.3;

        if (shouldRespond) {
          chatbotCooldown.set(cooldownKey, Date.now());
          const intent = detectIntent(messageText);
          let response = intent ? getRandomResponse(intent) : getRandomResponse('confused');
          await reply(sock, remoteJid, `🤖 ${response}`, msg);
        }
      }

      // SMART DM AUTO-REPLY
      if (!isGroup && !msg.key.fromMe && user.botSettings.aiMode && !messageText.startsWith('.')) {
        // Check if owner is online
        if (isOwnerOnline(userId)) {
          console.log(`[${sessionId}] Owner ${ownerName} is online, skipping AI reply`);
          return;
        }

        const tracker = getDMTracker(remoteJid);
        const now = Date.now();

        // Reset if cooldown passed
        if (now - tracker.lastReply > DM_COOLDOWN) {
          tracker.count = 0;
          tracker.hasWarned = false;
        }

        // Check if we've reached the limit
        if (tracker.count >= MAX_DM_REPLIES) {
          if (!tracker.hasWarned) {
            tracker.hasWarned = true;
            await sock.sendMessage(remoteJid, {
              text: `Hey! 👋 I've replied a few times, but I'm just a bot. ${ownerName} will reply personally when they're back online. Thanks for your patience! 🙏`
            });
          }
          console.log(`[${sessionId}] DM reply limit reached for ${remoteJid}`);
          return;
        }

        // Send AI response
        tracker.count++;
        tracker.lastReply = now;
        console.log(`[${sessionId}] DM reply ${tracker.count}/${MAX_DM_REPLIES} for ${remoteJid}`);

        const context = tracker.count > 2 ? 'dm_conversation' : 'general';
        const aiResponse = await handleAIResponse(messageText, context, ownerName);

        // Add friendly note on first reply
        let finalResponse = aiResponse;
        if (tracker.count === 1) {
          finalResponse = `${aiResponse}\n\n_P.S. I'm just a bot helping out while ${ownerName} is away. They'll reply soon!_ 🤖`;
        }

        await sendStreamResponse(sock, remoteJid, finalResponse, msg);
      }

      // AI when mentioned in groups
      if (isGroup && user.botSettings.aiMode &&
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id) &&
          !messageText.startsWith('.')) {
        const aiResponse = await handleAIResponse(messageText.replace(/@\d+/g, '').trim(), 'general', ownerName);
        await sendStreamResponse(sock, remoteJid, `🤖 ${aiResponse}`, msg);
      }

      // Antilink
      if (isGroup && antilinkGroups.has(remoteJid) && messageText.includes('http')) {
        const groupMeta = await getGroupMetadata(sock, remoteJid);
        const participant = groupMeta?.participants.find(p => p.id === sender);
        const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');

        if (!isSenderAdmin) {
          await sock.sendMessage(remoteJid, { delete: msg.key });
          await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} links not allowed!`, msg);
        }
      }

      // Trivia answer check
      if (!messageText.startsWith('.') && global.trivia?.has(remoteJid)) {
        const trivia = global.trivia.get(remoteJid);
        if (messageText.toLowerCase().includes(trivia.a.toLowerCase())) {
          global.trivia.delete(remoteJid);
          await reply(sock, remoteJid, `🎉 Correct @${sender.split('@')[0]}! The answer is: ${trivia.a}`, msg);
        }
      }

    } catch (err) {
      console.error(`[${sessionId}] Handler error:`, err);
    }
  });

  // Group participants update
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;

    if (action === 'add') {
      for (const participant of participants) {
        if (isBanned(id, participant)) {
          try {
            await sock.groupParticipantsUpdate(id, [participant], 'remove');
            await sock.sendMessage(id, {
              text: `🚫 @${participant.split('@')[0]} is banned!`,
              mentions: [participant]
            });
            continue;
          } catch {}
        }

        if (welcomeGroups.has(id)) {
          const welcomeMsg = `👋 Welcome @${participant.split('@')[0]}! 🎉\n\nType *.menu* to see wetin I fit do!`;
          await sock.sendMessage(id, { text: welcomeMsg, mentions: [participant] });
        }
      }
    }

    if (action === 'remove' && goodbyeGroups.has(id)) {
      for (const participant of participants) {
        const goodbyeMsg = `👋 Goodbye @${participant.split('@')[0]}! We go miss you.`;
        await sock.sendMessage(id, { text: goodbyeMsg, mentions: [participant] });
      }
    }
  });

  // Presence update
  sock.ev.on('presence.update', async (update) => {
    const phoneFromPresence = update.id.split('@')[0].split(':')[0];
    if (ownerPhone && phoneFromPresence === ownerPhone) {
      if (update.presences[update.id]?.lastKnownPresence === 'available') {
        updateOwnerActivity(userId, ownerPhone);
        resetDMTracker(update.id);
        console.log(`[${sessionId}] Owner ${ownerName} came online`);
      }
    }
  });
}

module.exports = { setupMessageHandler };
