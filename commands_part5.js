const fs = require('fs-extra');
const path = require('path');
const { commands, registerCommand, getGroupMetadata, isAdmin, reply } = require('./commands_part1');

// Data storage paths
const DATA_DIR = path.join(__dirname, 'data');
const WARNINGS_FILE = path.join(DATA_DIR, 'warnings.json');
const BANS_FILE = path.join(DATA_DIR, 'bans.json');
const FILTERS_FILE = path.join(DATA_DIR, 'filters.json');
const ANTISPAM_FILE = path.join(DATA_DIR, 'antispam.json');

// Ensure data directory exists
fs.ensureDirSync(DATA_DIR);

// Load data
const loadData = (file) => {
  try {
    return fs.readJsonSync(file);
  } catch {
    return {};
  }
};

const saveData = (file, data) => {
  fs.writeJsonSync(file, data, { spaces: 2 });
};

// In-memory caches
const warnings = loadData(WARNINGS_FILE);
const bans = loadData(BANS_FILE);
const filters = loadData(FILTERS_FILE);
const antispamGroups = new Set(loadData(ANTISPAM_FILE).groups || []);
const spamTracker = new Map();

// Helper: Check if user is banned
const isBanned = (groupId, userId) => {
  const groupBans = bans[groupId] || [];
  return groupBans.includes(userId);
};

// Helper: Get warnings count
const getWarnings = (groupId, userId) => {
  const groupWarns = warnings[groupId] || {};
  return groupWarns[userId] || 0;
};

// 53. Warn - Add warning to user
registerCommand('warn', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  
  if (!target) return '❌ Mention someone to warn!';
  
  const reason = args.slice(1).join(' ') || 'No reason provided';
  
  if (!warnings[groupId]) warnings[groupId] = {};
  if (!warnings[groupId][target]) warnings[groupId][target] = 0;
  
  warnings[groupId][target]++;
  saveData(WARNINGS_FILE, warnings);
  
  const warnCount = warnings[groupId][target];
  let response = `⚠️ *Warning ${warnCount}/3*\n\n`;
  response += `👤 User: @${target.split('@')[0]}\n`;
  response += `📋 Reason: ${reason}\n`;
  response += `👮 By: @${msg.key.participant?.split('@')[0] || 'Admin'}`;
  
  // Auto-kick on 3 warnings
  if (warnCount >= 3) {
    try {
      await sock.groupParticipantsUpdate(groupId, [target], 'remove');
      response += `\n\n👢 *Auto-kicked: 3 warnings reached!*`;
      delete warnings[groupId][target];
      saveData(WARNINGS_FILE, warnings);
    } catch (err) {
      response += `\n\n❌ Failed to kick: ${err.message}`;
    }
  }
  
  await sock.sendMessage(groupId, { 
    text: response, 
    mentions: [target, msg.key.participant] 
  });
  return null;
}, { category: 'group', adminOnly: true });

// 54. Unwarn - Remove warning
registerCommand('unwarn', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  
  if (!target) return '❌ Mention someone!';
  
  if (!warnings[groupId] || !warnings[groupId][target]) {
    return '✅ User has no warnings';
  }
  
  warnings[groupId][target]--;
  if (warnings[groupId][target] <= 0) {
    delete warnings[groupId][target];
  }
  saveData(WARNINGS_FILE, warnings);
  
  return `✅ Warning removed from @${target.split('@')[0]}\nRemaining: ${warnings[groupId][target] || 0}/3`;
}, { category: 'group', adminOnly: true });

// 55. Warnings - Check user warnings
registerCommand('warnings', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                 msg.key.participant;
  
  const count = getWarnings(groupId, target);
  
  return `⚠️ *Warnings Check*\n\n👤 @${target.split('@')[0]}\nWarnings: ${count}/3\n\n${count >= 2 ? '🔴 Careful! One more = kick!' : count === 0 ? '🟢 Clean record!' : '🟡 Watch out!'}`;
}, { category: 'group' });

