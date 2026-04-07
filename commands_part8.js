const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { commands, registerCommand, getGroupMetadata } = require('./commands_part1');
const { getUser, saveEconomy } = require('./commands_part6');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const os = require('os');

const TEMP_DIR = path.join(__dirname, 'temp');
fs.ensureDirSync(TEMP_DIR);

// Owner online status tracking per user
const ownerStatusMap = new Map();

// Tic-Tac-Toe games storage
const tttGames = new Map();

// Translation languages
const LANGUAGES = {
  'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
  'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese',
  'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'hi': 'Hindi',
  'tr': 'Turkish', 'pl': 'Polish', 'nl': 'Dutch', 'sv': 'Swedish',
  'id': 'Indonesian', 'vi': 'Vietnamese', 'th': 'Thai', 'ms': 'Malay'
};

// ==================== VIEW ONCE FIX - WORKS IN DMs AND GROUPS ====================

registerCommand('vv', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to a view-once image/video with .vv';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  
  // Check for view-once message
  const isViewOnceImage = qMsg.imageMessage?.viewOnce === true;
  const isViewOnceVideo = qMsg.videoMessage?.viewOnce === true;
  
  if (!isViewOnceImage && !isViewOnceVideo) {
    // Try to save regular media as fallback
    return commands['save'].handler(sock, msg, args, user);
  }
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '⏳ Saving view-once media...' }, { quoted: msg });
    
    const buffer = await downloadMediaMessage(
      {
        key: { 
          remoteJid: msg.key.remoteJid, 
          id: quoted.stanzaId, 
          participant: quoted.participant 
        },
        message: qMsg
      },
      'buffer',
      {},
      { 
        logger: { 
          info: () => {}, 
          error: () => {}, 
          debug: () => {}, 
          warn: () => {}, 
          trace: () => {}, 
          fatal: () => {}, 
          child: () => ({}) 
        } 
      }
    );
    
    if (!buffer) return '❌ Failed to download media';
    
    const caption = '✅ View-once media saved!';
    
    if (isViewOnceImage) {
      await sock.sendMessage(msg.key.remoteJid, { 
        image: buffer, 
        caption: caption 
      }, { quoted: msg });
    } else if (isViewOnceVideo) {
      await sock.sendMessage(msg.key.remoteJid, { 
        video: buffer, 
        caption: caption 
      }, { quoted: msg });
    }
    
    return null;
  } catch (err) {
    console.error('VV error:', err);
    return '❌ Failed to save view-once media. It may have expired.';
  }
}, { category: 'media' });

// ==================== FIXED SAVE COMMAND ====================

registerCommand('save', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to media with .save';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  
  // Check all possible media types
  const hasImage = qMsg.imageMessage || qMsg.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
  const hasVideo = qMsg.videoMessage || qMsg.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
  const hasAudio = qMsg.audioMessage || qMsg.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
  const hasDocument = qMsg.documentMessage || qMsg.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;
  const hasSticker = qMsg.stickerMessage || qMsg.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
  
  // Determine media type
  let mediaType = null;
  let actualMsg = qMsg;
  
  if (hasImage) {
    mediaType = 'image';
    actualMsg = qMsg.imageMessage ? qMsg : { imageMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.imageMessage };
  } else if (hasVideo) {
    mediaType = 'video';
    actualMsg = qMsg.videoMessage ? qMsg : { videoMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.videoMessage };
  } else if (hasAudio) {
    mediaType = 'audio';
    actualMsg = qMsg.audioMessage ? qMsg : { audioMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.audioMessage };
  } else if (hasDocument) {
    mediaType = 'document';
    actualMsg = qMsg.documentMessage ? qMsg : { documentMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.documentMessage };
  } else if (hasSticker) {
    mediaType = 'sticker';
    actualMsg = qMsg.stickerMessage ? qMsg : { stickerMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.stickerMessage };
  }
  
  if (!mediaType) {
    console.log('Save debug - qMsg keys:', Object.keys(qMsg));
    return '❌ No media found! Make sure you reply to an image, video, audio, or document.';
  }
  
  try {
    const buffer = await downloadMediaMessage(
      {
        key: { 
          remoteJid: msg.key.remoteJid, 
          id: quoted.stanzaId, 
          participant: quoted.participant 
        },
        message: actualMsg
      },
      'buffer',
      {},
      { 
        logger: { 
          info: () => {}, 
          error: () => {}, 
          debug: () => {}, 
          warn: () => {}, 
          trace: () => {}, 
          fatal: () => {}, 
          child: () => ({}) 
        } 
      }
    );
    
    if (!buffer) return '❌ Failed to download media';
    
    const caption = '✅ Media saved and re-sent!';
    
    if (mediaType === 'image') {
      await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption }, { quoted: msg });
    } else if (mediaType === 'video') {
      await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption }, { quoted: msg });
    } else if (mediaType === 'audio') {
      const isVoice = actualMsg.audioMessage?.ptt || actualMsg.audioMessage?.ptt === true;
      await sock.sendMessage(msg.key.remoteJid, { 
        audio: buffer, 
        mimetype: 'audio/mp4', 
        ptt: isVoice 
      }, { quoted: msg });
    } else if (mediaType === 'document') {
      const fileName = actualMsg.documentMessage?.fileName || 'saved_file';
      await sock.sendMessage(msg.key.remoteJid, { 
        document: buffer, 
        fileName: fileName,
        caption: caption
      }, { quoted: msg });
    } else if (mediaType === 'sticker') {
      await sock.sendMessage(msg.key.remoteJid, { 
        sticker: buffer 
      }, { quoted: msg });
    }
    
    return null;
  } catch (err) {
    console.error('Save error:', err);
    return '❌ Failed to save media: ' + err.message;
  }
}, { category: 'media' });

// ==================== NEW GROUP MANAGEMENT COMMANDS ====================

