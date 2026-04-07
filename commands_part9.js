const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { commands, registerCommand, getGroupMetadata } = require('./commands_part1');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const crypto = require('crypto');

// ==================== ADVANCED GROUP COMMANDS ====================

registerCommand('admins', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const groupMeta = await getGroupMetadata(sock, groupId);
  const admins = groupMeta.participants.filter(p => 
    p.admin === 'admin' || p.admin === 'superadmin'
  );
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   👑 ADMINS
╚═══❖•ೋ° °ೋ•❖═══╝

${admins.map((a, i) => `${i+1}. @${a.id.split('@')[0]}`).join('\n')}`;
}, { category: 'group' });

registerCommand('request', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const text = args.join(' ') || 'Requesting admin help!';
  const groupMeta = await getGroupMetadata(sock, groupId);
  const admins = groupMeta.participants.filter(p => 
    p.admin === 'admin' || p.admin === 'superadmin'
  );
  
  const mentions = admins.map(a => a.id);
  await sock.sendMessage(groupId, {
    text: `📢 *ADMIN REQUEST*\n\n@${msg.key.participant?.split('@')[0] || msg.key.remoteJid.split('@')[0]}:\n${text}`,
    mentions: [...mentions, msg.key.participant || msg.key.remoteJid]
  });
  return null;
}, { category: 'group' });

registerCommand('report', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const reason = args.join(' ') || 'No reason given';
  
  if (!target) return '❌ Mention user to report!';
  
  const groupId = msg.key.remoteJid;
  const groupMeta = await getGroupMetadata(sock, groupId);
  const admins = groupMeta.participants.filter(p => 
    p.admin === 'admin' || p.admin === 'superadmin'
  );
  
  const mentions = admins.map(a => a.id);
  await sock.sendMessage(groupId, {
    text: `🚨 *USER REPORT*\n\nReported: @${target.split('@')[0]}\nBy: @${msg.key.participant?.split('@')[0] || 'User'}\nReason: ${reason}`,
    mentions: [...mentions, target, msg.key.participant || msg.key.remoteJid]
  });
  return null;
}, { category: 'group' });

// ==================== ADVANCED MODERATION ====================

registerCommand('tempban', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const duration = parseInt(args[1]);
  const unit = args[2]?.toLowerCase();
  
  if (!target || !duration || !['m', 'h', 'd'].includes(unit)) {
    return '❌ Usage: .tempban @user <duration> <m/h/d>\nExample: .tempban @user 30 m';
  }
  
  await sock.groupParticipantsUpdate(groupId, [target], 'remove');
  
  const ms = unit === 'm' ? duration * 60000 : unit === 'h' ? duration * 3600000 : duration * 86400000;
  
  setTimeout(async () => {
    try {
      await sock.groupParticipantsUpdate(groupId, [target], 'add');
      await sock.sendMessage(groupId, {
        text: `⏰ @${target.split('@')[0]} ban expired and re-added!`
      });
    } catch (e) {}
  }, ms);
  
  return `🚫 @${target.split('@')[0]} banned for ${duration}${unit}!\n⏰ Will be unbanned automatically.`;
}, { category: 'moderation', adminOnly: true });

registerCommand('muteuser', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const duration = parseInt(args[1]) || 5;
  
  if (!target) return '❌ Mention user to mute!';
  
  if (!global.mutedUsers) global.mutedUsers = new Map();
  const key = `${groupId}-${target}`;
  global.mutedUsers.set(key, Date.now() + (duration * 60000));
  
  return `🔇 @${target.split('@')[0]} muted for ${duration} minutes!`;
}, { category: 'moderation', adminOnly: true });

registerCommand('unmuteuser', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention user to unmute!';
  
  const key = `${groupId}-${target}`;
  if (global.mutedUsers?.has(key)) {
    global.mutedUsers.delete(key);
    return `🔊 @${target.split('@')[0]} unmuted!`;
  }
  return '⚠️ User was not muted';
}, { category: 'moderation', adminOnly: true });

// ==================== ADVANCED AI COMMANDS ====================

registerCommand('code', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Usage: .code <programming question>';
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '💻 Generating code...' }, { quoted: msg });
    
    const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a programming expert. Provide clean, well-commented code with explanations.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1500
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return `💻 *Code Assistant:*\n\n${response.data.choices[0].message.content}`;
  } catch (err) {
    return '❌ Code generation failed.';
  }
}, { category: 'ai' });

registerCommand('fix', async (sock, msg, args, user) => {
  const code = args.join(' ');
  if (!code) return '❌ Usage: .fix <your buggy code>';
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '🔧 Debugging...' }, { quoted: msg });
    
    const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Fix the following code and explain what was wrong:' },
        { role: 'user', content: code }
      ],
      max_tokens: 1500
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return `🔧 *Fixed Code:*\n\n${response.data.choices[0].message.content}`;
  } catch (err) {
    return '❌ Debug failed.';
  }
}, { category: 'ai' });

registerCommand('explain', async (sock, msg, args, user) => {
  const text = args.join(' ');
  if (!text) return '❌ Usage: .explain <topic or code>';
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '📚 Explaining...' }, { quoted: msg });
    
    const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Explain this in simple terms that anyone can understand:' },
        { role: 'user', content: text }
      ],
      max_tokens: 1000
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return `📚 *Explanation:*\n\n${response.data.choices[0].message.content}`;
  } catch (err) {
    return '❌ Explanation failed.';
  }
}, { category: 'ai' });

// ==================== ADVANCED ECONOMY ====================

registerCommand('rob', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention user to rob!';
  if (target === msg.key.participant || target === msg.key.remoteJid) return '❌ You cannot rob yourself!';
  
  const lastRob = user.economy?.lastRob || 0;
  if (Date.now() - lastRob < 3600000) return '⏰ You can only rob once per hour!';
  
  const targetUser = await getUser(target);
  if (!targetUser) return '❌ User not found!';
  if (targetUser.economy.wallet < 100) return '❌ This user is too poor to rob!';
  
  const success = Math.random() > 0.6;
  let amount;
  
  if (success) {
    amount = Math.floor(Math.random() * (targetUser.economy.wallet * 0.3)) + 50;
    user.economy.wallet += amount;
    targetUser.economy.wallet -= amount;
    user.economy.lastRob = Date.now();
    await user.save();
    await targetUser.save();
    return `💰 You robbed ₦${amount} from @${target.split('@')[0]}!`;
  } else {
    amount = Math.floor(Math.random() * 200) + 50;
    user.economy.wallet = Math.max(0, user.economy.wallet - amount);
    user.economy.lastRob = Date.now();
    await user.save();
    return `🚔 You got caught and paid ₦${amount} in fines!`;
  }
}, { category: 'economy' });

registerCommand('work', async (sock, msg, args, user) => {
  const lastWork = user.economy?.lastWork || 0;
  if (Date.now() - lastWork < 1800000) return '⏰ You can work again in 30 minutes!';
  
  const jobs = [
    { name: 'Developer', min: 500, max: 1500 },
    { name: 'Designer', min: 400, max: 1200 },
    { name: 'Teacher', min: 300, max: 800 },
    { name: 'Driver', min: 200, max: 600 },
    { name: 'Chef', min: 350, max: 900 }
  ];
  
  const job = jobs[Math.floor(Math.random() * jobs.length)];
  const earned = Math.floor(Math.random() * (job.max - job.min)) + job.min;
  
  user.economy.wallet += earned;
  user.economy.lastWork = Date.now();
  await user.save();
  
  return `💼 You worked as a ${job.name} and earned ₦${earned}!`;
}, { category: 'economy' });

registerCommand('crime', async (sock, msg, args, user) => {
  const lastCrime = user.economy?.lastCrime || 0;
  if (Date.now() - lastCrime < 7200000) return '⏰ You can commit crime again in 2 hours!';
  
  const crimes = [
    { name: 'Hacking', successRate: 0.4, min: 1000, max: 5000 },
    { name: 'Bank Robbery', successRate: 0.3, min: 2000, max: 10000 },
    { name: 'Pickpocket', successRate: 0.6, min: 100, max: 500 },
    { name: 'Drug Deal', successRate: 0.5, min: 500, max: 2000 }
  ];
  
  const crime = crimes[Math.floor(Math.random() * crimes.length)];
  const success = Math.random() < crime.successRate;
  
  user.economy.lastCrime = Date.now();
  
  if (success) {
    const earned = Math.floor(Math.random() * (crime.max - crime.min)) + crime.min;
    user.economy.wallet += earned;
    await user.save();
    return `😈 ${crime.name} successful! You earned ₦${earned}!`;
  } else {
    const fine = Math.floor(Math.random() * 1000) + 500;
    user.economy.wallet = Math.max(0, user.economy.wallet - fine);
    await user.save();
    return `👮 ${crime.name} failed! You paid ₦${fine} in fines!`;
  }
}, { category: 'economy' });

registerCommand('slut', async (sock, msg, args, user) => {
  const lastSlut = user.economy?.lastSlut || 0;
  if (Date.now() - lastSlut < 3600000) return '⏰ You can do this again in 1 hour!';
  
  const earned = Math.floor(Math.random() * 2000) + 500;
  user.economy.wallet += earned;
  user.economy.lastSlut = Date.now();
  await user.save();
  
  const messages = [
    `You flirted with a rich person and got ₦${earned}!`,
    `Someone paid you ₦${earned} for your company!`,
    `You danced at a club and earned ₦${earned}!`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}, { category: 'economy' });

// ==================== MORE GAMES ====================

registerCommand('blackjack', async (sock, msg, args, user) => {
  const bet = parseInt(args[0]);
  if (!bet || bet <= 0) return '❌ Usage: .blackjack <bet>';
  if (user.economy.wallet < bet) return '❌ Insufficient funds!';
  
  const cards = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const values = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10, 'A': 11 };
  
  const draw = () => cards[Math.floor(Math.random() * cards.length)];
  
  let playerCards = [draw(), draw()];
  let dealerCards = [draw(), draw()];
  
  const calc = (hand) => {
    let sum = hand.reduce((a, c) => a + values[c], 0);
    let aces = hand.filter(c => c === 'A').length;
    while (sum > 21 && aces > 0) {
      sum -= 10;
      aces--;
    }
    return sum;
  };
  
user.economy.wallet -= bet;
  
  const playerSum = calc(playerCards);
  const dealerSum = calc(dealerCards);
  
  let result;
  if (playerSum === 21) {
    result = 'win';
    user.economy.wallet += bet * 2.5;
  } else if (playerSum > 21) {
    result = 'lose';
  } else if (dealerSum > 21 || playerSum > dealerSum) {
    result = 'win';
    user.economy.wallet += bet * 2;
  } else if (playerSum === dealerSum) {
    result = 'tie';
    user.economy.wallet += bet;
  } else {
    result = 'lose';
  }
  
  await user.save();
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🃏 BLACKJACK
╚═══❖•ೋ° °ೋ•❖═══╝

Your hand: ${playerCards.join(', ')} = ${playerSum}
Dealer hand: ${dealerCards.join(', ')} = ${dealerSum}

${result === 'win' ? '🎉 You win!' : result === 'tie' ? '🤝 Push (tie)' : '💔 You lose!'}

💵 Wallet: ₦${user.economy.wallet}`;
}, { category: 'games' });

