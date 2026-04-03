const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { commands, registerCommand, reply } = require('./commands_part1');

// 21. Ping
registerCommand('ping', async (sock, msg, args, user) => {
  const start = Date.now();
  const tempMsg = await sock.sendMessage(msg.key.remoteJid, { text: 'Testing...' });
  const end = Date.now();
  await sock.sendMessage(msg.key.remoteJid, { delete: tempMsg.key });
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

module.exports = { registerCommand };