registerCommand('hidetag', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const text = args.join(' ') || '👋 Attention everyone!';
  const groupMeta = await getGroupMetadata(sock, groupId);
  const mentions = groupMeta.participants.map(p => p.id);
  
  await sock.sendMessage(groupId, { 
    text: text,
    mentions: mentions 
  });
  return null;
}, { category: 'group', adminOnly: true });

registerCommand('tagadmin', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const groupMeta = await getGroupMetadata(sock, groupId);
  const admins = groupMeta.participants.filter(p => 
    p.admin === 'admin' || p.admin === 'superadmin'
  );
  
  if (admins.length === 0) return '❌ No admins found!';
  
  const mentions = admins.map(p => p.id);
  const text = args.join(' ') || '📢 Calling all admins!';
  
  await sock.sendMessage(groupId, { 
    text: text + '\n\n' + admins.map(a => '@' + a.id.split('@')[0]).join(' '),
    mentions: mentions 
  });
  return null;
}, { category: 'group' });

registerCommand('everyone', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const text = args.join(' ') || '🔔 Everyone!';
  const groupMeta = await getGroupMetadata(sock, groupId);
  const mentions = groupMeta.participants.map(p => p.id);
  
  await sock.sendMessage(groupId, { 
    text: '╔═══❖•ೋ° °ೋ•❖═══╗\n┃   📢 EVERYONE\n╚═══❖•ೋ° °ೋ•❖═══╝\n\n' + text,
    mentions: mentions 
  });
  return null;
}, { category: 'group', adminOnly: true });

registerCommand('setname', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const name = args.join(' ');
  if (!name) return '❌ Usage: .setname <new group name>';
  
  await sock.groupUpdateSubject(groupId, name);
  return '✅ Group name changed to: ' + name;
}, { category: 'group', adminOnly: true });

registerCommand('setdesc', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const desc = args.join(' ');
  if (!desc) return '❌ Usage: .setdesc <description>';
  
  await sock.groupUpdateDescription(groupId, desc);
  return '✅ Group description updated!';
}, { category: 'group', adminOnly: true });

registerCommand('groupinfo', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const groupMeta = await getGroupMetadata(sock, groupId);
  const admins = groupMeta.participants.filter(p => 
    p.admin === 'admin' || p.admin === 'superadmin'
  );
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📊 GROUP INFO
╚═══❖•ೋ° °ೋ•❖═══╝

📛 *Name:* ${groupMeta.subject}
👥 *Members:* ${groupMeta.participants.length}
👑 *Admins:* ${admins.length}
🆔 *ID:* ${groupId.split('@')[0]}
📅 *Created:* ${new Date(groupMeta.creation * 1000).toLocaleDateString()}
${groupMeta.desc ? '\n📝 *Description:*\n' + groupMeta.desc : ''}`;
}, { category: 'group' });

registerCommand('link', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const code = await sock.groupInviteCode(groupId);
  return `🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}\n\n⚠️ Don't share with strangers!`;
}, { category: 'group', adminOnly: true });

registerCommand('revoke', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  await sock.groupRevokeInvite(groupId);
  return '✅ Invite link revoked! Generate a new one with .link';
}, { category: 'group', adminOnly: true });

registerCommand('mute', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  await sock.groupSettingUpdate(groupId, 'announcement');
  return '🔇 Group muted! Only admins can send messages.';
}, { category: 'group', adminOnly: true });

registerCommand('unmute', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  await sock.groupSettingUpdate(groupId, 'not_announcement');
  return '🔊 Group unmuted! Everyone can send messages.';
}, { category: 'group', adminOnly: true });

registerCommand('delete', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to the message you want to delete!';
  
  await sock.sendMessage(msg.key.remoteJid, { 
    delete: {
      remoteJid: msg.key.remoteJid,
      fromMe: quoted.participant === sock.user.id,
      id: quoted.stanzaId,
      participant: quoted.participant
    }
  });
  return null;
}, { category: 'group', adminOnly: true });

// ==================== NEW MODERATION COMMANDS ====================

registerCommand('warn', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  if (!target) return '❌ Mention user to warn!';
  
  const reason = args.slice(1).join(' ') || 'No reason';
  
  if (!global.warnings) global.warnings = new Map();
  const key = `${groupId}-${target}`;
  const userWarns = global.warnings.get(key) || { count: 0, reasons: [] };
  
  userWarns.count++;
  userWarns.reasons.push(reason);
  global.warnings.set(key, userWarns);
  
  if (userWarns.count >= 3) {
    await sock.groupParticipantsUpdate(groupId, [target], 'remove');
    global.warnings.delete(key);
    return `🚫 @${target.split('@')[0]} has been kicked after 3 warnings!`;
  }
  
  return `⚠️ @${target.split('@')[0]} warned!\nReason: ${reason}\nWarnings: ${userWarns.count}/3`;
}, { category: 'moderation', adminOnly: true });

registerCommand('unwarn', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention user!';
  
  const key = `${groupId}-${target}`;
  if (global.warnings?.has(key)) {
    global.warnings.delete(key);
    return `✅ Warnings cleared for @${target.split('@')[0]}`;
  }
  return '⚠️ User has no warnings';
}, { category: 'moderation', adminOnly: true });

