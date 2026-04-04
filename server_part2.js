const { handleAIResponse, sendWelcomeMessage, activeSessions } = require('./server_part1');
const User = require('./models/User');
const { commands, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, reply, antispamGroups, spamTracker, isBanned, getWarnings, filters } = require('./commands');
const { PIDGIN_RESPONSES, detectIntent, getRandomResponse } = require('./commands_part7');

const userAIContexts = new Map();
const userLastResponseTime = new Map();
const chatbotCooldown = new Map();

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

function setupMessageHandler(sock, sessionId, userId) {
  console.log(`[${sessionId}] Setting up handlers...`);

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg) return;

    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const remoteJid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');

    // Skip bot's own messages
    if (msg.key.fromMe) {
      console.log(`[${sessionId}] Skipping - from me`);
      return;
    }

    if (!msg.message) return;

    try {
      const user = await User.findById(userId);
      if (!user) return;

      if (user.botSettings.autoRead) {
        await sock.readMessages([msg.key]);
      }

      // Check ban status
      if (isGroup && isBanned(remoteJid, sender)) {
        try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch {}
        return;
      }

      // Check antispam
      if (isGroup && checkSpam(remoteJid, sender)) {
        try { 
          await sock.sendMessage(remoteJid, { delete: msg.key });
          await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} don send too many messages! Cool down.`, msg);
        } catch {}
        return;
      }

      // Check word filter
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

            const result = await commands[cmd].handler(sock, msg, args, user);
            if (result) await reply(sock, remoteJid, result, msg);
            
            user.stats.commandsUsed += 1;
            await user.save();
          } catch (err) {
            console.error(`[${sessionId}] Command ${cmd} error:`, err);
            await reply(sock, remoteJid, '❌ Command failed: ' + err.message, msg);
          }
        } else {
          await reply(sock, remoteJid, '❌ Unknown command. Type .help for commands.', msg);
        }
        return;
      }

      // CHATBOT HANDLER (NIGERIAN PIDGIN)
      if (isGroup && global.chatbotGroups && global.chatbotGroups.has(remoteJid) && !messageText.startsWith('.')) {
        // Don't respond to self
        if (sender === sock.user.id) return;
        
        // Cooldown check (3 seconds)
        const cooldownKey = `${remoteJid}-${sender}`;
        const lastReply = chatbotCooldown.get(cooldownKey) || 0;
        if (Date.now() - lastReply < 3000) return;
        
        // Check if bot is mentioned or message is direct
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

      // AI Auto-response in DMs
      if (!isGroup && !msg.key.fromMe && user.botSettings.aiMode && !messageText.startsWith('.')) {
        const now = Date.now();
        const lastResponse = userLastResponseTime.get(userId) || 0;
        
        if (now - lastResponse > 5000) {
          const context = (now - lastResponse < 300000) ? 'dm_conversation' : 'general';
          const aiResponse = await handleAIResponse(messageText, context);
          await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
          userLastResponseTime.set(userId, now);
        }
      }

      // AI when mentioned
      if (isGroup && user.botSettings.aiMode &&
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id) &&
          !messageText.startsWith('.')) {
        const aiResponse = await handleAIResponse(messageText.replace(/@\d+/g, '').trim());
        await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
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
          const welcomeMsg = `👋 Welcome @${participant.split('@')[0]}! 🎉\n\nType *.help* to see wetin I fit do!`;
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
}

module.exports = { setupMessageHandler };
