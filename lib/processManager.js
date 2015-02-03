'use strict';

var lodash = require('lodash')
var fs = require('fs');
var path = require('path');
var config = require('./config');
var thingiverse = require('./thingiverse');
var logger = require('./logger');
var notifier = require('./notifier');

//                                                                            //
// --- --- --- --- --- --- ---   Process Actions  --- --- --- --- --- --- --- //
//                                                                            //

var actions = {
  create: function createThing(thing) {
    // Workflow for creating a new thingiverse thing
    thing.status = 'creating';
    var thingData = lodash.clone(config.defaults.thing);
    thingData.name = thing.name = thing.filename.match(/(.+?).(?:stl|STL)/)[1];
    logger.info('Creating ' + thing.name);
    thingiverse.createThing(
      thingData,
      function (data) {
        thing.status = 'created';
        thing.id = data.id;
        thing.failures = 0;
        // Show notification
        notifier.newThing(thing.name, thing.id);
        logger.info('Created "' + thing.name + '" : ' + thing.id);
      },
      function () {
        thing.failures++;
        logger.warn('Failed creation of ' + thing.name +
                    ' ' + thing.failures + ' times.');
        thing.status = 'failed_creation';
      }
    );
  },

  requestUpload: function prepareUpload(thing) {
    // Workflow for uploading the file for the thing
    thing.status = 'requesting_upload';
    thingiverse.requestUpload(thing.id, thing.saneFilename,
      function(data) {
        logger.log('verbose', 'Requested upload for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'pending_upload';
        thing.s3 = data;
        thing.failures = 0;
      },
      function(res) {
        thing.failures++;
        logger.log('verbose', 'Upload request failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_request';
      }
    );
  },

  upload: function uploadThing(thing) {
    // Workflow for uploading the file for the thing
    thing.status = 'uploading';

    var fileStream = fs.createReadStream(thing.filepath);

      logger.log('verbose', 'Starting upload for "' +
                            thing.name + '" : ' + thing.id);

    thingiverse.s3Upload(fileStream, thing.s3.action, thing.s3.fields,
      function(data) {
        logger.log('verbose', 'Uploaded "' + thing.name + '" : ' + thing.id);
        thing.status = 'uploaded';
        thing.failures = 0;
      },
      function(res) {
        thing.failures++;
        logger.log('verbose', 'Upload failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_upload';
      }
    );
  },

  finalize: function finalizeThing(thing) {
    // Workflow for finalizing a completed upload
    thing.status = 'finalizing';

    thingiverse.finalizeUpload(thing.s3.fields.success_action_redirect,
      function(data) {
        logger.log('verbose', 'Finalized "' + thing.name + '" : ' + thing.id);
        thing.status = 'finalized';
        thing.failures = 0;
      },
      function(res) {
        thing.failures++;
        logger.log('verbose', 'Finalizing failed for "' +
                              thing.name + '" : ' + thing.id, res);
        thing.status = 'failed_finalize';
      }
    );
  },

  publish: function publishThing(thing) {
    // If not configured to publish then skip to end status
    if (!config.defaults.publish) {
      thing.status = 'published';
      return;
    }

    thing.status = 'publishing';

    thingiverse.publishThing(thing.id,
      function(data) {
        logger.log('verbose', 'Published "' + thing.name + '" : ' + thing.id);
        thing.status = 'published';
        thing.failures = 0;
      },
      function(res) {
        thing.failures++;
        logger.log('verbose', 'Publishing failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_publish';
      }
    );
  },

  collect: function collectThing(thing) {
    // If no collection is specified then skip to end status
    if (!config.defaults.collectionId) {
      thing.status = 'collected';
      return;
    }

    thing.status = 'collecting';

    // Workflow for adding a thing to a collection
    thingiverse.addThingToCollection(thing.id, config.defaults.collectionId,
      function(data) {
        logger.log('verbose', 'Added to collection (' +
                              config.defaults.collectionId + ') <= "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'collected';
        thing.failures = 0;
      },
      function(res) {
        thing.failures++;
        logger.log('verbose', 'Adding to collection failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_collect';
      }
    );
  },

  tidy: function tidyThing(thing) {
    // Move the file for the completed thing to the complete directory
    //config.completeDir
    if (config.completeDir) {
      logger.info('Completed "' + thing.name + '" : ' + thing.id);
      var dest = path.resolve(config.completeDir,
                              thing.name + '.' + thing.id + '.stl');
      fs.renameSync(thing.filepath, dest);
      thing.status = 'tidied';
    }
  }
}


//                                                                            //
// --- --- --- --- --- --- --- Process Management --- --- --- --- --- --- --- //
//                                                                            //

// Actions to be invoked when a file is added or removed from the watched
// directory
var changeHandlers = {
  add: function handleAddedFile(filename, Qs) {
    // Check that we don't already have a file with this name, to account for
    // rare error in watcher.
    var alreadySeen = false;
    ['create', 'upload', 'publish'].forEach(function (queueName) {
      Qs[queueName].forEach(function (thing) {
        if (thing.filename === filename) {
          return alreadySeen = true;
        }
      });
    });
    if (alreadySeen) { return; }

    logger.info('File added:   ' + filename);
    var filepath = path.resolve(config.dropDir, filename);
    // create a sanitized copy of the filename to avoid surprises with s3
    var saneFilename = filename.replace(/[^0-9a-zA-Z!'_\-\.\*\(\)]/g, '');
    if (saneFilename.length === 4) { saneFilename = "nofilename.stl"; }
    // Looks like a new file has arrived
    Qs.create.push({
      filename: filename,
      saneFilename: saneFilename,
      filepath: filepath,
      status: 'new',
      failures: 0,
    });
  },
  remove: function handleRemovedFile(filename, Qs) {
    // Find corresponding thing object mark it deleted and unqueue it.
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
};


//                                                                            //
// --- --- --- --- --- --- --- Process Management --- --- --- --- --- --- --- //
//                                                                            //

// The heartbeat is initialised with a Qs object and manages applying actions to
// transition queued things from their current state to the next state according
// to the implicit rules of those states, whilst respecting the connectionPool
// limit.
function newHeartBeat(Qs) {
  // Assuming any queue contents were loaded from a previous process, we should
  // also assume that any things with an active status actually failed that
  // activity and so update statuses accordingly
  Qs.create.forEach(function (thing) {
    if (thing.status === 'creating') { thing.status = 'failed_creation'; }
  });
  Qs.upload.forEach(function (thing) {
    if (thing.status === 'requesting_upload' || thing.status === 'uploading') {
      thing.status = 'created';
    }
  });
  Qs.publish.forEach(function (thing) {
    if (thing.status === 'finalizing') { thing.status = 'failed_finalize'; }
    if (thing.status === 'publishing') { thing.status = 'failed_publish'; }
    if (thing.status === 'collecting') { thing.status = 'failed_collect'; }
  });

  // The heartbeat function is called periodically to keep things moving.
  return function heartBeat() {
    // The heartbeat function checks each queue in order of precedence,
    // checks the status of each thing object, and responds accordingly.
    var activeCount = 0;

    // Save Queue to disk every heartbeat so state can be recovered in case the
    // process is interupted
    if (config.queuesFile) {
      var queuesJSON = JSON.stringify(Qs, null, 4);
      fs.writeFile(config.queuesFile, queuesJSON, function (err) {
        if (err) {
          logger.error("Error occured when saving queues file:", err);
        }
      });
    }

    if (!thingiverse.ConnectionManager.connected ||
        !thingiverse.ConnectionManager.authorized) {
      // If we've lost access then the only action worth trying is tidy
      Qs.publish = Qs.publish.filter(function (thing) {
        if (thing.status === 'collected') {
          actions.tidy(thing);
          return false;
        }
        return true;
      });
      // NOTE: it's possible that S3 is still available when the thingiverse
      //       isn't for some reason but this is unlikely, and the win for
      //       dealing with this is small at best.

      // Don't trigger any other actions until the API connection is restored.
      return;
    }

    Qs.create = Qs.create.filter(function (thing) {
      switch (thing.status) {
        case 'new':
          if (activeCount < config.connectionPool)
            actions.create(thing);
          break;

        case 'creating':
          activeCount++;
          break;

        case 'created':
          Qs.upload.push(thing);
          return false;

        case 'failed_creation':
          if (activeCount < config.connectionPool)
            actions.create(thing);
      }
      return true;
    });

    if (activeCount >= config.connectionPool)
      return;

    Qs.upload = Qs.upload.filter(function (thing) {
      switch (thing.status) {
        case 'created':
          if (activeCount < config.connectionPool)
            actions.requestUpload(thing);
          break;

        case 'requesting_upload':
          activeCount++;
          break;

        case 'pending_upload':
          if (activeCount < config.connectionPool)
            actions.upload(thing);
          break;

        case 'failed_request':
          if (activeCount < config.connectionPool)
            actions.requestUpload(thing);
          break;

        case 'uploading':
          activeCount++;
          break;

        case 'uploaded':
          Qs.publish.push(thing);
          return false;

        case 'failed_upload':
          if (thing.failures > 3) {
            // probably something went wrong with requesting the upload?
            actions.requestUpload(thing);
            break;
          }
          if (activeCount < config.connectionPool)
            actions.upload(thing);
      }
      return true;
    });

    if (activeCount >= config.connectionPool)
      return;

    Qs.publish = Qs.publish.filter(function (thing) {
      switch (thing.status) {
        case 'uploaded':
          if (activeCount < config.connectionPool)
            actions.finalize(thing);
          break;

        case 'finalizing':
          activeCount++;
          break;

        case 'finalized':
          if (activeCount < config.connectionPool)
            actions.publish(thing);
          break;

        case 'failed_finalize':
          if (thing.failures > 3) {
            // probably something went wrong with the upload?
            actions.requestUpload(thing);
            Qs.upload.push(thing);
            return false;
          }
          if (activeCount < config.connectionPool) {
            actions.finalize(thing);
          }
          break;

        case 'publishing':
          activeCount++;
          break;

        case 'published':
          actions.collect(thing);
          break;

        case 'failed_publish':
          if (activeCount < config.connectionPool)
            actions.publish(thing);
          break;

        case 'collecting':
          activeCount++;
          break;

        case 'collected':
          actions.tidy(thing);
          break;

        case 'failed_collect':
          if (activeCount < config.connectionPool)
            actions.collect(thing);
          break;

        case 'tidied':
          return false;
      }
      return true;
    });
  };
}

function initProcessManager (Qs, freq) {
  var self = {
    Qs: Qs,
    freq: (freq || 1500)
  };
  self.timer = setInterval(newHeartBeat(self.Qs), self.freq);
  return self;
}


module.exports = {
  init: initProcessManager,
  file: changeHandlers
};
