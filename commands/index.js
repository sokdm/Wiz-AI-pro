const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');

const commands = {};

function registerCommand(name, handler, options = {}) {
  commands[name] = { handler, ...options };
}

const getGroupMetadata = async (sock, jid) => {
  try {
    return await sock.groupMetadata(jid);
  } catch {
    return null;
  }
};

const isAdmin = async (sock, jid, participant) => {
  try {
    const group = await getGroupMetadata(sock, jid);
    return group.participants.find(p => p.id === participant)?.admin !== null;
  } catch {
    return false;
  }
};

const reply = async (sock, jid, text, quoted) => {
  await sock.sendMessage(jid, { text }, { quoted });
};

// 1. Tag All - FIXED
registerCommand('tagall', async (sock, msg, args, user) => {
  try {
    const group = await getGroupMetadata(sock, msg.key.remoteJid);
    if (!group) {
      await reply(sock, msg.key.remoteJid, '❌ This command only works in groups!', msg);
      return;
    }
    
    const participants = group.participants;
    let text = args.join(' ') || '👋 Attention everyone!';
    text += '\n\n';
    
    const emojis = ['🔥', '⚡', '🎯', '💎', '🚀', '⭐', '💪', '👑', '🎉', '✨', '🌟', '💫', '🎊', '🎁', '🎀'];
    
    participants.forEach((p, i) => {
      text += `${emojis[i % emojis.length]} @${p.id.split('@')[0]}\n`;
    });
    
    await sock.sendMessage(msg.key.remoteJid, {
      text,
      mentions: participants.map(p => p.id)
    });
    
    await reply(sock, msg.key.remoteJid, `✅ Tagged ${participants.length} members`, msg);
    return null;
  } catch (err) {
    console.error('Tagall error:', err);
    await reply(sock, msg.key.remoteJid, '❌ Failed: ' + err.message, msg);
    return null;
  }
}, { category: 'group', adminOnly: true });

// 2. Hide Tag
registerCommand('hidetag', async (sock, msg, args, user) => {
  const group = await getGroupMetadata(sock, msg.key.remoteJid);
  if (!group) return reply(sock, msg.key.remoteJid, '❌ Group only!', msg);
  
  const text = args.join(' ') || '👻 Hidden message';
  await sock.sendMessage(msg.key.remoteJid, {
    text,
    mentions: group.participants.map(p => p.id)
  });
  return '✅ Hidden tag sent';
}, { category: 'group', adminOnly: true });

