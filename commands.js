// This file loads all command parts and exports them
require('./commands_part1');
require('./commands_part2a');
require('./commands_part2b');
require('./commands_part3');
require('./commands_part4');
require('./commands_part5');
require('./commands_part6');
require('./commands_part7');

const { commands, registerCommand, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, isAdmin, reply } = require('./commands_part1');

const { warnings, bans, filters, antispamGroups, spamTracker, isBanned, getWarnings } = require('./commands_part5');
const { economy, activeGames, getUser, saveEconomy } = require('./commands_part6');

module.exports = {
  commands,
  registerCommand,
  antilinkGroups,
  welcomeGroups,
  goodbyeGroups,
  getGroupMetadata,
  isAdmin,
  reply,
  warnings,
  bans,
  filters,
  antispamGroups,
  spamTracker,
  isBanned,
  getWarnings,
  economy,
  activeGames,
  getUser,
  saveEconomy
};