registerCommand('hangman', async (sock, msg, args, user) => {
  const words = ['javascript', 'whatsapp', 'bot', 'programming', 'computer', 'algorithm'];
  const word = words[Math.floor(Math.random() * words.length)];
  
  if (!global.hangman) global.hangman = new Map();
  global.hangman.set(msg.key.remoteJid, {
    word: word,
    guessed: [],
    attempts: 6
  });
  
  return `🎮 *HANGMAN*\n\nWord: ${'_'.repeat(word.length)}\nAttempts left: 6\n\nReply with a letter!`;
}, { category: 'games' });

registerCommand('guess', async (sock, msg, args, user) => {
  const number = parseInt(args[0]);
  if (!number || number < 1 || number > 10) return '❌ Usage: .guess <1-10>';
  
  const secret = Math.floor(Math.random() * 10) + 1;
  
  if (number === secret) {
    const reward = 500;
    user.economy.wallet += reward;
    await user.save();
    return `🎉 Correct! The number was ${secret}!\n💰 You won ₦${reward}!`;
  } else {
    return `💔 Wrong! The number was ${secret}. Try again!`;
  }
}, { category: 'games' });

// ==================== MORE FUN COMMANDS ====================

registerCommand('ship', async (sock, msg, args, user) => {
  const p1 = msg.key.participant || msg.key.remoteJid;
  const p2 = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  
  if (!p2) return '❌ Mention someone to ship with!';
  if (p1 === p2) return '❌ You cannot ship with yourself!';
  
  const percent = Math.floor(Math.random() * 101);
  const bar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));
  
  let status;
  if (percent > 80) status = '💕 Soulmates!';
  else if (percent > 60) status = '❤️ Great match!';
  else if (percent > 40) status = '💛 Good friends';
  else if (percent > 20) status = '💔 Not compatible';
  else status = '😱 Run away!';
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   💘 SHIP METER
╚═══❖•ೋ° °ೋ•❖═══╝

