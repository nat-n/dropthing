'use strict';

var config = require('../lib/config');
var auth = require('../lib/auth');
var thingiverse = require('../lib/thingiverse');
var logger = require('../lib/logger');


// Setup dependencies
auth.startServer();
thingiverse.ConnectionManager.init();

// For some reason this helps
config.httpTimeout = 40000;

// Parse argument
var collectionName = process.argv[2];
if (!collectionName) {
  console.log('!! A collection id argument is required');
  process.exit(1);
}

logger.info('Initialising deletion process');

// Lookup the collection Id for this collection name
thingiverse.collectionsByUser(function(collections){
  var found = false;
  for (var i = collections.length - 1; i >= 0; i--) {
    var collection = collections[i];
    if (collection.name === collectionName) {
      deleteCollectionContents(collection.id);
      found = true;
    }
  };
  if (!found) {
    console.log("!! No collection was found called: " + collectionName);
    process.exit(1);
  }
}, function () {
  console.log('!! Couldn\'t connect to thingiverse to lookup collection ID');
  process.exit(1);
});


function deleteCollectionContents(collectionId) {
  // Get list of all the things in this collection, and setup a queue that is
  // checked every couple of seconds to ensure a few deletions are in progress
  // until it is empty.
  thingiverse.thingsInCollection(collectionId, function (deletionQ) {
    logger.info("Retrieved "+deletionQ.length+" things from collection: " + collectionName);

    setInterval(function () {
      deletionQ.filter(function (thing) { return !thing.deleted; });

      if (deletionQ.length === 0) {
        console.log("Bulk deletion complete");
        process.exit(0);
      }
      var activeCount = 0;

      deletionQ.forEach(function (thing) {
        if (activeCount > 3) {
          return;
        }
        if (thing.deleting !== true) {
          thingiverse.deleteThing(thing.id, function () {
            logger.info("Successfully deleted " + thing.name + "(" + thing.id + ")");
            thing.deleted = true;
          }, function () {
            logger.error("Failed to delete " + thing.name + "(" + thing.id + ")" +
                         ", will try again shortly.");
            thing.deleting = false;
          })
          thing.deleting = true;
          activeCount++;
        }
      });

    }, 2000)

  }, function (res) {
    console.log(res);
    logger.error("Failed to retrieve the things in this collection");
  });
}