registerCommand('warnings', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                 (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : msg.key.participant);
  
  const key = `${groupId}-${target}`;
  const userWarns = global.warnings?.get(key) || { count: 0, reasons: [] };
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   ⚠️ WARNINGS
╚═══❖•ೋ° °ೋ•❖═══╝

👤 User: @${target.split('@')[0]}
🔢 Count: ${userWarns.count}/3

${userWarns.reasons.length > 0 ? '📝 Reasons:\n' + userWarns.reasons.map((r, i) => `${i+1}. ${r}`).join('\n') : '✅ No warnings'}`;
}, { category: 'moderation' });

registerCommand('ban', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention user to ban!';
  
  if (!global.banned) global.banned = new Map();
  if (!global.banned.has(groupId)) global.banned.set(groupId, new Set());
  
  global.banned.get(groupId).add(target);
  await sock.groupParticipantsUpdate(groupId, [target], 'remove');
  
  return `🚫 @${target.split('@')[0]} has been banned from this group!`;
}, { category: 'moderation', adminOnly: true });

registerCommand('unban', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention user to unban!';
  
  if (global.banned?.has(groupId)) {
    global.banned.get(groupId).delete(target);
    return `✅ @${target.split('@')[0]} has been unbanned!`;
  }
  return '⚠️ User was not banned';
}, { category: 'moderation', adminOnly: true });

registerCommand('banlist', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const banned = global.banned?.get(groupId) || new Set();
  if (banned.size === 0) return '✅ No banned users in this group';
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🚫 BANNED USERS
╚═══❖•ೋ° °ೋ•❖═══╝

${Array.from(banned).map((id, i) => `${i+1}. @${id.split('@')[0]}`).join('\n')}`;
}, { category: 'moderation', adminOnly: true });

// ==================== NEW AI & SMART TOOLS ====================

registerCommand('ai', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Usage: .ai <your question>';
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '🤖 Thinking...' }, { quoted: msg });
    
    const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are Wiz AI Pro, a helpful WhatsApp bot assistant.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    const reply = response.data.choices[0].message.content;
    return `🤖 AI Response:\n\n${reply}`;
  } catch (err) {
    return '❌ AI service unavailable. Try again later.';
  }
}, { category: 'ai' });

registerCommand('gpt', async (sock, msg, args, user) => {
  return commands['ai'].handler(sock, msg, args, user);
}, { category: 'ai' });

registerCommand('translate', async (sock, msg, args, user) => {
  const lang = args[0];
  const text = args.slice(1).join(' ');
  
  if (!lang || !text) {
    return `❌ Usage: .translate <lang> <text>\n\nLanguages: ${Object.entries(LANGUAGES).map(([k, v]) => `${k}=${v}`).join(', ')}`;
  }
  
  try {
    const res = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${lang}`, {
      timeout: 15000
    });
    
    if (res.data.responseStatus === 200) {
      return `🌐 Translation\n\nFrom: ${text}\nTo (${LANGUAGES[lang] || lang}): ${res.data.responseData.translatedText}`;
    }
    throw new Error('Translation failed');
  } catch (err) {
    return '❌ Translation failed. Try again.';
  }
}, { category: 'ai' });

registerCommand('summarize', async (sock, msg, args, user) => {
  const text = args.join(' ');
  if (!text || text.length < 100) return '❌ Provide longer text to summarize (min 100 chars)';
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '📝 Summarizing...' }, { quoted: msg });
    
    const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Summarize the following text in 3-5 bullet points:' },
        { role: 'user', content: text }
      ],
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    const summary = response.data.choices[0].message.content;
    return `📝 Summary:\n\n${summary}`;
  } catch (err) {
    return '❌ Summarization failed.';
  }
}, { category: 'ai' });

registerCommand('anime', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .anime <anime name>';
  
  try {
    const res = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`, {
      timeout: 15000
    });
    
    if (!res.data.data || res.data.data.length === 0) return '❌ Anime not found';
    
    const anime = res.data.data[0];
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎌 ANIME INFO
╚═══❖•ೋ° °ೋ•❖═══╝

📺 ${anime.title}
${anime.title_english ? '🌐 ' + anime.title_english : ''}

⭐ Score: ${anime.score || 'N/A'}
📊 Episodes: ${anime.episodes || 'N/A'}
📅 Aired: ${anime.aired?.string || 'N/A'}
⏱️ Duration: ${anime.duration || 'N/A'}
🔞 Rating: ${anime.rating || 'N/A'}

📝 Synopsis:
${anime.synopsis ? anime.synopsis.substring(0, 300) + '...' : 'No synopsis available'}

🔗 ${anime.url}`;
  } catch (err) {
    return '❌ Failed to fetch anime info';
  }
}, { category: 'ai' });

// ==================== NEW ECONOMY COMMANDS ====================

registerCommand('daily', async (sock, msg, args, user) => {
  const now = Date.now();
  const lastDaily = user.economy?.lastDaily || 0;
  const cooldown = 24 * 60 * 60 * 1000;
  
  if (now - lastDaily < cooldown) {
    const remaining = cooldown - (now - lastDaily);
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    return `⏰ Daily reward available in ${hours}h ${mins}m`;
  }
  
  const reward = 1000 + Math.floor(Math.random() * 500);
  user.economy.wallet += reward;
  user.economy.lastDaily = now;
  await user.save();
  
  return `🎁 Daily Reward!\n\n💰 You received ₦${reward}!\n💵 Wallet: ₦${user.economy.wallet}`;
}, { category: 'economy' });

registerCommand('deposit', async (sock, msg, args, user) => {
  const amount = parseInt(args[0]);
  if (!amount || isNaN(amount) || amount <= 0) return '❌ Usage: .deposit <amount>';
  if (user.economy.wallet < amount) return '❌ Insufficient wallet balance!';
  
  user.economy.wallet -= amount;
  user.economy.bank += amount;
  await user.save();
  
  return `🏦 Deposited ₦${amount} to bank!\n💵 Wallet: ₦${user.economy.wallet}\n🏛️ Bank: ₦${user.economy.bank}`;
}, { category: 'economy' });

registerCommand('withdraw', async (sock, msg, args, user) => {
  const amount = parseInt(args[0]);
  if (!amount || isNaN(amount) || amount <= 0) return '❌ Usage: .withdraw <amount>';
  if (user.economy.bank < amount) return '❌ Insufficient bank balance!';
  
  user.economy.bank -= amount;
  user.economy.wallet += amount;
  await user.save();
  
  return `💸 Withdrew ₦${amount} from bank!\n💵 Wallet: ₦${user.economy.wallet}\n🏛️ Bank: ₦${user.economy.bank}`;
}, { category: 'economy' });

registerCommand('transfer', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const amount = parseInt(args[1]);
  
  if (!target || !amount) return '❌ Usage: .transfer @user <amount>';
  if (isNaN(amount) || amount <= 0) return '❌ Invalid amount';
  if (user.economy.wallet < amount) return '❌ Insufficient balance!';
  
  const targetUser = await getUser(target);
  if (!targetUser) return '❌ User not found in database';
  
  user.economy.wallet -= amount;
  targetUser.economy.wallet += amount;
  
  await user.save();
  await targetUser.save();
  
  return `💸 Transferred ₦${amount} to @${target.split('@')[0]}!\n💵 Your wallet: ₦${user.economy.wallet}`;
}, { category: 'economy' });

registerCommand('top', async (sock, msg, args, user) => {
  const User = require('./models/User');
  const top = await User.find().sort({ 'economy.bank': -1 }).limit(10);
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🏆 RICHEST USERS
╚═══❖•ೋ° °ೋ•❖═══╝

${top.map((u, i) => {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
  return `${medal} ${i+1}. ${u.username}\n    💰 ₦${u.economy.bank + u.economy.wallet}`;
}).join('\n\n')}`;
}, { category: 'economy' });