@${p1.split('@')[0]} + @${p2.split('@')[0]}

[${bar}] ${percent}%

${status}`;
}, { category: 'fun' });

registerCommand('8ball', async (sock, msg, args, user) => {
  const question = args.join(' ');
  if (!question) return '❌ Ask me a question!';
  
  const answers = [
    'It is certain', 'It is decidedly so', 'Without a doubt',
    'Yes definitely', 'You may rely on it', 'As I see it, yes',
    'Most likely', 'Outlook good', 'Yes',
    'Signs point to yes', 'Reply hazy, try again', 'Ask again later',
    'Better not tell you now', 'Cannot predict now', 'Concentrate and ask again',
    'Don\'t count on it', 'My reply is no', 'My sources say no',
    'Outlook not so good', 'Very doubtful'
  ];
  
  return `🎱 *8-BALL*\n\nQ: ${question}\nA: ${answers[Math.floor(Math.random() * answers.length)]}`;
}, { category: 'fun' });

registerCommand('meme', async (sock, msg, args, user) => {
  try {
    const res = await axios.get('https://meme-api.com/gimme', { timeout: 15000 });
    await sock.sendMessage(msg.key.remoteJid, {
      image: { url: res.data.url },
      caption: `${res.data.title}\n👍 ${res.data.ups} upvotes`
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ Failed to fetch meme';
  }
}, { category: 'fun' });

registerCommand('fact', async (sock, msg, args, user) => {
  const facts = [
    'Honey never spoils. Archaeologists have found 3000-year-old honey that is still edible.',
    'Octopuses have three hearts, nine brains, and blue blood.',
    'Bananas are berries, but strawberries are not.',
    'A day on Venus is longer than a year on Venus.',
    'Wombat poop is cube-shaped.',
    'The shortest war in history lasted 38 minutes.',
    'A group of flamingos is called a flamboyance.',
    'Cows have best friends and get stressed when separated.'
  ];
  
  return `📚 *Random Fact*\n\n${facts[Math.floor(Math.random() * facts.length)]}`;
}, { category: 'fun' });

registerCommand('roast', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.key.participant || msg.key.remoteJid;
  
  const roasts = [
    'You bring everyone so much joy... when you leave the room.',
    'I\'m not saying you\'re stupid, but you have bad luck when thinking.',
    'You\'re like a cloud. When you disappear, it becomes a beautiful day.',
    'I\'d agree with you but then we\'d both be wrong.',
    'You have the perfect face for radio.',
    'I\'m jealous of people who don\'t know you.',
    'You\'re not stupid; you just have bad luck when it comes to thinking.',
    'I bet your brain feels as good as new, seeing that you never use it.'
  ];
  
  return `🔥 @${target.split('@')[0]}, ${roasts[Math.floor(Math.random() * roasts.length)]}`;
}, { category: 'fun' });

registerCommand('compliment', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.key.participant || msg.key.remoteJid;
  
  const compliments = [
    'You\'re more fun than a ball pit filled with candy!',
    'You\'re like sunshine on a rainy day.',
    'You have the best ideas!',
    'You\'re an awesome friend!',
    'You light up the room!',
    'You have a great sense of humor!',
    'You\'re more helpful than you realize!',
    'You\'re someone\'s reason to smile!'
  ];
  
  return `💖 @${target.split('@')[0]}, ${compliments[Math.floor(Math.random() * compliments.length)]}`;
}, { category: 'fun' });

// ==================== MORE UTILITY COMMANDS ====================

registerCommand('bin', async (sock, msg, args, user) => {
  const bin = args[0];
  if (!bin || bin.length < 6) return '❌ Usage: .bin <first 6 digits of card>';
  
  try {
    const res = await axios.get(`https://lookup.binlist.net/${bin}`, {
      timeout: 15000,
      headers: { 'Accept-Version': '3' }
    });
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   💳 BIN LOOKUP
╚═══❖•ೋ° °ೋ•❖═══╝

