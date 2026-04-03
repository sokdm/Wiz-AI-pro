// This file loads all command parts and exports them
require('./commands_part1');
require('./commands_part2a');
require('./commands_part2b');
require('./commands_part3');
require('./commands_part4');

const { commands, registerCommand, antilinkGroups, welcomeGroups, goodbyeGroups, getGroupMetadata, isAdmin, reply } = require('./commands_part1');

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
