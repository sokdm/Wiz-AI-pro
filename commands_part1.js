const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const cheerio = require('cheerio');
const ytdl = require('@distube/ytdl-core');
const { pipeline } = require('stream/promises');

const commands = {};
const antilinkGroups = new Set();
const welcomeGroups = new Set();
const goodbyeGroups = new Set();

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
    if (!group) return false;
    const p = group.participants.find(p => p.id === participant);
    return p && (p.admin === 'admin' || p.admin === 'superadmin');
  } catch {
    return false;
  }
};

const reply = async (sock, jid, text, quoted) => {
  await sock.sendMessage(jid, { text }, { quoted });
};

// 1. Tag All
registerCommand('tagall', async (sock, msg, args, user) => {
  try {
    const group = await getGroupMetadata(sock, msg.key.remoteJid);
    if (!group) {
      return '❌ This command only works in groups!';
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
    
    return null;
  } catch (err) {
    console.error('Tagall error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'group', adminOnly: true });

// 2. Hide Tag
registerCommand('hidetag', async (sock, msg, args, user) => {
  const group = await getGroupMetadata(sock, msg.key.remoteJid);
  if (!group) return '❌ Group only!';
  
  const text = args.join(' ') || '👻 Hidden message';
  await sock.sendMessage(msg.key.remoteJid, {
    text,
    mentions: group.participants.map(p => p.id)
  });
  return null;
}, { category: 'group', adminOnly: true });

// 3. Kick
registerCommand('kick', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) {
    return '❌ Mention someone to kick!';
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
  if (!number) return '❌ Provide number!';
  
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
  if (!target) return '❌ Mention someone!';
  
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
  if (!target) return '❌ Mention someone!';
  
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
  if (!name) return '❌ Provide group name!';
  
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
  if (!desc) return '❌ Provide description!';
  
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
  return null;
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
  
  if (!quoted) return '❌ Reply to a message!';

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
  return null;
}, { category: 'group' });

// 20. Everyone
registerCommand('everyone', async (sock, msg, args, user) => {
  const group = await getGroupMetadata(sock, msg.key.remoteJid);
  const text = args.join(' ') || '📢 @everyone';
  
  await sock.sendMessage(msg.key.remoteJid, {
    text,
    mentions: group.participants.map(p => p.id)
  });
  return null;
}, { category: 'group', adminOnly: true });

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
