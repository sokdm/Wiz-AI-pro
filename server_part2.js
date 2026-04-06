const { handleAIResponse, sendWelcomeMessage, activeSessions } = require('./server_part1');
const User = require('./models/User');
const { commands, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, reply, antispamGroups, spamTracker, isBanned, getWarnings, filters } = require('./commands');
const { PIDGIN_RESPONSES, detectIntent, getRandomResponse, checkFilterAndKick } = require('./commands_part7');

const userAIContexts = new Map();
const userLastResponseTime = new Map();
const chatbotCooldown = new Map();

// Track owner online status per user (bot instance)
// Key: userId (MongoDB ID), Value: { lastActivity: timestamp, isOnline: boolean }
const ownerStatusMap = new Map();
const OWNER_OFFLINE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

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

function isOwnerOnline(userId, ownerPhone) {
  const status = ownerStatusMap.get(userId);
  if (!status) return false; // Default to offline if no activity recorded
  
  // Check if owner phone matches sender
  return Date.now() - status.lastActivity < OWNER_OFFLINE_TIMEOUT;
}

function updateOwnerActivity(userId, senderPhone) {
  ownerStatusMap.set(userId, {
    lastActivity: Date.now(),
    senderPhone: senderPhone
  });
}

function setupMessageHandler(sock, sessionId, userId) {
  console.log(`[${sessionId}] Setting up handlers...`);

  // Auto-reconnect ping every 30 seconds to keep connection alive
  const keepAliveInterval = setInterval(() => {
    if (sock.user) {
      sock.sendPresenceUpdate('available');
      console.log(`[${sessionId}] Keep-alive ping`);
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 30000);

  // Get user data to find owner phone
  let ownerPhone = null;
  User.findById(userId).then(user => {
    if (user && user.whatsappSession && user.whatsappSession.phone) {
      ownerPhone = user.whatsappSession.phone.toString().replace(/\D/g, '');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg) return;

    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const remoteJid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');

    // Extract sender phone number
    const senderPhone = sender.split('@')[0].split(':')[0];

    // Track owner activity for this specific bot instance
    if (ownerPhone && senderPhone === ownerPhone) {
      updateOwnerActivity(userId, senderPhone);
      console.log(`[${sessionId}] Owner ${senderPhone} is active`);
    }

    // DEBUG LOG
    console.log(`[${sessionId}] 📩 MESSAGE:`, {
      text: messageText.substring(0, 40),
      sender: sender,
      isGroup: isGroup,
      fromMe: msg.key.fromMe,
      botId: sock.user?.id,
      ownerPhone: ownerPhone,
      senderPhone: senderPhone
    });

    // Skip bot's own welcome messages
    if (msg.key.fromMe === true && messageText.startsWith('╔═══❖')) {
      console.log(`[${sessionId}] Skipping - bot's own welcome message`);
      return;
    }

    if (!msg.message) return;

    try {
      const user = await User.findById(userId);
      if (!user) {
        console.log(`[${sessionId}] ❌ User not found:`, userId);
        return;
      }

      // Update owner phone if not set
      if (!ownerPhone && user.whatsappSession?.phone) {
        ownerPhone = user.whatsappSession.phone.toString().replace(/\D/g, '');
      }

      if (user.botSettings.autoRead) {
        await sock.readMessages([msg.key]);
      }

      // Check ban status (groups only)
      if (isGroup && isBanned(remoteJid, sender)) {
        try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
        return;
      }

      // Check antispam (groups only)
      if (isGroup && checkSpam(remoteJid, sender)) {
        try {
          await sock.sendMessage(remoteJid, { delete: msg.key });
          await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} don send too many messages! Cool down.`, msg);
        } catch {}
        return;
      }

      // Check filter words with auto-kick (groups only)
      if (isGroup && messageText) {
        const wasKicked = await checkFilterAndKick(sock, msg, remoteJid, messageText, sender);
        if (wasKicked) return;
      }

      // Check word filter (groups only) - legacy check
      if (isGroup && checkFilter(remoteJid, messageText)) {
        const groupMeta = await getGroupMetadata(sock, remoteJid);
        const participant = groupMeta?.participants.find(p => p.id === sender);
        const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');

        if (!isSenderAdmin) {
          await sock.sendMessage(remoteJid, { delete: msg.key });
          await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} watch your language!`, msg);
          return;
        }
      }

      // Handle commands - WORKS IN BOTH DMs AND GROUPS
      if (messageText.startsWith('.')) {
        const args = messageText.slice(1).trim().split(' ');
        const cmd = args.shift().toLowerCase();

        console.log(`[${sessionId}] 📝 Command received: .${cmd} from ${isGroup ? 'group' : 'DM'}`);

        if (commands[cmd]) {
          try {
            // Check if group-only command is used in DM
            if (commands[cmd].category === 'group' && !isGroup) {
              await reply(sock, remoteJid, '❌ This command only works in groups!', msg);
              return;
            }

            // Check owner only - compare sender to bot owner's phone
            if (commands[cmd].ownerOnly) {
              const isOwner = senderPhone === ownerPhone;
              if (!isOwner) {
                await reply(sock, remoteJid, '❌ Owner only command!', msg);
                return;
              }
            }

            const result = await commands[cmd].handler(sock, msg, args, user);
            if (result) await reply(sock, remoteJid, result, msg);

            // Add XP for using commands
            if (!user.stats) user.stats = {};
            if (!user.stats.xp) user.stats.xp = 0;
            user.stats.xp += 10;
            user.stats.commandsUsed = (user.stats.commandsUsed || 0) + 1;
            await user.save();
            
            console.log(`[${sessionId}] ✅ Command .${cmd} executed successfully`);
          } catch (err) {
            console.error(`[${sessionId}] ❌ Command ${cmd} error:`, err);
            await reply(sock, remoteJid, '❌ Command failed: ' + err.message, msg);
          }
        } else {
          await reply(sock, remoteJid, '❌ Unknown command. Type .menu for commands.', msg);
        }
        return;
      }

      // CHATBOT HANDLER (NIGERIAN PIDGIN) - Groups only
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

          if (messageText.toLowerCase().includes('?')) {
            response += '\n\nYou dey ask question? I go try answer!';
          }

          await reply(sock, remoteJid, `🤖 ${response}`, msg);
        }
      }

      // AI Auto-response in DMs - ONLY WHEN OWNER IS OFFLINE
      if (!isGroup && !msg.key.fromMe && user.botSettings.aiMode && !messageText.startsWith('.')) {
        const ownerOnline = isOwnerOnline(userId, ownerPhone);
        
        if (ownerOnline) {
          console.log(`[${sessionId}] Owner is online, skipping AI reply`);
          return;
        }
        
        console.log(`[${sessionId}] 🤖 Owner offline, AI DM response triggered`);
        const now = Date.now();
        const lastResponse = userLastResponseTime.get(userId) || 0;

        if (now - lastResponse > 5000) {
          const context = (now - lastResponse < 300000) ? 'dm_conversation' : 'general';
          const aiResponse = await handleAIResponse(messageText, context);
          await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
          userLastResponseTime.set(userId, now);
        }
      }

      // AI when mentioned in groups
      if (isGroup && user.botSettings.aiMode &&
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id) &&
          !messageText.startsWith('.')) {
        const aiResponse = await handleAIResponse(messageText.replace(/@\d+/g, '').trim());
        await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
      }

      // Antilink (groups only)
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

  // Presence update handler to track owner
  sock.ev.on('presence.update', async (update) => {
    const phoneFromPresence = update.id.split('@')[0].split(':')[0];
    if (ownerPhone && phoneFromPresence === ownerPhone) {
      updateOwnerActivity(userId, ownerPhone);
      console.log(`[${sessionId}] Owner presence update: online`);
    }
  });
}

module.exports = { setupMessageHandler };