registerCommand('level', async (sock, msg, args, user) => {
  const xp = user.stats?.xp || 0;
  const level = Math.floor(xp / 1000) + 1;
  const nextLevel = level * 1000;
  const progress = xp % 1000;
  const percent = Math.floor((progress / 1000) * 100);
  
  const bar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📊 YOUR LEVEL
╚═══❖•ೋ° °ೋ•❖═══╝

👤 ${user.username}
🏆 Level ${level}
⭐ XP: ${xp} / ${nextLevel}

[${bar}] ${percent}%

📈 Next level in: ${1000 - progress} XP`;
}, { category: 'economy' });

registerCommand('leaderboard', async (sock, msg, args, user) => {
  const User = require('./models/User');
  const top = await User.find().sort({ 'stats.xp': -1 }).limit(10);
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🏆 XP LEADERBOARD
╚═══❖•ೋ° °ೋ•❖═══╝

${top.map((u, i) => {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
  const lvl = Math.floor((u.stats?.xp || 0) / 1000) + 1;
  return `${medal} ${i+1}. ${u.username}\n    ⭐ Level ${lvl} (${u.stats?.xp || 0} XP)`;
}).join('\n\n')}`;
}, { category: 'economy' });

// ==================== NEW GAMES ====================

registerCommand('slot', async (sock, msg, args, user) => {
  const bet = parseInt(args[0]);
  if (!bet || isNaN(bet) || bet <= 0) return '❌ Usage: .slot <bet amount>';
  if (user.economy.wallet < bet) return '❌ Insufficient balance!';
  
  const symbols = ['🍎', '🍊', '🍇', '🍒', '💎', '7️⃣'];
  const result = [
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)]
  ];
  
  let win = 0;
  if (result[0] === result[1] && result[1] === result[2]) {
    win = bet * (result[0] === '7️⃣' ? 10 : result[0] === '💎' ? 5 : 3);
  } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    win = bet * 1.5;
  }
  
  user.economy.wallet -= bet;
  if (win > 0) user.economy.wallet += win;
  await user.save();
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎰 SLOT MACHINE
╚═══❖•ೋ° °ೋ•❖═══╝

| ${result.join(' | ')} |

${win > 0 ? `🎉 YOU WON ₦${Math.floor(win)}!` : '💔 You lost!'}

💵 Wallet: ₦${user.economy.wallet}`;
}, { category: 'games' });

registerCommand('roulette', async (sock, msg, args, user) => {
  const bet = parseInt(args[0]);
  if (!bet || isNaN(bet) || bet <= 0) return '❌ Usage: .roulette <bet>';
  if (user.economy.wallet < bet) return '❌ Insufficient balance!';
  
  const chambers = 6;
  const bullet = Math.floor(Math.random() * chambers);
  const trigger = Math.floor(Math.random() * chambers);
  
  user.economy.wallet -= bet;
  
  if (bullet === trigger) {
    await user.save();
    return `🔫 BANG!\n\n💀 You died and lost ₦${bet}\n💵 Wallet: ₦${user.economy.wallet}`;
  } else {
    const win = bet * 2;
    user.economy.wallet += win;
    await user.save();
    return `🔫 CLICK\n\n😅 You survived!\n🎉 Won ₦${win}\n💵 Wallet: ₦${user.economy.wallet}`;
  }
}, { category: 'games' });

registerCommand('trivia', async (sock, msg, args, user) => {
  const questions = [
    { q: 'What is the capital of Nigeria?', a: 'abuja' },
    { q: 'What is 2 + 2 × 2?', a: '6' },
    { q: 'Who painted the Mona Lisa?', a: 'leonardo da vinci' },
    { q: 'What is the largest planet?', a: 'jupiter' },
    { q: 'In which year did Nigeria gain independence?', a: '1960' }
  ];
  
  const q = questions[Math.floor(Math.random() * questions.length)];
  
  if (!global.trivia) global.trivia = new Map();
  global.trivia.set(msg.key.remoteJid, q);
  
  return `🎯 TRIVIA\n\n${q.q}\n\nReply with the answer!`;
}, { category: 'games' });

registerCommand('tictactoe', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const challenger = msg.key.participant || msg.key.remoteJid;
  const opponent = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  
  if (!opponent) return '❌ Mention opponent: .tictactoe @user';
  if (opponent === challenger) return '❌ You cannot play against yourself!';
  
  const gameId = `${groupId}-${Date.now()}`;
  tttGames.set(gameId, {
    board: ['', '', '', '', '', '', '', '', ''],
    current: challenger,
    challenger: challenger,
    opponent: opponent,
    groupId: groupId
  });
  
  if (!global.activeGames) global.activeGames = new Map();
  global.activeGames.set(groupId, gameId);
  
  return `🎮 TIC-TAC-TOE\n\n@${challenger.split('@')[0]} vs @${opponent.split('@')[0]}\n\n${renderBoard(tttGames.get(gameId).board)}\n\n@${challenger.split('@')[0]}'s turn (X)\nUse .move <1-9>`;
}, { category: 'games' });

