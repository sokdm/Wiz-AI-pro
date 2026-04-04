const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { commands, registerCommand } = require('./commands_part1');

// Data storage
const DATA_DIR = path.join(__dirname, 'data');
const ECONOMY_FILE = path.join(DATA_DIR, 'economy.json');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const LEVELS_FILE = path.join(DATA_DIR, 'levels.json');

fs.ensureDirSync(DATA_DIR);

const loadData = (file) => {
  try { return fs.readJsonSync(file); } catch { return {}; }
};
const saveData = (file, data) => {
  fs.writeJsonSync(file, data, { spaces: 2 });
};

// Economy data
const economy = loadData(ECONOMY_FILE);
const levels = loadData(LEVELS_FILE);
const activeGames = new Map();

// Helper: Get or create user economy
const getUser = (userId) => {
  if (!economy[userId]) {
    economy[userId] = { balance: 1000, bank: 0, daily: 0, xp: 0, level: 1 };
  }
  return economy[userId];
};

const saveEconomy = () => saveData(ECONOMY_FILE, economy);
const saveLevels = () => saveData(LEVELS_FILE, levels);

// 61. Balance - Check money
registerCommand('balance', async (sock, msg, args, user) => {
  const userId = msg.key.participant || msg.key.remoteJid;
  const u = getUser(userId);
  
  return `💰 *Your Balance*\n\n👛 Wallet: ₦${u.balance.toLocaleString()}\n🏦 Bank: ₦${u.bank.toLocaleString()}\n💎 Total: ₦${(u.balance + u.bank).toLocaleString()}\n⭐ Level: ${u.level} (${u.xp} XP)`;
}, { category: 'economy' });

// 62. Daily - Claim daily reward
registerCommand('daily', async (sock, msg, args, user) => {
  const userId = msg.key.participant || msg.key.remoteJid;
  const u = getUser(userId);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  if (now - u.daily < dayMs) {
    const remaining = Math.ceil((dayMs - (now - u.daily)) / (60 * 60 * 1000));
    return `⏰ Already claimed! Come back in ${remaining} hours`;
  }
  
  const reward = Math.floor(Math.random() * 500) + 500;
  u.balance += reward;
  u.daily = now;
  u.xp += 10;
  saveEconomy();
  
  return `🎁 *Daily Reward!*\n\n💵 +₦${reward}\n⭐ +10 XP\n\n💰 New Balance: ₦${u.balance.toLocaleString()}`;
}, { category: 'economy' });

// 63. Deposit - Wallet to bank
registerCommand('deposit', async (sock, msg, args, user) => {
  const amount = parseInt(args[0]);
  if (!amount || amount < 1) return '❌ Usage: .deposit <amount>';
  
  const userId = msg.key.participant || msg.key.remoteJid;
  const u = getUser(userId);
  
  if (u.balance < amount) return '❌ Not enough money in wallet!';
  
  u.balance -= amount;
  u.bank += amount;
  saveEconomy();
  
  return `🏦 Deposited ₦${amount.toLocaleString()} to bank\n💰 Wallet: ₦${u.balance.toLocaleString()}\n🏦 Bank: ₦${u.bank.toLocaleString()}`;
}, { category: 'economy' });

// 64. Withdraw - Bank to wallet
registerCommand('withdraw', async (sock, msg, args, user) => {
  const amount = parseInt(args[0]);
  if (!amount || amount < 1) return '❌ Usage: .withdraw <amount>';
  
  const userId = msg.key.participant || msg.key.remoteJid;
  const u = getUser(userId);
  
  if (u.bank < amount) return '❌ Not enough money in bank!';
  
  u.bank -= amount;
  u.balance += amount;
  saveEconomy();
  
  return `👛 Withdrew ₦${amount.toLocaleString()}\n💰 Wallet: ₦${u.balance.toLocaleString()}\n🏦 Bank: ₦${u.bank.toLocaleString()}`;
}, { category: 'economy' });