// 56. Ban - Permanent ban
registerCommand('ban', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  
  if (!target) return '❌ Mention someone to ban!';
  
  if (!bans[groupId]) bans[groupId] = [];
  if (!bans[groupId].includes(target)) {
    bans[groupId].push(target);
    saveData(BANS_FILE, bans);
  }
  
  // Also kick them
  try {
    await sock.groupParticipantsUpdate(groupId, [target], 'remove');
  } catch {}
  
  return `🚫 *Banned*\n\n@${target.split('@')[0]} is now permanently banned from rejoining.`;
}, { category: 'group', adminOnly: true });

// 57. Unban - Remove ban
registerCommand('unban', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  
  if (!target) return '❌ Mention someone!';
  
  if (!bans[groupId]) return '✅ No bans in this group';
  
  bans[groupId] = bans[groupId].filter(id => id !== target);
  saveData(BANS_FILE, bans);
  
  return `✅ @${target.split('@')[0]} unbanned. They can now rejoin.`;
}, { category: 'group', adminOnly: true });

// 58. Banlist - List banned users
registerCommand('banlist', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const groupBans = bans[groupId] || [];
  
  if (groupBans.length === 0) return '📋 No banned users in this group';
  
  let text = `🚫 *Banned Users (${groupBans.length})*\n\n`;
  groupBans.forEach((id, i) => {
    text += `${i + 1}. @${id.split('@')[0]}\n`;
  });
  
  await sock.sendMessage(groupId, { text, mentions: groupBans });
  return null;
}, { category: 'group', adminOnly: true });

// 59. Filter - Add banned words
registerCommand('filter', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const action = args[0]?.toLowerCase();
  
  if (action === 'add') {
    const word = args[1]?.toLowerCase();
    if (!word) return '❌ Usage: .filter add <word>';
    
    if (!filters[groupId]) filters[groupId] = [];
    if (!filters[groupId].includes(word)) {
      filters[groupId].push(word);
      saveData(FILTERS_FILE, filters);
    }
    return `🚫 Filter added: "${word}"`;
    
  } else if (action === 'remove') {
    const word = args[1]?.toLowerCase();
    if (!word) return '❌ Usage: .filter remove <word>';
    
    if (!filters[groupId]) return '❌ No filters set';
    filters[groupId] = filters[groupId].filter(w => w !== word);
    saveData(FILTERS_FILE, filters);
    return `✅ Filter removed: "${word}"`;
    
  } else if (action === 'list') {
    const groupFilters = filters[groupId] || [];
    if (groupFilters.length === 0) return '📋 No filtered words';
    return `🚫 *Filtered Words:*\n${groupFilters.join(', ')}`;
    
  } else if (action === 'on') {
    if (!filters[groupId]) filters[groupId] = [];
    saveData(FILTERS_FILE, filters);
    return '🔒 Word filter enabled';
    
  } else if (action === 'off') {
    delete filters[groupId];
    saveData(FILTERS_FILE, filters);
    return '🔓 Word filter disabled';
  }
  
  return 'Usage: .filter add/remove/list/on/off <word>';
}, { category: 'group', adminOnly: true });

// 60. Antispam - Toggle anti-spam
registerCommand('antispam', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const action = args[0]?.toLowerCase();
  
  if (action === 'on') {
    antispamGroups.add(groupId);
    const data = { groups: Array.from(antispamGroups) };
    saveData(ANTISPAM_FILE, data);
    return '🛡️ Antispam enabled (5 messages/10s = mute 5min)';
  } else if (action === 'off') {
    antispamGroups.delete(groupId);
    const data = { groups: Array.from(antispamGroups) };
    saveData(ANTISPAM_FILE, data);
    return '🔓 Antispam disabled';
  }
  
  return 'Usage: .antispam on/off';
}, { category: 'group', adminOnly: true });

// Export for use in message handler
module.exports = { 
  commands, 
  warnings, 
  bans, 
  filters, 
  antispamGroups, 
  spamTracker,
  isBanned,
  getWarnings 
};