registerCommand('move', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const player = msg.key.participant || msg.key.remoteJid;
  const pos = parseInt(args[0]) - 1;
  
  if (isNaN(pos) || pos < 0 || pos > 8) return '❌ Use .move <1-9>';
  
  const gameId = global.activeGames?.get(groupId);
  if (!gameId) return '❌ No active game! Start with .tictactoe @user';
  
  const game = tttGames.get(gameId);
  if (!game) return '❌ Game expired';
  
  if (game.current !== player) return '❌ Not your turn!';
  if (game.board[pos] !== '') return '❌ Position taken!';
  
  const symbol = game.current === game.challenger ? 'X' : 'O';
  game.board[pos] = symbol;
  
  const winPatterns = [
    [0,1,2], [3,4,5], [6,7,8],
    [0,3,6], [1,4,7], [2,5,8],
    [0,4,8], [2,4,6]
  ];
  
  const winner = winPatterns.find(p => 
    game.board[p[0]] && game.board[p[0]] === game.board[p[1]] && game.board[p[1]] === game.board[p[2]]
  );
  
  if (winner) {
    tttGames.delete(gameId);
    global.activeGames.delete(groupId);
    return `🎮 TIC-TAC-TOE\n\n${renderBoard(game.board)}\n\n🎉 @${player.split('@')[0]} WINS!`;
  }
  
  if (!game.board.includes('')) {
    tttGames.delete(gameId);
    global.activeGames.delete(groupId);
    return `🎮 TIC-TAC-TOE\n\n${renderBoard(game.board)}\n\n🤝 DRAW!`;
  }
  
  game.current = game.current === game.challenger ? game.opponent : game.challenger;
  const nextSymbol = game.current === game.challenger ? 'X' : 'O';
  
  return `🎮 TIC-TAC-TOE\n\n${renderBoard(game.board)}\n\n@${game.current.split('@')[0]}'s turn (${nextSymbol})`;
}, { category: 'games' });

function renderBoard(board) {
  const b = board.map(c => c || '⬜');
  return `${b[0]}${b[1]}${b[2]}\n${b[3]}${b[4]}${b[5]}\n${b[6]}${b[7]}${b[8]}`;
}