// 65. Transfer - Send money
registerCommand('transfer', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const amount = parseInt(args[1]);
  
  if (!target || !amount) return '❌ Usage: .transfer @user <amount>';
  if (amount < 1) return '❌ Invalid amount';
  
  const userId = msg.key.participant || msg.key.remoteJid;
  const u = getUser(userId);
  
  if (u.balance < amount) return '❌ Not enough money!';
  
  const targetUser = getUser(target);
  
  u.balance -= amount;
  targetUser.balance += amount;
  saveEconomy();
  
  return `💸 Sent ₦${amount.toLocaleString()} to @${target.split('@')[0]}\n💰 Your balance: ₦${u.balance.toLocaleString()}`;
}, { category: 'economy' });

// 66. Top - Richest users
registerCommand('top', async (sock, msg, args, user) => {
  const sorted = Object.entries(economy)
    .sort((a, b) => (b[1].balance + b[1].bank) - (a[1].balance + a[1].bank))
    .slice(0, 10);
  
  let text = `🏆 *Top 10 Richest*\n\n`;
  sorted.forEach(([id, data], i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
    text += `${medal} ${i+1}. @${id.split('@')[0]}: ₦${(data.balance + data.bank).toLocaleString()}\n`;
  });
  
  const mentions = sorted.map(([id]) => id);
  await sock.sendMessage(msg.key.remoteJid, { text, mentions });
  return null;
}, { category: 'economy' });

// 67. Slot - Slot machine
registerCommand('slot', async (sock, msg, args, user) => {
  const bet = parseInt(args[0]) || 100;
  if (bet < 50) return '❌ Minimum bet is ₦50';
  
  const userId = msg.key.participant || msg.key.remoteJid;
  const u = getUser(userId);
  
  if (u.balance < bet) return '❌ Not enough money!';
  
  const symbols = ['🍎', '🍊', '🍇', '🍒', '💎', '7️⃣', '🎰'];
  const weights = [20, 20, 15, 15, 10, 5, 1]; // Rarity
  
  const spin = () => {
    const rand = Math.random() * 100;
    let cum = 0;
    for (let i = 0; i < symbols.length; i++) {
      cum += weights[i];
      if (rand < cum) return symbols[i];
    }
    return symbols[0];
  };
  
  const result = [spin(), spin(), spin()];
  const display = `┏━━━┳━━━┳━━━┓\n┃ ${result[0]} ┃ ${result[1]} ┃ ${result[2]} ┃\n┗━━━┻━━━┻━━━┛`;
  
  let win = 0;
  let message = '';
  
  if (result[0] === result[1] && result[1] === result[2]) {
    // Jackpot
    const multipliers = { '🍎': 3, '🍊': 3, '🍇': 4, '🍒': 4, '💎': 10, '7️⃣': 20, '🎰': 50 };
    win = bet * multipliers[result[0]];
    message = `🎉 JACKPOT! x${multipliers[result[0]]}`;
  } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    win = bet * 2;
    message = `✨ Two match! x2`;
  } else {
    win = -bet;
    message = `😢 No match`;
  }
  
  u.balance += win;
  u.xp += 5;
  saveEconomy();
  
  return `🎰 *SLOT MACHINE*\n\n${display}\n\n${message}\n${win > 0 ? `💰 +₦${win.toLocaleString()}` : `💸 -₦${Math.abs(win).toLocaleString()}`}\n\n👛 Balance: ₦${u.balance.toLocaleString()}`;
}, { category: 'games' });

// 68. Roulette - Russian roulette style
registerCommand('roulette', async (sock, msg, args, user) => {
  const bet = parseInt(args[0]) || 100;
  const userId = msg.key.participant || msg.key.remoteJid;
  const u = getUser(userId);
  
  if (u.balance < bet) return '❌ Not enough money!';
  
  const chamber = Math.floor(Math.random() * 6) + 1;
  const bullet = Math.floor(Math.random() * 6) + 1;
  
  let result;
  if (chamber === bullet) {
    u.balance -= bet;
    result = `💥 *BANG!*\nYou lost ₦${bet.toLocaleString()}\nChamber ${chamber} had the bullet!`;
  } else {
    const win = bet * 5;
    u.balance += win;
    result = `😮 *CLICK!*\nSafe! Chamber ${chamber} was empty\n💰 Won ₦${win.toLocaleString()}`;
  }
  
  u.xp += 10;
  saveEconomy();
  
  return `🔫 *ROULETTE*\n\n${result}\n\n👛 Balance: ₦${u.balance.toLocaleString()}`;
}, { category: 'games' });