// 3. Kick
registerCommand('kick', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) {
    return reply(sock, msg.key.remoteJid, '❌ Mention someone to kick!', msg);
  }
  try {
    await sock.groupParticipantsUpdate(msg.key.remoteJid, [target], 'remove');
    return '👢 User kicked';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 4. Add
registerCommand('add', async (sock, msg, args, user) => {
  const number = args[0];
  if (!number) return reply(sock, msg.key.remoteJid, '❌ Provide number!', msg);
  
  const cleanNumber = number.replace(/[^0-9]/g, '');
  const jid = `${cleanNumber}@s.whatsapp.net`;
  
  try {
    await sock.groupParticipantsUpdate(msg.key.remoteJid, [jid], 'add');
    return '➕ User added';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 5. Promote
registerCommand('promote', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return reply(sock, msg.key.remoteJid, '❌ Mention someone!', msg);
  
  try {
    await sock.groupParticipantsUpdate(msg.key.remoteJid, [target], 'promote');
    return '⬆️ Promoted to admin';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 6. Demote
registerCommand('demote', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return reply(sock, msg.key.remoteJid, '❌ Mention someone!', msg);
  
  try {
    await sock.groupParticipantsUpdate(msg.key.remoteJid, [target], 'demote');
    return '⬇️ Demoted from admin';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 7. Set Name
registerCommand('setname', async (sock, msg, args, user) => {
  const name = args.join(' ');
  if (!name) return reply(sock, msg.key.remoteJid, '❌ Provide group name!', msg);
  
  try {
    await sock.groupUpdateSubject(msg.key.remoteJid, name);
    return '✏️ Group name updated';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 8. Set Desc
registerCommand('setdesc', async (sock, msg, args, user) => {
  const desc = args.join(' ');
  if (!desc) return reply(sock, msg.key.remoteJid, '❌ Provide description!', msg);
  
  try {
    await sock.groupUpdateDescription(msg.key.remoteJid, desc);
    return '📝 Description updated';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 9. Group Info
registerCommand('groupinfo', async (sock, msg, args, user) => {
  const group = await getGroupMetadata(sock, msg.key.remoteJid);
  if (!group) return '❌ Not a group';
  
  let text = `📊 *Group Info*\n\n`;
  text += `*Name:* ${group.subject}\n`;
  text += `*Members:* ${group.participants.length}\n`;
  text += `*Created:* ${new Date(group.creation * 1000).toLocaleDateString()}\n`;
  text += `*Owner:* @${group.owner?.split('@')[0] || 'Unknown'}\n`;
  text += `*Admins:* ${group.participants.filter(p => p.admin).length}\n`;
  text += `*Description:* ${group.desc || 'No description'}`;
  
  await sock.sendMessage(msg.key.remoteJid, { text, mentions: [group.owner] });
  return 'Info sent';
}, { category: 'group' });

// 10. Link
registerCommand('link', async (sock, msg, args, user) => {
  try {
    const code = await sock.groupInviteCode(msg.key.remoteJid);
    return `🔗 *Group Link:*\nhttps://chat.whatsapp.com/${code}`;
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 11. Revoke
registerCommand('revoke', async (sock, msg, args, user) => {
  try {
    await sock.groupRevokeInvite(msg.key.remoteJid);
    return '♻️ Link revoked';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 12. Antilink
const antilinkGroups = new Set();
registerCommand('antilink', async (sock, msg, args, user) => {
  const action = args[0]?.toLowerCase();
  if (action === 'on') {
    antilinkGroups.add(msg.key.remoteJid);
    return '🔒 Antilink enabled';
  } else if (action === 'off') {
    antilinkGroups.delete(msg.key.remoteJid);
    return '🔓 Antilink disabled';
  }
  return 'Usage: .antilink on/off';
}, { category: 'group', adminOnly: true });

// 13. Welcome
const welcomeGroups = new Set();
registerCommand('welcome', async (sock, msg, args, user) => {
  const action = args[0]?.toLowerCase();
  if (action === 'on') {
    welcomeGroups.add(msg.key.remoteJid);
    return '👋 Welcome enabled';
  } else if (action === 'off') {
    welcomeGroups.delete(msg.key.remoteJid);
    return '👋 Welcome disabled';
  }
  return 'Usage: .welcome on/off';
}, { category: 'group', adminOnly: true });

// 14. Goodbye
const goodbyeGroups = new Set();
registerCommand('goodbye', async (sock, msg, args, user) => {
  const action = args[0]?.toLowerCase();
  if (action === 'on') {
    goodbyeGroups.add(msg.key.remoteJid);
    return '👋 Goodbye enabled';
  } else if (action === 'off') {
    goodbyeGroups.delete(msg.key.remoteJid);
    return '👋 Goodbye disabled';
  }
  return 'Usage: .goodbye on/off';
}, { category: 'group', adminOnly: true });

// 15. Mute
registerCommand('mute', async (sock, msg, args, user) => {
  try {
    await sock.groupSettingUpdate(msg.key.remoteJid, 'announcement');
    return '🔇 Group muted';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 16. Unmute
registerCommand('unmute', async (sock, msg, args, user) => {
  try {
    await sock.groupSettingUpdate(msg.key.remoteJid, 'not_announcement');
    return '🔊 Group unmuted';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 17. Delete
registerCommand('delete', async (sock, msg, args, user) => {
  const quoted = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
  const participant = msg.message.extendedTextMessage?.contextInfo?.participant;
  
  if (!quoted) return reply(sock, msg.key.remoteJid, '❌ Reply to a message!', msg);

  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      delete: {
        remoteJid: msg.key.remoteJid,
        fromMe: false,
        id: quoted,
        participant: participant
      }
    });
    return '🗑️ Message deleted';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 18. Get Admin
registerCommand('getadmin', async (sock, msg, args, user) => {
  try {
    await sock.groupParticipantsUpdate(msg.key.remoteJid, [msg.key.participant], 'promote');
    return '👑 You are now admin';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', ownerOnly: true });

// 19. Tag Admin
registerCommand('tagadmin', async (sock, msg, args, user) => {
  const group = await getGroupMetadata(sock, msg.key.remoteJid);
  const admins = group.participants.filter(p => p.admin);
  
  let text = args.join(' ') || '📢 Attention admins!';
  text += '\n\n';
  
  admins.forEach((admin, i) => {
    text += `${i+1}. @${admin.id.split('@')[0]}\n`;
  });
  
  await sock.sendMessage(msg.key.remoteJid, { text, mentions: admins.map(a => a.id) });
  return `Tagged ${admins.length} admins`;
}, { category: 'group' });

// 20. Everyone
registerCommand('everyone', async (sock, msg, args, user) => {
  const group = await getGroupMetadata(sock, msg.key.remoteJid);
  const text = args.join(' ') || '📢 @everyone';
  
  await sock.sendMessage(msg.key.remoteJid, {
    text,
    mentions: group.participants.map(p => p.id)
  });
  return 'Everyone tagged';
}, { category: 'group', adminOnly: true });
// 21. Ping
registerCommand('ping', async (sock, msg, args, user) => {
  const start = Date.now();
  await reply(sock, msg.key.remoteJid, 'Testing...', msg);
  const end = Date.now();
  return `🏓 Pong! ${end - start}ms`;
}, { category: 'utility' });

// 22. Uptime
registerCommand('uptime', async (sock, msg, args, user) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  return `⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s`;
}, { category: 'utility' });

// 23. Server Info
registerCommand('serverinfo', async (sock, msg, args, user) => {
  const os = require('os');
  let text = `🖥️ *Server Info*\n\n`;
  text += `*Platform:* ${os.platform()}\n`;
  text += `*Arch:* ${os.arch()}\n`;
  text += `*CPU:* ${os.cpus()[0].model}\n`;
  text += `*RAM:* ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
  text += `*Free RAM:* ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
  text += `*Node:* ${process.version}`;
  return text;
}, { category: 'utility' });

// 24. Joke
registerCommand('joke', async (sock, msg, args, user) => {
  try {
    const res = await axios.get('https://official-joke-api.appspot.com/random_joke');
    return `😂 *${res.data.setup}*\n\n${res.data.punchline}`;
  } catch {
    return '❌ Could not fetch joke';
  }
}, { category: 'fun' });

// 25. Quote
registerCommand('quote', async (sock, msg, args, user) => {
  const quotes = [
    "The only way to do great work is to love what you do. - Steve Jobs",
    "Stay hungry, stay foolish. - Steve Jobs",
    "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt"
  ];
  return `💭 ${quotes[Math.floor(Math.random() * quotes.length)]}`;
}, { category: 'fun' });

// 26. Roll
registerCommand('roll', async (sock, msg, args, user) => {
  return `🎲 You rolled: ${Math.floor(Math.random() * 6) + 1}`;
}, { category: 'fun' });

// 27. Flip
registerCommand('flip', async (sock, msg, args, user) => {
  return `🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`;
}, { category: 'fun' });

// 28. Choose
registerCommand('choose', async (sock, msg, args, user) => {
  if (args.length < 2) return '❌ Provide 2+ options with |';
  const options = args.join(' ').split('|').map(s => s.trim());
  return `🤔 I choose: *${options[Math.floor(Math.random() * options.length)]}*`;
}, { category: 'fun' });

// 29. Rate
registerCommand('rate', async (sock, msg, args, user) => {
  const thing = args.join(' ') || 'you';
  return `⭐ I rate *${thing}* ${Math.floor(Math.random() * 10) + 1}/10`;
}, { category: 'fun' });

// 30. Gay Check
registerCommand('gaycheck', async (sock, msg, args, user) => {
  const percent = Math.floor(Math.random() * 101);
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const name = target ? `@${target.split('@')[0]}` : args.join(' ') || 'You';
  return `🏳️‍🌈 *Gay Check*\n${name} is ${percent}% gay`;
}, { category: 'fun' });

// 31. Sticker
registerCommand('sticker', async (sock, msg, args, user) => {
  const quoted = msg.message.extendedTextMessage?.contextInfo;
  if (!quoted) return reply(sock, msg.key.remoteJid, '❌ Reply to an image/video!', msg);
  
  try {
    const messageToDownload = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: quoted.stanzaId,
        participant: quoted.participant
      }
    };
    await downloadMediaMessage(messageToDownload, 'buffer', {}, { logger: console });
    return '✅ Downloaded (sticker needs sharp library)';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 32. To Image
registerCommand('toimg', async (sock, msg, args, user) => {
  return '🖼️ Needs sharp library';
}, { category: 'media' });

// 33. VV - FIXED
registerCommand('vv', async (sock, msg, args, user) => {
  try {
    const quoted = msg.message.extendedTextMessage?.contextInfo;
    if (!quoted) {
      return reply(sock, msg.key.remoteJid, '❌ Reply to a view-once message!', msg);
    }

    const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
    if (!quotedMessage) {
      return reply(sock, msg.key.remoteJid, '❌ Could not load quoted message!', msg);
    }

    const isViewOnceImage = quotedMessage.imageMessage?.viewOnce === true;
    const isViewOnceVideo = quotedMessage.videoMessage?.viewOnce === true;

    if (!isViewOnceImage && !isViewOnceVideo) {
      return reply(sock, msg.key.remoteJid, '❌ Not a view-once message!', msg);
    }

    const messageToDownload = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: quoted.stanzaId,
        participant: quoted.participant || msg.key.remoteJid
      },
      message: quotedMessage
    };

    const buffer = await downloadMediaMessage(messageToDownload, 'buffer', {}, { logger: console });

    if (!buffer) {
      return reply(sock, msg.key.remoteJid, '❌ Failed to download!', msg);
    }

    if (isViewOnceImage) {
      await sock.sendMessage(msg.key.remoteJid, {
        image: buffer,
        caption: '💾 View-once saved!\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
    } else {
      await sock.sendMessage(msg.key.remoteJid, {
        video: buffer,
        caption: '💾 View-once saved!\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
    }

    return null;
  } catch (err) {
    console.error('VV error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 34. Save - FIXED
registerCommand('save', async (sock, msg, args, user) => {
  try {
    const quoted = msg.message.extendedTextMessage?.contextInfo;
    if (!quoted) {
      return reply(sock, msg.key.remoteJid, '❌ Reply to a media message!', msg);
    }

    const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
    if (!quotedMessage) {
      return reply(sock, msg.key.remoteJid, '❌ Could not load message!', msg);
    }

    const hasImage = quotedMessage.imageMessage;
    const hasVideo = quotedMessage.videoMessage;
    const hasAudio = quotedMessage.audioMessage;
    const hasDocument = quotedMessage.documentMessage;

    if (!hasImage && !hasVideo && !hasAudio && !hasDocument) {
      return reply(sock, msg.key.remoteJid, '❌ No media found!', msg);
    }

    const messageToDownload = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: quoted.stanzaId,
        participant: quoted.participant || msg.key.remoteJid
      },
      message: quotedMessage
    };

    const buffer = await downloadMediaMessage(messageToDownload, 'buffer', {}, { logger: console });

    if (!buffer) {
      return reply(sock, msg.key.remoteJid, '❌ Failed to download!', msg);
    }

    if (hasImage) {
      await sock.sendMessage(msg.key.remoteJid, {
        image: buffer,
        caption: '💾 Saved!\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
    } else if (hasVideo) {
      await sock.sendMessage(msg.key.remoteJid, {
        video: buffer,
        caption: '💾 Saved!\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
    } else if (hasAudio) {
      await sock.sendMessage(msg.key.remoteJid, {
        audio: buffer,
        mimetype: hasAudio.mimetype || 'audio/mp4',
        ptt: hasAudio.ptt || false
      }, { quoted: msg });
    } else if (hasDocument) {
      await sock.sendMessage(msg.key.remoteJid, {
        document: buffer,
        mimetype: hasDocument.mimetype,
        fileName: hasDocument.fileName || 'saved_file'
      }, { quoted: msg });
    }

    return null;
  } catch (err) {
    console.error('Save error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 35-40. Placeholders for downloaders
registerCommand('play', async (sock, msg, args, user) => {
  return '🎵 Needs implementation';
}, { category: 'media' });

registerCommand('ytsearch', async (sock, msg, args, user) => {
  return '🔍 Needs implementation';
}, { category: 'media' });

registerCommand('tiktok', async (sock, msg, args, user) => {
  return '📱 Needs implementation';
}, { category: 'media' });

registerCommand('ig', async (sock, msg, args, user) => {
  return '📷 Needs implementation';
}, { category: 'media' });

registerCommand('fb', async (sock, msg, args, user) => {
  return '📘 Needs implementation';
}, { category: 'media' });

registerCommand('x', async (sock, msg, args, user) => {
  return '🐦 Needs implementation';
}, { category: 'media' });
// 41. AI
registerCommand('ai', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Ask me anything!';
  
  try {
    const response = await axios.post(process.env.DEEPSEEK_API_URL, {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` }
    });
    return `🤖 *AI Response:*\n\n${response.data.choices[0].message.content}`;
  } catch (err) {
    return '❌ AI unavailable';
  }
}, { category: 'ai' });

// 42. GPT
registerCommand('gpt', async (sock, msg, args, user) => {
  return await commands['ai'].handler(sock, msg, args, user);
}, { category: 'ai' });

// 43-45. Placeholders
registerCommand('imagine', async (sock, msg, args, user) => {
  return '🎨 Needs implementation';
}, { category: 'ai' });

registerCommand('translate', async (sock, msg, args, user) => {
  return '🌐 Needs implementation';
}, { category: 'ai' });

registerCommand('summarize', async (sock, msg, args, user) => {
  return '📝 Needs implementation';
}, { category: 'ai' });

// 46. Broadcast
registerCommand('broadcast', async (sock, msg, args, user) => {
  return '📢 Needs implementation';
}, { category: 'owner', ownerOnly: true });

// 47. Set PP
registerCommand('setpp', async (sock, msg, args, user) => {
  return '🖼️ Needs implementation';
}, { category: 'owner' });

// 48. Block
registerCommand('block', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                 (args[0] ? args[0] + '@s.whatsapp.net' : null);
  if (!target) return '❌ Mention user or provide number!';
  
  await sock.updateBlockStatus(target, 'block');
  return '🚫 User blocked';
}, { category: 'owner' });

// 49. Unblock
registerCommand('unblock', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                 (args[0] ? args[0] + '@s.whatsapp.net' : null);
  if (!target) return '❌ Mention user or provide number!';
  
  await sock.updateBlockStatus(target, 'unblock');
  return '✅ User unblocked';
}, { category: 'owner' });

// 50. Stats
registerCommand('stats', async (sock, msg, args, user) => {
  return `📊 *Bot Stats*\nCommands: 50+\nUptime: ${Math.floor(process.uptime())}s`;
}, { category: 'owner' });

// 51. Help - with channel link
registerCommand('help', async (sock, msg, args, user) => {
  let text = `🤖 *WIZ AI PRO COMMANDS*\n\n`;
  text += `*Group:*\n.tagall, .hidetag, .kick, .add, .promote, .demote, .setname, .setdesc, .groupinfo, .link, .revoke, .antilink, .welcome, .goodbye, .mute, .unmute, .delete, .tagadmin, .everyone\n\n`;
  text += `*AI:*\n.ai, .gpt, .imagine, .translate, .summarize\n\n`;
  text += `*Media:*\n.sticker, .toimg, .vv, .save, .play, .ytsearch, .tiktok, .ig, .fb, .x\n\n`;
  text += `*Fun:*\n.joke, .quote, .roll, .flip, .choose, .rate, .gaycheck\n\n`;
  text += `*Utility:*\n.ping, .uptime, .serverinfo, .help\n\n`;
  text += `*Owner:*\n.broadcast, .setpp, .block, .unblock, .stats\n\n`;
  text += `📢 *Join Channel:*\nhttps://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17`;
  return text;
}, { category: 'utility' });

// 52. Menu
registerCommand('menu', async (sock, msg, args, user) => {
  return await commands['help'].handler(sock, msg, args, user);
}, { category: 'utility' });

// Export
module.exports = {
  commands,
  registerCommand,
  antilinkGroups,
  welcomeGroups,
  goodbyeGroups,
  getGroupMetadata,
  isAdmin,
  reply
};