registerCommand('rps', async (sock, msg, args, user) => {
  const choice = args[0]?.toLowerCase();
  if (!['rock', 'paper', 'scissors'].includes(choice)) {
    return '❌ Usage: .rps <rock/paper/scissors>';
  }
  
  const botChoice = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
  const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
  
  let result;
  if (choice === botChoice) result = '🤝 Draw!';
  else if (
    (choice === 'rock' && botChoice === 'scissors') ||
    (choice === 'paper' && botChoice === 'rock') ||
    (choice === 'scissors' && botChoice === 'paper')
  ) result = '🎉 You win!';
  else result = '💔 You lose!';
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎮 ROCK PAPER SCISSORS
╚═══❖•ೋ° °ೋ•❖═══╝

You: ${emojis[choice]} ${choice}
Bot: ${emojis[botChoice]} ${botChoice}

${result}`;
}, { category: 'games' });

// ==================== NEW FUN COMMANDS ====================

registerCommand('joke', async (sock, msg, args, user) => {
  const jokes = [
    'Why don\'t scientists trust atoms? Because they make up everything!',
    'Why did the scarecrow win an award? He was outstanding in his field!',
    'Why don\'t eggs tell jokes? They\'d crack each other up!',
    'What do you call a fake noodle? An impasta!',
    'Why did the math book look sad? Because it had too many problems.',
    'What do you call a bear with no teeth? A gummy bear!',
    'Why did the cookie go to the doctor? Because it felt crummy.',
    'What do you call a sleeping dinosaur? A dino-snore!'
  ];
  
  return `😂 JOKE\n\n${jokes[Math.floor(Math.random() * jokes.length)]}`;
}, { category: 'fun' });

registerCommand('quote', async (sock, msg, args, user) => {
  try {
    const res = await axios.get('https://api.quotable.io/random', { timeout: 10000 });
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   💭 QUOTE
╚═══❖•ೋ° °ೋ•❖═══╝

"${res.data.content}"

— ${res.data.author}`;
  } catch (err) {
    const quotes = [
      { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
      { text: 'Innovation distinguishes between a leader and a follower.', author: 'Steve Jobs' },
      { text: 'Stay hungry, stay foolish.', author: 'Steve Jobs' }
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   💭 QUOTE
╚═══❖•ೋ° °ೋ•❖═══╝

"${q.text}"

— ${q.author}`;
  }
}, { category: 'fun' });

registerCommand('roll', async (sock, msg, args, user) => {
  const sides = parseInt(args[0]) || 6;
  const result = Math.floor(Math.random() * sides) + 1;
  return `🎲 Rolled a ${sides}-sided die: ${result}`;
}, { category: 'fun' });

registerCommand('flip', async (sock, msg, args, user) => {
  const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
  return `🪙 Coin flip: ${result}`;
}, { category: 'fun' });

registerCommand('choose', async (sock, msg, args, user) => {
  const options = args.join(' ').split(',').map(o => o.trim()).filter(o => o);
  if (options.length < 2) return '❌ Usage: .choose option1, option2, option3';
  
  const choice = options[Math.floor(Math.random() * options.length)];
  return `🤔 I choose: ${choice}`;
}, { category: 'fun' });

registerCommand('rate', async (sock, msg, args, user) => {
  const thing = args.join(' ') || 'you';
  const rating = Math.floor(Math.random() * 10) + 1;
  const stars = '⭐'.repeat(Math.ceil(rating / 2));
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📊 RATING
╚═══❖•ೋ° °ೋ•❖═══╝

${thing}
Rating: ${rating}/10
${stars}`;
}, { category: 'fun' });

registerCommand('gaycheck', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                 msg.key.participant || msg.key.remoteJid;
  
  const percent = Math.floor(Math.random() * 101);
  const bar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🌈 GAY CHECK
╚═══❖•ೋ° °ೋ•❖═══╝

👤 @${target.split('@')[0]}

[${bar}] ${percent}%

${percent > 80 ? '🏳️‍🌈 Super gay!' : percent > 50 ? '🌈 Kinda gay' : percent > 20 ? '🤔 Maybe?' : '✅ Straight'}`;
}, { category: 'fun' });

// ==================== NEW UTILITY COMMANDS ====================

registerCommand('ping', async (sock, msg, args, user) => {
  const start = Date.now();
  await sock.sendMessage(msg.key.remoteJid, { text: 'Testing...' });
  const latency = Date.now() - start;
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🏓 PONG!
╚═══❖•ೋ° °ೋ•❖═══╝

⚡ Latency: ${latency}ms
🤖 Bot: Online
📡 API: Connected`;
}, { category: 'utility' });

registerCommand('uptime', async (sock, msg, args, user) => {
  const uptime = process.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = Math.floor(uptime % 60);
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   ⏱️ BOT UPTIME
╚═══❖•ೋ° °ೋ•❖═══╝

${days}d ${hours}h ${mins}m ${secs}s

🟢 Running smoothly!`;
}, { category: 'utility' });

registerCommand('serverinfo', async (sock, msg, args, user) => {
  const memUsage = process.memoryUsage();
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🖥️ SERVER INFO
╚═══❖•ೋ° °ೋ•❖═══╝

💾 Memory:
  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB
  Heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB
  
⚙️ System:
  Platform: ${os.platform()}
  Arch: ${os.arch()}
  CPUs: ${os.cpus().length}
  
🤖 Bot:
  Node: ${process.version}
  Uptime: ${Math.floor(process.uptime() / 3600)}h`;
}, { category: 'utility' });

registerCommand('convert', async (sock, msg, args, user) => {
  const amount = parseFloat(args[0]);
  const from = args[1]?.toUpperCase();
  const to = args[2]?.toUpperCase();
  
  if (!amount || !from || !to) {
    return '❌ Usage: .convert <amount> <from> <to>\nExample: .convert 100 USD NGN';
  }
  
  try {
    const res = await axios.get(`https://api.exchangerate-api.com/v4/latest/${from}`, {
      timeout: 15000
    });
    
    const rate = res.data.rates[to];
    if (!rate) return '❌ Currency not supported';
    
    const result = (amount * rate).toFixed(2);
    return `💱 Currency Conversion\n\n${amount} ${from} = ${result} ${to}\n📈 Rate: 1 ${from} = ${rate} ${to}`;
  } catch (err) {
    return '❌ Conversion failed. Try: USD, EUR, GBP, NGN, JPY, etc.';
  }
}, { category: 'utility' });

registerCommand('shorten', async (sock, msg, args, user) => {
  const url = args[0];
  if (!url || !url.startsWith('http')) return '❌ Usage: .shorten <url>';
  
  try {
    const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
      timeout: 15000
    });
    return `🔗 URL Shortened\n\nOriginal: ${url}\nShort: ${res.data}`;
  } catch (err) {
    return '❌ Failed to shorten URL';
  }
}, { category: 'utility' });

registerCommand('password', async (sock, msg, args, user) => {
  const length = parseInt(args[0]) || 12;
  if (length < 4 || length > 50) return '❌ Length must be 4-50';
  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return `🔐 Generated Password\n\n${password}\n\nLength: ${length} characters\n💾 Save this securely!`;
}, { category: 'utility' });

registerCommand('whois', async (sock, msg, args, user) => {
  const domain = args[0];
  if (!domain) return '❌ Usage: .whois <domain.com>';
  
  try {
    const res = await axios.get(`https://api.hackertarget.com/whois/?q=${domain}`, {
      timeout: 15000
    });
    return `🌐 WHOIS Lookup\n\n${res.data.substring(0, 2000)}`;
  } catch (err) {
    return '❌ Lookup failed';
  }
}, { category: 'utility' });

registerCommand('news', async (sock, msg, args, user) => {
  try {
    const res = await axios.get('https://newsapi.org/v2/top-headlines?country=us&pageSize=5&apiKey=demo', {
      timeout: 15000
    });
    
    if (!res.data.articles?.length) throw new Error('No news');
    
    const headlines = res.data.articles.slice(0, 3).map((a, i) => 
      `${i+1}. ${a.title}\n   👤 ${a.source.name}`
    ).join('\n\n');
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📰 LATEST NEWS
╚═══❖•ೋ° °ೋ•❖═══╝

${headlines}`;
  } catch (err) {
    return `📰 News Unavailable\n\nTry visiting:\n• https://bbc.com\n• https://cnn.com\n• https://punchng.com`;
  }
}, { category: 'utility' });

