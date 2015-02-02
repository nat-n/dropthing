'use strict';

var path = require('path');
var fs = require('fs');

var CONFIG_PATH = path.resolve(__dirname, '../config.json'),
  config;

try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch(e) {
  console.error("Couldn't load config: ", CONFIG_PATH);
  process.exit(1);
}

if (config.dropDir)
  config.dropDir = path.resolve(__dirname, '../', config.dropDir);
if (config.completeDir)
  config.completeDir = path.resolve(__dirname, '../', config.completeDir);
if (config.logFile)
  config.logFile = path.resolve(__dirname, '../', config.logFile);
if (config.queuesFile)
  config.queuesFile = path.resolve(__dirname, '../', config.queuesFile);
config.connectionPool = (config.connectionPool || 3);
config.notificationTime = (config.notificationTime || 5000);

// Verify there is a description if publish is true
if (config.defaults.publish && !config.defaults.thing.description) {
  console.error(
    "Configuration Error: a description must be provided if publish is true.");
  process.exit(1);
}

module.exports = config;