🏦 Scheme: ${res.data.scheme || 'N/A'}
💳 Type: ${res.data.type || 'N/A'}
🌍 Country: ${res.data.country?.name || 'N/A'}
🏛️ Bank: ${res.data.bank?.name || 'N/A'}
💰 Currency: ${res.data.country?.currency || 'N/A'}`;
  } catch (err) {
    return '❌ BIN lookup failed';
  }
}, { category: 'utility' });

registerCommand('ip', async (sock, msg, args, user) => {
  const ip = args[0];
  if (!ip) return '❌ Usage: .ip <ip address>';
  
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 15000 });
    
    if (res.data.status !== 'success') return '❌ Invalid IP address';
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🌐 IP LOOKUP
╚═══❖•ೋ° °ೋ•❖═══╝

📍 IP: ${res.data.query}
🌍 Country: ${res.data.country}
🏙️ City: ${res.data.city}
📮 ZIP: ${res.data.zip}
🌐 ISP: ${res.data.isp}
⏰ Timezone: ${res.data.timezone}`;
  } catch (err) {
    return '❌ IP lookup failed';
  }
}, { category: 'utility' });

registerCommand('github', async (sock, msg, args, user) => {
  const username = args[0];
  if (!username) return '❌ Usage: .github <username>';
  
  try {
    const res = await axios.get(`https://api.github.com/users/${username}`, { timeout: 15000 });
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🐙 GITHUB PROFILE
╚═══❖•ೋ° °ೋ•❖═══╝

👤 ${res.data.name || res.data.login}
📝 ${res.data.bio || 'No bio'}
📦 Public Repos: ${res.data.public_repos}
👥 Followers: ${res.data.followers} | Following: ${res.data.following}
📅 Joined: ${new Date(res.data.created_at).toLocaleDateString()}
🔗 ${res.data.html_url}`;
  } catch (err) {
    return '❌ GitHub user not found';
  }
}, { category: 'utility' });

registerCommand('define', async (sock, msg, args, user) => {
  const word = args[0];
  if (!word) return '❌ Usage: .define <word>';
  
  try {
    const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`, { timeout: 15000 });
    
    const entry = res.data[0];
    const meaning = entry.meanings[0];
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📖 DEFINITION
╚═══❖•ೋ° °ೋ•❖═══╝

*${entry.word}* ${entry.phonetic || ''}

${meaning.partOfSpeech}:
${meaning.definitions[0].definition}

Example: ${meaning.definitions[0].example || 'N/A'}`;
  } catch (err) {
    return '❌ Word not found';
  }
}, { category: 'utility' });

registerCommand('movie', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .movie <movie name>';
  
  try {
    const res = await axios.get(`http://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=demo&plot=short`, { timeout: 15000 });
    
    if (res.data.Response === 'False') return '❌ Movie not found';
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎬 MOVIE INFO
╚═══❖•ೋ° °ೋ•❖═══╝

🎬 ${res.data.Title} (${res.data.Year})
⭐ Rating: ${res.data.imdbRating}/10
⏱️ Runtime: ${res.data.Runtime}
🎭 Genre: ${res.data.Genre}
🎬 Director: ${res.data.Director}
📝 Plot: ${res.data.Plot}`;
  } catch (err) {
    return '❌ Movie lookup failed';
  }
}, { category: 'utility' });

registerCommand('npm', async (sock, msg, args, user) => {
  const pkg = args[0];
  if (!pkg) return '❌ Usage: .npm <package name>';
  
  try {
    const res = await axios.get(`https://registry.npmjs.org/${pkg}`, { timeout: 15000 });
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📦 NPM PACKAGE
╚═══❖•ೋ° °ೋ•❖═══╝

📦 ${res.data.name}
📝 ${res.data.description || 'No description'}
📅 Version: ${res.data['dist-tags']?.latest || 'N/A'}
👤 Author: ${res.data.author?.name || 'N/A'}
⬇️ Downloads: Check npmjs.com/package/${pkg}`;
  } catch (err) {
    return '❌ Package not found';
  }
}, { category: 'utility' });

// ==================== ADVANCED MEDIA ====================

registerCommand('audiomeme', async (sock, msg, args, user) => {
  const memes = {
    'bruh': 'https://www.myinstants.com/media/sounds/bruh.mp3',
    'oof': 'https://www.myinstants.com/media/sounds/roblox-death-sound_1.mp3',
    'wow': 'https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3',
    'sad': 'https://www.myinstants.com/media/sounds/sad-violin.mp3'
  };
  
  const choice = args[0]?.toLowerCase();
  if (!memes[choice]) return `❌ Available: ${Object.keys(memes).join(', ')}`;
  
  try {
    const res = await axios.get(memes[choice], { responseType: 'arraybuffer', timeout: 15000 });
    await sock.sendMessage(msg.key.remoteJid, {
      audio: Buffer.from(res.data),
      mimetype: 'audio/mp3',
      ptt: true
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ Failed to send audio meme';
  }
}, { category: 'media' });
registerCommand('text2img', async (sock, msg, args, user) => {
  const text = args.join(' ');
  if (!text) return '❌ Usage: .text2img <text>';
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '🎨 Generating...' }, { quoted: msg });
    
    const url = `https://image.pollinations.ai/prompt/text%20art%20${encodeURIComponent(text)}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    
    await sock.sendMessage(msg.key.remoteJid, {
      image: Buffer.from(res.data),
      caption: `🎨 "${text}"`
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ Failed to generate image';
  }
}, { category: 'media' });

// ==================== DM SPECIAL COMMANDS ====================

registerCommand('confess', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const confession = args.slice(1).join(' ');
  
  if (!target || !confession) return '❌ Usage: .confess @user <your confession>';
  
  await sock.sendMessage(target, {
    text: `💌 *Anonymous Confession*\n\n"${confession}"\n\n_Someone has a crush on you!_`
  });
  
  return '💌 Your confession has been sent anonymously!';
}, { category: 'dm' });

