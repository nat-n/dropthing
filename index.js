#!/usr/bin/env node

'use strict';

var path = require('path');
var fs = require('fs');
var processManager = require('./lib/processManager');
var config = require('./lib/config');
var logger = require('./lib/logger');
var thingiverse = require('./lib/thingiverse');
var notifier = require('./lib/notifier');
var auth = require('./lib/auth');

function init() {
  logger.info("Initializing DropThing Server");

  // Give the express server a wee head start
  auth.startServer();

  // Initialize queues
  var Qs = {
    create: [],
    upload: [],
    publish: []
  }, loadedQs;
  // Reload saved queues
  if (config.queuesFile) {
    // Try to load Qs from queues file
    // In most cases this should allow graceful recovery of partially processed
    // things, with the exception of things with status suggesting an incomplete
    // request, which must be treated as failed.
    try {
      loadedQs = JSON.parse(fs.readFileSync(config.queuesFile, 'utf8'));
      if (loadedQs.hasOwnProperty('create') &&
          loadedQs.hasOwnProperty('upload') &&
          loadedQs.hasOwnProperty('publish')) {
        Qs.create = loadedQs.create;
        Qs.upload = loadedQs.upload;
        Qs.publish = loadedQs.publish;
      } else {
        logger.warn("Couldn't load queues, file contents invalid.");
      }
    } catch(e) {
      logger.warn("Couldn't load queues, file unreadable.");
    }
  }

  // Check dropDir for changes since the state reports by the queues file.
  // We strongly assume that the loadedQs is the most up to date view
  // possible, so we only need to deal with deletion of files that are still
  // in a queue (which we treat as having just been deleted) and addition of
  // new files, which we treat as having just arrived there.
  var existingFiles = fs.readdirSync(config.dropDir);
  var knownFiles = [];
  ['create', 'upload', 'publish'].forEach(function (queueName) {
    Qs[queueName].forEach(function (thing) { knownFiles.push(thing.filename) });
  });
  knownFiles.forEach(function (filename) {
    if (existingFiles.indexOf(filename) === -1) {
      if (filename[0] === '.' || !filename.substr(-4).match(/\.(?:stl|STL)/)) {
        return;
      }
      // known file is missing
      processManager.file.remove(filename, Qs);
    }
  });
  existingFiles.forEach(function (filename) {
    if (knownFiles.indexOf(filename) === -1) {
      if (filename[0] === '.' || !filename.substr(-4).match(/\.(?:stl|STL)/)) {
        return;
      }
      // existing file is new
      processManager.file.add(filename, Qs);
    }
  });

  // Initialise process and connection managers
  processManager.init(Qs);
  thingiverse.ConnectionManager.init()

  // Start watching the target directory for changes in STL files
  fs.watch(config.dropDir, function (change, filename) {
    if (filename) {
      // Ignore files that dont end with .stl, or that start with a period.
      if (filename[0] === '.' || !filename.substr(-4).match(/\.(?:stl|STL)/)) {
        return;
      }

      var filepath = path.resolve(config.dropDir, filename);
      if (fs.existsSync(filepath)) {
        // looks like a file was added or changed
        processManager.file.add(filename, Qs);
      } else {
        // looks like a file was deleted
        processManager.file.remove(filename, Qs);
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

// Bootstrap app
init();