// 69. Trivia - Quiz game
registerCommand('trivia', async (sock, msg, args, user) => {
  const questions = [
    { q: 'What is the capital of Nigeria?', a: ['abuja'], options: ['A) Lagos', 'B) Abuja', 'C) Kano'] },
    { q: 'Who painted the Mona Lisa?', a: ['leonardo', 'da vinci', 'leonardo da vinci'], options: ['A) Van Gogh', 'B) Picasso', 'C) Da Vinci'] },
    { q: 'What is 2 + 2 × 2?', a: ['6', 'six'], options: ['A) 6', 'B) 8', 'C) 4'] },
    { q: 'Which planet is known as the Red Planet?', a: ['mars'], options: ['A) Venus', 'B) Mars', 'C) Jupiter'] },
    { q: 'What is the largest ocean on Earth?', a: ['pacific', 'pacific ocean'], options: ['A) Atlantic', 'B) Indian', 'C) Pacific'] }
  ];
  
  const q = questions[Math.floor(Math.random() * questions.length)];
  const gameId = msg.key.remoteJid + (msg.key.participant || '');
  
  activeGames.set(gameId, {
    answer: q.a,
    expires: Date.now() + 30000
  });
  
  // Auto cleanup
  setTimeout(() => activeGames.delete(gameId), 30000);
  
  return `🎯 *TRIVIA*\n\n${q.q}\n${q.options.join('\n')}\n\n⏱️ Reply with answer in 30s!`;
}, { category: 'games' });

// 70. Tictactoe - Start game
registerCommand('tictactoe', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention someone to play with!';
  
  const gameId = msg.key.remoteJid;
  activeGames.set(gameId, {
    type: 'tictactoe',
    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    players: [msg.key.participant, target],
    current: 0,
    turn: msg.key.participant
  });
  
  return `🎮 *TIC-TAC-TOE*\n\n❌ @${msg.key.participant.split('@')[0]}\n⭕ @${target.split('@')[0]}\n\nUse .move <1-9> to play!\n\n1 2 3\n4 5 6\n7 8 9`;
}, { category: 'games' });

// 71. Move - Make tictactoe move
registerCommand('move', async (sock, msg, args, user) => {
  const pos = parseInt(args[0]) - 1;
  if (pos < 0 || pos > 8) return '❌ Use 1-9';
  
  const gameId = msg.key.remoteJid;
  const game = activeGames.get(gameId);
  
  if (!game || game.type !== 'tictactoe') return '❌ No active game! Start with .tictactoe';
  if (game.turn !== msg.key.participant) return '❌ Not your turn!';
  
  if (game.board[pos] !== ' ') return '❌ Position taken!';
  
  const symbol = game.current === 0 ? '❌' : '⭕';
  game.board[pos] = symbol;
  game.current = 1 - game.current;
  game.turn = game.players[game.current];
  
  // Check win
  const wins = [[0,1,2], [3,4,5], [6,7,8], [0,3,6], [1,4,7], [2,5,8], [0,4,8], [2,4,6]];
  for (const [a, b, c] of wins) {
    if (game.board[a] !== ' ' && game.board[a] === game.board[b] && game.board[b] === game.board[c]) {
      activeGames.delete(gameId);
      const winner = game.players[1 - game.current];
      const u = getUser(winner);
      u.balance += 200;
      u.xp += 20;
      saveEconomy();
      return `🎉 *${symbol} WINS!*\n\n${formatBoard(game.board)}\n\n💰 @${winner.split('@')[0]} won ₦200!`;
    }
  }
  
  // Check draw
  if (!game.board.includes(' ')) {
    activeGames.delete(gameId);
    return `🤝 *DRAW!*\n\n${formatBoard(game.board)}`;
  }
  
  return `${formatBoard(game.board)}\n\n${symbol === '❌' ? '⭕' : '❌'} @${game.turn.split('@')[0]}'s turn!`;
}, { category: 'games' });