registerCommand('anonmsg', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const message = args.slice(1).join(' ');
  
  if (!target || !message) return '❌ Usage: .anonmsg @user <message>';
  
  await sock.sendMessage(target, {
    text: `📨 *Anonymous Message*\n\n"${message}"\n\n_From a secret admirer_`
  });
  
  return '📨 Anonymous message sent!';
}, { category: 'dm' });

// ==================== OWNER ADVANCED ====================

registerCommand('exec', async (sock, msg, args, user) => {
  // Check owner
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  if (senderPhone !== ownerPhone) return '❌ Owner only!';
  
  const command = args.join(' ');
  if (!command) return '❌ Usage: .exec <shell command>';
  
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) resolve(`❌ Error: ${error.message}`);
      else if (stderr) resolve(`⚠️ Stderr: ${stderr.substring(0, 500)}`);
      else resolve(`✅ Output:\n\`\`\`\n${stdout.substring(0, 1000)}\n\`\`\``);
    });
  });
}, { category: 'owner', ownerOnly: true });

registerCommand('eval', async (sock, msg, args, user) => {
  // Check owner
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  if (senderPhone !== ownerPhone) return '❌ Owner only!';
  
  const code = args.join(' ');
  if (!code) return '❌ Usage: .eval <javascript code>';
  
  try {
    let result = eval(code);
    if (typeof result === 'object') result = JSON.stringify(result, null, 2);
    return `✅ Result:\n\`\`\`\n${String(result).substring(0, 1000)}\n\`\`\``;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}, { category: 'owner', ownerOnly: true });

registerCommand('restart', async (sock, msg, args, user) => {
  // Check owner
  const ownerPhone = user.whatsappSession?.phone?.toString().replace(/\D/g, '');
  const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
  if (senderPhone !== ownerPhone) return '❌ Owner only!';
  
  await sock.sendMessage(msg.key.remoteJid, { text: '🔄 Restarting bot...' });
  process.exit(0);
}, { category: 'owner', ownerOnly: true });

// Export nothing extra
module.exports = {};
