'use strict';

var config = require('../lib/config');
var auth = require('../lib/auth');
var thingiverse = require('../lib/thingiverse');
var logger = require('../lib/logger');


// TODO: script that deletes all things by a user that meet certain criteria

logger.info('Initialising deletion process');


auth.startServer();
thingiverse.ConnectionManager.init();

// For some
config.httpTimeout = 30000;

// Get list of all the users things
thingiverse.thingsByUser(function (allThings) {
  logger.info("Retrieved the user's things");

  // TODO: filter them by certain criterion (unless we really just want to delete everything??)

  var markedThingIds = [];
  allThings.forEach(function (thing) {
    if (true) { // ????? everything ?????
      markedThingIds.push(thing.id);
    }
  });

  // Delete each one
  markedThingIds.forEach(function (thingId) {
    thingiverse.deleteThing(thingId, function () {
      logger.info("Successfully deleted " + thingId);
    }, function () {
      logger.error("Failed to delete " + thingId);
    })
  });

}, function (res) {
  console.log(res);
  logger.error("Failed to retrieve the user's things");
});

var stdin = process.openStdin();

console.log('Press any key to cancel');
stdin.on('keypress', function (chunk, key) {
  logger.info('Cancelling deletion process');
  process.exit(1);
});
