'use strict';

var lodash = require('lodash')
var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var config = require('./config');
var thingiverse = require('./thingiverse');
var logger = require('./logger');
var notifier = require('./notifier');

var actions = {
  create: function createThing(thing) {
    // Workflow for creating a new thingiverse thing
    thing.status = 'creating';
    var thingData = lodash.clone(config.defaults.thing);
    thingData.name = thing.name = thing.filename.match(/(.*?).(?:stl|STL)/)[1];
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
        logger.warn('Failed creation of ' + thing.name +
                    ' ' + thing.failures + ' times.');
        thing.status = 'failed_creation';
        thing.failures++;
      }
    );
  },

  requestUpload: function prepareUpload(thing) {
    // Workflow for uploading the file for the thing
    thing.status = 'requesting_upload';
    thingiverse.requestUpload(thing.id, thing.filename,
      function(data) {
        logger.log('verbose', 'Requested upload for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'pending_upload';
        thing.s3 = data;
        thing.failures = 0;
      },
      function(res) {
        logger.log('verbose', 'Upload request failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_request';
        thing.failures++;
      }
    );
  },

  upload: function uploadThing(thing) {
    // Workflow for uploading the file for the thing
    thing.status = 'uploading';

    var fileStream = fs.createReadStream(thing.filepath);

    thingiverse.s3Upload(fileStream, thing.s3.action, thing.s3.fields,
      function(data) {
        logger.log('verbose', 'Uploaded "' + thing.name + '" : ' + thing.id);
        thing.status = 'uploaded';
        thing.failures = 0;
      },
      function(res) {
        logger.log('verbose', 'Upload failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_upload';
        thing.failures++;
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
        logger.log('verbose', 'Finalizing failed for "' +
                              thing.name + '" : ' + thing.id, res);
        thing.status = 'failed_finalize';
        thing.failures++;
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
        logger.log('verbose', 'Publishing failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_publish';
        thing.failures++;
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
                              config.defaults.collectionId + ')"' + thing.name +
                              '" : ' + thing.id);
        thing.status = 'collected';
        thing.failures = 0;
      },
      function(res) {
        logger.log('verbose', 'Adding to collection failed for "' +
                              thing.name + '" : ' + thing.id);
        thing.status = 'failed_collect';
        thing.failures++;
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
      thing.status = 'tidied'
    }
  }
}

function newHeartBeat(Qs) {
  // This is really just a closure around the heartBeat function

  return function heartBeat() {
    // The heartbeat function checks each queue in order of precedence,
    // checks the status of each thing object, and responds accordingly.
    var activeCount = 0;

    // TODO: save Queue to disk every heartbeat... then have the option of
    //       loading it on start, (checking of deletions between executions)

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
          Qs.finalize.push(thing);
          return false;

        case 'failed_upload':
          if (activeCount < config.connectionPool)
            actions.upload(thing);
      }
      return true;
    });

    if (activeCount >= config.connectionPool)
      return;

    Qs.finalize = Qs.finalize.filter(function (thing) {
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

        case 'failed_finalize':
          if (thing.failures > 3) // probably the upload failed?
            actions.upload(thing);
          break;
          if (activeCount < config.connectionPool)
            actions.finalize(thing);
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
          if (activeCount < config.connectionPool)
            actions.tidy(thing);
          return false;

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
  init: initProcessManager
};
