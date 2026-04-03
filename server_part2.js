const { handleAIResponse, sendWelcomeMessage, activeSessions } = require('./server_part1');
const User = require('./models/User');
const { commands, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, reply } = require('./commands');

const userAIContexts = new Map();
const userLastResponseTime = new Map();

function setupMessageHandler(sock, sessionId, userId) {
  console.log(`[${sessionId}] Setting up handlers...`);
  
  sock.ev.on('messages.upsert', async (m) => {
    console.log(`[${sessionId}] Message received! Type:`, m.type);
    
    const msg = m.messages[0];
    if (!msg) {
      console.log(`[${sessionId}] No message object`);
      return;
    }
    
    const messageText = msg.message?.conversation || 
                       msg.message?.extendedTextMessage?.text || '';
    const remoteJid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');

    console.log(`[${sessionId}] From me:`, msg.key.fromMe);
    console.log(`[${sessionId}] RemoteJid:`, remoteJid);
    console.log(`[${sessionId}] Text:`, messageText.substring(0, 50));
    console.log(`[${sessionId}] IsGroup:`, isGroup);

    // Skip messages from bot itself UNLESS it's a command (for owner)
    if (msg.key.fromMe && !messageText.startsWith('.')) {
      console.log(`[${sessionId}] Skipping - from me but not command`);
      return;
    }

    // Skip if no message content
    if (!msg.message) {
      console.log(`[${sessionId}] Skipping - no message`);
      return;
    }

    try {
      const user = await User.findById(userId);
      if (!user) {
        console.log(`[${sessionId}] User not found`);
        return;
      }

      if (user.botSettings.autoRead && !msg.key.fromMe) {
        await sock.readMessages([msg.key]);
      }

      // Handle commands (works in both DMs and groups, even from owner)
      if (messageText.startsWith('.')) {
        const args = messageText.slice(1).trim().split(' ');
        const cmd = args.shift().toLowerCase();

        console.log(`[${sessionId}] Command detected: ${cmd}`);

        if (commands[cmd]) {
          try {
            // Check if command is group-only
            if (commands[cmd].category === 'group' && !isGroup) {
              await reply(sock, remoteJid, '❌ This command only works in groups!', msg);
              return;
            }
            
            console.log(`[${sessionId}] Executing command: ${cmd}`);
            const result = await commands[cmd].handler(sock, msg, args, user);
            if (result) {
              await reply(sock, remoteJid, result, msg);
            }
            user.stats.commandsUsed += 1;
            await user.save();
          } catch (err) {
            console.error(`[${sessionId}] Command ${cmd} error:`, err);
            await reply(sock, remoteJid, '❌ Command failed: ' + err.message, msg);
          }
        } else {
          console.log(`[${sessionId}] Unknown command: ${cmd}`);
          await reply(sock, remoteJid, '❌ Unknown command. Type .help for commands.', msg);
        }
        return;
      }

      const now = Date.now();
      const lastResponse = userLastResponseTime.get(userId) || 0;
      const timeSinceLastResponse = now - lastResponse;
      
      // AI Auto-response in DMs (not from owner)
      if (!isGroup && !msg.key.fromMe && user.botSettings.aiMode && !messageText.startsWith('.')) {
        console.log(`[${sessionId}] AI responding to DM`);
        
        if (timeSinceLastResponse < 300000) {
          userAIContexts.set(userId, 'recently_active');
        }
        
        const context = userAIContexts.get(userId) === 'recently_active' ? 'dm_conversation' : 'general';
        const aiResponse = await handleAIResponse(messageText, context);
        await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
        
        userLastResponseTime.set(userId, now);
      }

      // AI response when mentioned in groups
      if (isGroup && user.botSettings.aiMode && 
          msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id) &&
          !messageText.startsWith('.')) {
        const aiResponse = await handleAIResponse(messageText.replace(/@\d+/g, '').trim());
        await reply(sock, remoteJid, `🤖 ${aiResponse}`, msg);
      }

      // Antilink in groups
      if (isGroup && antilinkGroups.has(remoteJid) && messageText.includes('http')) {
        const groupMeta = await getGroupMetadata(sock, remoteJid);
        const participant = groupMeta?.participants.find(p => p.id === sender);
        const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
        
        if (!isSenderAdmin) {
          await sock.sendMessage(remoteJid, { delete: msg.key });
          await reply(sock, remoteJid, `🚫 @${sender.split('@')[0]} Links not allowed!`, msg);
        }
      }
    } catch (err) {
      console.error(`[${sessionId}] Handler error:`, err);
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

module.exports = { setupMessageHandler };