registerCommand('crypto', async (sock, msg, args, user) => {
  const coin = (args[0] || 'bitcoin').toLowerCase();
  
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd,ngn&include_24hr_change=true`, {
      timeout: 15000
    });
    
    const data = res.data[coin];
    if (!data) return '❌ Coin not found. Try: bitcoin, ethereum, litecoin, dogecoin';
    
    const change = data.usd_24h_change;
    const emoji = change >= 0 ? '📈' : '📉';
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   💰 CRYPTO PRICE
╚═══❖•ೋ° °ೋ•❖═══╝

🏷️ ${coin.toUpperCase()}
💵 $${data.usd.toLocaleString()}
🇳🇬 ₦${data.ngn.toLocaleString()}
${emoji} 24h: ${change?.toFixed(2)}%`;
  } catch (err) {
    return '❌ Failed to fetch crypto price';
  }
}, { category: 'utility' });

// ==================== NEW MEDIA COMMANDS ====================

registerCommand('sticker', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to an image with .sticker';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  const isImage = qMsg.imageMessage || (qMsg.documentMessage && qMsg.documentMessage.mimetype?.startsWith('image'));
  
  if (!isImage) return '❌ Reply to an image!';
  
  try {
    const buffer = await downloadMediaMessage(
      {
        key: { remoteJid: msg.key.remoteJid, id: quoted.stanzaId, participant: quoted.participant },
        message: qMsg
      },
      'buffer',
      {},
      { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) } }
    );
    
    await sock.sendMessage(msg.key.remoteJid, {
      sticker: buffer,
      mimetype: 'image/webp'
    }, { quoted: msg });
    
    return null;
  } catch (err) {
    return '❌ Failed to create sticker';
  }
}, { category: 'media' });

registerCommand('toimg', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to a sticker with .toimg';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  if (!qMsg.stickerMessage) return '❌ Not a sticker!';
  
  try {
    const buffer = await downloadMediaMessage(
      {
        key: { remoteJid: msg.key.remoteJid, id: quoted.stanzaId, participant: quoted.participant },
        message: qMsg
      },
      'buffer',
      {},
      { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) } }
    );
    
    await sock.sendMessage(msg.key.remoteJid, {
      image: buffer,
      caption: '🖼️ Sticker converted to image'
    }, { quoted: msg });
    
    return null;
  } catch (err) {
    return '❌ Failed to convert sticker';
  }
}, { category: 'media' });

registerCommand('play', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .play <song name>';
  
  return commands['playvn'].handler(sock, msg, args, user);
}, { category: 'media' });

registerCommand('ytsearch', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .ytsearch <query>';
  
  try {
    const res = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&key=AIzaSyDemoKey&type=video&maxResults=5`, {
      timeout: 15000
    });
    
    if (!res.data.items?.length) throw new Error('No results');
    
    const videos = res.data.items.map((v, i) => 
      `${i+1}. ${v.snippet.title}\n   👤 ${v.snippet.channelTitle}\n   🆔 ${v.id.videoId}`
    ).join('\n\n');
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎬 YOUTUBE SEARCH
╚═══❖•ೋ° °ೋ•❖═══╝

${videos}`;
  } catch (err) {
    return `🔍 YouTube Search\n\nhttps://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  }
}, { category: 'media' });

registerCommand('tiktok', async (sock, msg, args, user) => {
  const url = args[0];
  if (!url?.includes('tiktok.com')) return '❌ Usage: .tiktok <tiktok url>';
  
  return '⏳ TikTok download is processing...\n\nUse online downloader:\nhttps://ssstik.io';
}, { category: 'media' });

registerCommand('ig', async (sock, msg, args, user) => {
  const url = args[0];
  if (!url?.includes('instagram.com')) return '❌ Usage: .ig <instagram url>';
  
  return '⏳ Instagram download is processing...\n\nUse online downloader:\nhttps://snapinsta.app';
}, { category: 'media' });

registerCommand('fb', async (sock, msg, args, user) => {
  const url = args[0];
  if (!url?.includes('facebook.com')) return '❌ Usage: .fb <facebook url>';
  
  return '⏳ Facebook download is processing...\n\nUse online downloader:\nhttps://fdown.net';
}, { category: 'media' });

registerCommand('x', async (sock, msg, args, user) => {
  const url = args[0];
  if (!url?.includes('twitter.com') && !url?.includes('x.com')) return '❌ Usage: .x <twitter/x url>';
  
  return '⏳ Twitter/X download is processing...\n\nUse online downloader:\nhttps://twitsave.com';
}, { category: 'media' });

registerCommand('lyrics', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .lyrics <song name>';
  
  try {
    const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(query)}`, {
      timeout: 15000
    });
    
    const lyrics = res.data.lyrics?.substring(0, 1500) || 'Lyrics not found';
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎵 LYRICS
╚═══❖•ೋ° °ೋ•❖═══╝

${query}

${lyrics}${res.data.lyrics?.length > 1500 ? '\n\n... (truncated)' : ''}`;
  } catch (err) {
    return `❌ Lyrics not found for "${query}"\n\nTry searching on Genius.com`;
  }
}, { category: 'media' });

registerCommand('pinterest', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .pinterest <search>';
  
  return `🔍 Pinterest Search\n\nhttps://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
}, { category: 'media' });

// ==================== OWNER ONLY COMMANDS ====================

registerCommand('broadcast', async (sock, msg, args, user) => {
  const message = args.join(' ');
  if (!message) return '❌ Usage: .broadcast <message>';
  
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  
  if (senderPhone !== ownerPhone) return '❌ Owner only command!';
  
  const groups = await sock.groupFetchAllParticipating();
  const groupIds = Object.keys(groups);
  
  let sent = 0;
  for (const groupId of groupIds) {
    try {
      await sock.sendMessage(groupId, {
        text: `╔═══❖•ೋ° °ೋ•❖═══╗\n┃   📢 BROADCAST\n╚═══❖•ೋ° °ೋ•❖═══╝\n\n${message}\n\n👑 _Wiz AI Pro_`
      });
      sent++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {}
  }
  
  return `✅ Broadcast sent to ${sent} groups!`;
}, { category: 'owner', ownerOnly: true });

registerCommand('setpp', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to an image with .setpp';
  
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  if (senderPhone !== ownerPhone) return '❌ Owner only command!';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  if (!qMsg.imageMessage) return '❌ Not an image!';
  
  try {
    const buffer = await downloadMediaMessage(
      {
        key: { remoteJid: msg.key.remoteJid, id: quoted.stanzaId, participant: quoted.participant },
        message: qMsg
      },
      'buffer',
      {},
      { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) } }
    );
    
    await sock.updateProfilePicture(sock.user.id, buffer);
    return '✅ Profile picture updated!';
  } catch (err) {
    return '❌ Failed to update profile picture';
  }
}, { category: 'owner', ownerOnly: true });

