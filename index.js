#!/usr/bin/env node

'use strict';

// var express = require('express');
// var nodeNotifier = require('node-notifier');
var path = require('path');
var fs = require('fs');
// var open = require("open");
var processManager = require('./lib/processManager');
var config = require('./lib/config');
var logger = require('./lib/logger');
var thingiverse = require('./lib/thingiverse');
var notifier = require('./lib/notifier');


function init() {
  // Initialize queues
  var Qs = {
    create: [],
    upload: [],
    publish: []
  };

  // TODO: load Qs from file if possible.

  processManager.init(Qs);

  thingiverse.ConnectionManager.init()

  // Start watching the target directory
  fs.watch(config.dropDir, function (change, filename) {
    if (filename) {
      // Ignore files that dont end with .stl, or that start with a period.
      if (filename[0] === '.' || !filename.substr(-4).match(/\.(?:stl|STL)/)) {
        return;
      }

      var filepath = path.resolve(config.dropDir, filename);
      if (fs.existsSync(filepath)) {
        // Looks like a new file has arrived
        logger.info('File added:   ' + filename);
        Qs.create.push({
          filename: filename,
          filepath: filepath,
          status: 'new',
          failures: 0,
        });

      } else {
        // Looks like the file was deleted,
        // find it's thing object mark it deleted and unqueue it.
        logger.log('verbose', 'File removed: ' + filename);
        ['create', 'upload', 'publish'].forEach(function (queueName) {
          Qs[queueName] = Qs[queueName].filter(function (thing) {
            if (thing.filename === filename) {
              logger.info('Removed : "' + filename +
                          '" with status ' + thing.status);
              thing.status = 'deleted';
              return false;
            }
            return true;
          });
        });
      }

    } else {
      logger.error('Change "' + change + '"detected without filename.');
    }
  });

  logger.info("DropThing initialized watching directory " + config.dropDir);
}

function exitWithError(err) {
  logger.warn("Exiting with error");
  process.exit(1);
}

function server() {
  // TODO: launch http server, serving page with client side OAuth2 workflow
}

// Bootstrap app
logger.info("Initializing DropThing Server");
// server();
init()