// 72. RPS - Rock Paper Scissors
registerCommand('rps', async (sock, msg, args, user) => {
  const choice = args[0]?.toLowerCase();
  if (!['rock', 'paper', 'scissors'].includes(choice)) {
    return '❌ Choose: rock, paper, or scissors';
  }
  
  const botChoice = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
  const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
  
  let result;
  if (choice === botChoice) {
    result = '🤝 Draw!';
  } else if (
    (choice === 'rock' && botChoice === 'scissors') ||
    (choice === 'paper' && botChoice === 'rock') ||
    (choice === 'scissors' && botChoice === 'paper')
  ) {
    result = '🎉 You win!';
    const u = getUser(msg.key.participant || msg.key.remoteJid);
    u.balance += 50;
    u.xp += 5;
    saveEconomy();
  } else {
    result = '😢 You lose!';
  }
  
  return `🎮 *ROCK PAPER SCISSORS*\n\nYou: ${emojis[choice]} ${choice}\nBot: ${emojis[botChoice]} ${botChoice}\n\n${result}`;
}, { category: 'games' });

// 73. Roll - Dice roll
registerCommand('roll', async (sock, msg, args, user) => {
  const sides = parseInt(args[0]) || 6;
  const result = Math.floor(Math.random() * sides) + 1;
  return `🎲 Rolled ${result} (1-${sides})`;
}, { category: 'fun' });

// 74. Flip - Coin flip
registerCommand('flip', async (sock, msg, args, user) => {
  const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
  return `🪙 ${result}`;
}, { category: 'fun' });

// 75. Choose - Random picker
registerCommand('choose', async (sock, msg, args, user) => {
  if (args.length < 2) return '❌ Provide at least 2 options separated by commas';
  const options = args.join(' ').split(',').map(s => s.trim()).filter(s => s);
  const choice = options[Math.floor(Math.random() * options.length)];
  return `🎯 I choose: *${choice}*`;
}, { category: 'fun' });

// 76. Rate - Rate something 1-10
registerCommand('rate', async (sock, msg, args, user) => {
  const thing = args.join(' ') || 'you';
  const rating = Math.floor(Math.random() * 10) + 1;
  const bar = '⭐'.repeat(rating) + '☆'.repeat(10 - rating);
  return `📊 Rating *${thing}*\n\n${bar} ${rating}/10`;
}, { category: 'fun' });

// 77. Gaycheck - Random percentage
registerCommand('gaycheck', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const name = target ? `@${target.split('@')[0]}` : args.join(' ') || 'you';
  const percent = Math.floor(Math.random() * 101);
  const bar = '🏳️‍🌈'.repeat(Math.floor(percent / 10)) + '⬜'.repeat(10 - Math.floor(percent / 10));
  return `🏳️‍🌈 *Gay Check*\n\n${name}\n${bar} ${percent}%`;
}, { category: 'fun' });

// 78. Joke - Random joke
registerCommand('joke', async (sock, msg, args, user) => {
  try {
    const res = await axios.get('https://official-joke-api.appspot.com/random_joke');
    return `😂 *${res.data.setup}*\n\n${res.data.punchline}`;
  } catch {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything!",
      "Why did the scarecrow win an award? He was outstanding in his field!",
      "Why don't eggs tell jokes? They'd crack each other up!",
      "What do you call a fake noodle? An impasta!"
    ];
    return `😂 ${jokes[Math.floor(Math.random() * jokes.length)]}`;
  }
}, { category: 'fun' });

// 79. Quote - Random quote
registerCommand('quote', async (sock, msg, args, user) => {
  try {
    const res = await axios.get('https://api.quotable.io/random');
    return `💭 *"${res.data.content}"*\n\n— ${res.data.author}`;
  } catch {
    const quotes = [
      { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
      { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
      { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" }
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    return `💭 *"${q.text}"*\n\n— ${q.author}`;
  }
}, { category: 'fun' });

// Helper: Format tictactoe board
const formatBoard = (board) => {
  return `${board[0]}│${board[1]}│${board[2]}\n─┼─┼─\n${board[3]}│${board[4]}│${board[5]}\n─┼─┼─\n${board[6]}│${board[7]}│${board[8]}`;
};

module.exports = { 
  commands, 
  economy, 
  activeGames, 
  getUser,
  saveEconomy 
};