registerCommand('block', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention user to block';
  
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  if (senderPhone !== ownerPhone) return '❌ Owner only command!';
  
  await sock.updateBlockStatus(target, 'block');
  return `🚫 Blocked @${target.split('@')[0]}`;
}, { category: 'owner', ownerOnly: true });

registerCommand('unblock', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention user to unblock';
  
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  if (senderPhone !== ownerPhone) return '❌ Owner only command!';
  
  await sock.updateBlockStatus(target, 'unblock');
  return `✅ Unblocked @${target.split('@')[0]}`;
}, { category: 'owner', ownerOnly: true });

registerCommand('stats', async (sock, msg, args, user) => {
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  if (senderPhone !== ownerPhone) return '❌ Owner only command!';
  
  const User = require('./models/User');
  const totalUsers = await User.countDocuments();
  let activeSessions = 0;
  try {
    const groups = await sock.groupFetchAllParticipating();
    activeSessions = Object.keys(groups).length;
  } catch (e) {
    activeSessions = 'N/A';
  }
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📊 BOT STATISTICS
╚═══❖•ೋ° °ೋ•❖═══╝

👥 Total Users: ${totalUsers}
💬 Active Groups: ${activeSessions}
⚡ Uptime: ${Math.floor(process.uptime() / 3600)}h
💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
📅 Commands: ${Object.keys(commands).length}+

🤖 Wiz AI Pro v3.0`;
}, { category: 'owner', ownerOnly: true });

// ==================== UPDATED MENU COMMAND ====================

registerCommand('menu', async (sock, msg, args, user) => {
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  const isOwner = senderPhone === ownerPhone;
  
  const categories = {
    '👥 GROUP MGMT (19)': ['tagall', 'hidetag', 'kick', 'add', 'promote', 'demote', 'setname', 'setdesc', 'groupinfo', 'link', 'revoke', 'antilink', 'welcome', 'goodbye', 'mute', 'unmute', 'delete', 'tagadmin', 'everyone'],
    '🛡️ MODERATION (8)': ['warn', 'unwarn', 'warnings', 'ban', 'unban', 'banlist', 'filter', 'antispam'],
    '🤖 AI TOOLS (7)': ['ai', 'gpt', 'imagine', 'imaginefast', 'imagineanime', 'imaginereal', 'translate', 'summarize', 'chatbot', 'remind', 'ocr', 'tts', 'anime', 'code', 'fix', 'explain'],
    '💰 ECONOMY (8)': ['balance', 'daily', 'deposit', 'withdraw', 'transfer', 'top', 'level', 'leaderboard', 'rob', 'work', 'crime', 'slut'],
    '🎮 GAMES (9)': ['slot', 'roulette', 'trivia', 'tictactoe', 'move', 'rps', 'blackjack', 'hangman', 'guess'],
    '😂 FUN (15)': ['joke', 'quote', 'roll', 'flip', 'choose', 'rate', 'gaycheck', 'marry', 'acceptmarry', 'divorce', 'ship', '8ball', 'meme', 'fact', 'roast', 'compliment'],
    '🛠️ UTILITY (18)': ['ping', 'uptime', 'serverinfo', 'calc', 'convert', 'qr', 'shorten', 'password', 'whois', 'weather', 'news', 'crypto', 'bin', 'ip', 'github', 'define', 'movie', 'npm'],
    '📺 MEDIA (20)': ['sticker', 'toimg', 'vv', 'save', 'play', 'playvn', 'ytsearch', 'tiktok', 'ig', 'fb', 'x', 'lyrics', 'spotify', 'pinterest', 'dlvn', 'toaudio', 'tomp3', 'audiomeme', 'text2img'],
    '👑 OWNER (8)': isOwner ? ['broadcast', 'setpp', 'block', 'unblock', 'stats', 'exec', 'eval', 'restart'] : []
  };
  
  let menuText = `╔══════════════════════════════════╗
║  🤖 WIZ AI PRO ULTRA 🤖          ║
║  ⚡ 250+ COMMANDS ⚡              ║
║  🌟 VERSION 3.0 PREMIUM 🌟       ║
╚══════════════════════════════════╝

👑 Owner: ${user.username || 'WISDOM'}
📱 Status: ONLINE ✅
🤖 Smart AI: Enabled
🔄 Auto-Reply: 4 messages max

`;
  
  for (const [cat, cmds] of Object.entries(categories)) {
    if (cmds.length === 0) continue;
    menuText += `\n${cat}\n`;
    menuText += cmds.map(c => `• .${c}`).join('  ');
    menuText += '\n';
  }
  
  menuText += `\n📢 Channel: https://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17

⚡ Powered by Wiz AI Pro v3.0
💡 Use .help <command> for details
🤖 Smart bot that knows when to stop!`;
  
  return menuText;
}, { category: 'info' });

// Export owner status
module.exports = {
  ownerStatusMap,
  isOwnerOnline: (userId) => {
    const status = ownerStatusMap.get(userId);
    if (!status) return false;
    return Date.now() - status.lastActivity < 5 * 60 * 1000;
  },
  updateOwnerActivity: (userId, phone) => {
    ownerStatusMap.set(userId, {
      lastActivity: Date.now(),
      phone: phone
    });
  }
};
