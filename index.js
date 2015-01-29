#!/usr/bin/env node

'use strict';

// var express = require('express');
// var nodeNotifier = require('node-notifier');
var path = require('path');
var fs = require('fs');
var open = require("open");
var processManager = require('./lib/processManager');
var config = require('./lib/config');
var logger = require('./lib/logger');
var thingiverse = require('./lib/thingiverse');
var notifier = require('./lib/notifier');


function init(d) {

  // Initialize queues
  var Qs = {
    create: [],
    upload: [],
    finalize: []
  };
  processManager.init(Qs);

  logger.info("DropThing Server ready");

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
        ['create', 'upload', 'finalize'].forEach(function (queueName) {
          Qs[queueName] = Qs[queueName].filter(function (thing) {
            if (thing.filename === filename) {
              logger.info('Deleting : "' + filename +
                          '" from queue ' + queueName);
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
}

function exitWithError(err) {
  logger.warn("Exiting with error");
  process.exit(1);
}

function server() {
  // TODO: launch http server, serving page with client side OAuth2 workflow
}

function authenticate(success, failure) {
  if (config.accessToken && config.accessToken.length === 32) {
    // Get user info just to verify that the access token works
    thingiverse.getCurrentUser(success, function(res) {
      if (res.code === 'ENOTFOUND' && res.syscall === 'getaddrinfo') {
        // Couldn't reach host
        notifier.unreachable();
        logger.error("Couldn't reach thingiverse");
        failure();

        // NOW WHAT??? retry with backoff?
        // should have a dedicated subroutine for this stuff

      } else {
        // Clear accessToken and try again to trigger user auth workflow.
        config.accessToken = void 0;
        authenticate(success, failure);
      }
    });

  } else {

    // TODO: serve a page that goes through the auth cycle and reports the
    // accessToken to the server
    // open("http://0.0.0.0:8888");

    logger.error("No valid access token provided, it may have expired.");

    failure();
  }

}

// Bootstrap app
logger.info("Initializing DropThing Server");
// server();
authenticate(init, exitWithError);
