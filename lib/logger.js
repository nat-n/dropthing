'use strict';

var winston = require('winston')
var config = require('./config');


var logger = new (winston.Logger)({
  transports: []
});

logger.add(winston.transports.Console, {
	level: (config.consoleLogLevel || 'info')
});

if (config.logFile) {
  logger.add(winston.transports.File, {
    filename: config.logFile,
    json: false,
    level: 'verbose'
  });
}

module.exports = logger;
