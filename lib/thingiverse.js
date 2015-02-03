'use strict'

var FormData = require('form-data');
var https = require('https');
var url = require('url');
var querystring = require('querystring');
var lodash = require('lodash');
var config = require('./config');
var logger = require('./logger');
var notifier = require('./notifier');

var AWS = require('aws-sdk');

var HOSTNAME = 'api.thingiverse.com';



// TODO: have a connection manager object in this module
// Includes decorator for all thingiverse connections that checks for lost
// session or connection, and can trigger a global lostConnection or lostSession
// mode.
// When lost connection mode is triggered, the heartbeat stops triggering
// thingiverse actions until the connection is restored. Meanwhile the
// connectionManager attempts to reach the server until successful, then it
// restores the connection status.
// Session is handled similarly.


//                                                                            //
// --- --- --- --- ---  Connection and Session Management --- --- --- --- --- //
//                                                                            //

var ConnectionManager = {
  connected: false,
  authorized: false,
  backoff: (function attemptWithBackoff () {
    var self = {
      minBackoff: 1000,
      maxBackoff: 15000,
      size: 5000,
      timer: null,
      reset: function () {
        clearTimeout(self.timer);
        self.timer = null;
        self.backoff = self.minBackoff;
      },
      then: function (fn) {
        // Backoff level doubles with every attempt with a max of 10s
        if (!self.timer) {
          self.timer = setTimeout(function () {
            self.timer = null;
            fn();
            self.size = Math.min(2*self.size, self.maxBackoff);
          }, self.size);
        }
      }
    };
    return self;
  })(),
  onError: function onError (res, success) {
    if ((res.code === 'ENOTFOUND' && res.syscall === 'getaddrinfo') || // no connection
        res.code === 'ECONNRESET' || // request timed out (canceled socket)
        (res.code === 'EPIPE' && res.errno === 'EPIPE')) { // Upload interupted
      // Couldn't reach host
      ConnectionManager.connected = false;
      notifier.unreachable();
      logger.error("Couldn't reach thingiverse, will retry after " +
                   ConnectionManager.backoff.size/1000 + 's');
      ConnectionManager.backoff.then(function () {
        logger.info('Retrying connection to thingiverse API');
        ConnectionManager.check(success);
      });
    } else if (res.error === 'Unauthorized'){
      // Clear accessToken and try again to trigger user auth workflow.
      ConnectionManager.authorized = false;
      config.accessToken = void 0;
      ConnectionManager.check(success);
    } else {
      logger.error('Unknown API error', res);
    }
  },
  check: function checkConnection(success) {
    // SMELL: There shouldn't be the need for a failure callback,
    //        instead we should pause connection dependent activities and check
    //        the connection periodically.

    if (config.accessToken && config.accessToken.length === 32) {
      logger.log('verbose', 'Checking API connection');

      // Get user info just to verify that the connection and access token work
      getCurrentUser(function () {
        logger.info('Established thingiverse API connection');
        ConnectionManager.connected = true;
        ConnectionManager.authorized = true;
        ConnectionManager.backoff.reset();
        if (success) { success(); }
      }, function (res) {ConnectionManager.onError(res, success); });

    } else {

      logger.error('No valid access token provided, it may have expired.');

      // TODO: serve a page that goes through the auth cycle and reports the
      // accessToken to the server
      // open("http://0.0.0.0:8888");

    }

  },
  init: function initConnectionManager(success, failure) {
    // TODO: check credentials,
    //  - if lacking then trigger auth
    //  - check connection
    //    - if no internet then trigger backoff checking,
    //    - if no session then trigger auth

    this.check(success);
  },
  authorize: function authorizeApp() {

  }
};


//                                                                            //
// --- --- --- --- --- --- ---   Private Helpers  --- --- --- --- --- --- --- //
//                                                                            //

function authHeader() {
  return {
    'Authorization': 'Bearer ' + config.accessToken,
    'Accept': 'application/json',
    'Content-Type': 'application/json;charset=UTF-8'
  };
}

function poster(path, data, success, error) {
  // Send request
  var req = https.request({
    method: 'POST',
    hostname: HOSTNAME,
    path: path,
    headers: authHeader()
  });
  if (data) req.write(JSON.stringify(data));
  req.end();

  if (config.httpTimeout) {
    req.on('socket', function (socket) {
      socket.setTimeout(config.httpTimeout);
      socket.on('timeout', function() {
        req.abort();
      });
    });
  }

  if (success) req.on('response', function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function(){
      data = JSON.parse(data)
      if (data.error) {
        ConnectionManager.onError(data);
        error(data);
      } else {
        success(data);
      }
    });
  });

  if (error) req.on('error', function (res) {
    ConnectionManager.onError(res);
    error(res);
  });

  return req;
}

function getter(path, data, success, error) {
  // Encode data in path (extending existing querystring)
  var urlParts = url.parse(path);
  var pathData = lodash.extend(querystring.parse(urlParts.query), data);
  path = urlParts.pathname + '?' + querystring.stringify(pathData);

  // Send request
  var req = https.request({
    method: 'GET',
    hostname: HOSTNAME,
    path: path,
    headers: authHeader()
  });
  req.end();

  if (config.httpTimeout) {
    req.on('socket', function (socket) {
      socket.setTimeout(config.httpTimeout);
      socket.on('timeout', function() {
        req.abort();
      });
    });
  }

  if (success) req.on('response', function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function(){
      data = JSON.parse(data)
      if (data.error) {
        ConnectionManager.onError(data);
        error(data);
      } else {
        success(data);
      }
    });
  });

  if (error) req.on('error', function (res) {
    ConnectionManager.onError(res);
    error(res);
  });

  return req;
}

function deleter(path, success, error) {
  // Send request
  var req = https.request({
    method: 'DELETE',
    hostname: HOSTNAME,
    path: path,
    headers: authHeader()
  });
  req.end();

  if (config.httpTimeout) {
    req.on('socket', function (socket) {
      socket.setTimeout(config.httpTimeout);
      socket.on('timeout', function() {
        req.abort();
      });
    });
  }

  if (success) req.on('response', function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function(){ success(JSON.parse(data)); });
  });

  if (error) req.on('error', function (res) {
    ConnectionManager.onError(res);
    error(res);
  });

  return req;
}


//                                                                            //
// --- --- --- --- --- --- ---     Public API     --- --- --- --- --- --- --- //
//                                                                            //

function getCurrentUser(success, error) {
  return getter('/users/me/', null, success, error);
}

function createThing(thingData, success, error) {
  return poster('/things', thingData, success, error);
};

function requestUpload(thingId, filename, success, error) {
  var data = { filename: filename },
      path = '/things/' + thingId + '/files'
  return poster(path, data, success, error);
}

function s3Upload(fileStream, action, fields, success, error) {
    var urlParts = url.parse(action),
        host = urlParts.host,
        path = urlParts.path;
    // build formdata object
    var form = new FormData();
    form.append('AWSAccessKeyId', fields.AWSAccessKeyId);
    form.append('Content-Disposition', fields['Content-Disposition']);
    form.append('Content-Type', fields['Content-Type']);
    form.append('acl', fields.acl);
    form.append('bucket', fields.bucket);
    form.append('key', fields.key);
    form.append('policy', fields.policy);
    form.append('signature', fields.signature);
    form.append('success_action_redirect', fields.success_action_redirect);
    form.append('file', fileStream);

    var req = form.submit({
      method: 'POST',
      host: host,
      path: path,
      headers: form.getHeaders()
    }, function(err, res) {
      if (err) {
        ConnectionManager.onError(err);
        error(err);
        return;
      }
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function(){ success(data); });
    });

    return req;
}

function finalizeUpload (action, success, error) {
  var path = url.parse(action).path;
  return poster(path, null, success, error);
}

function publishThing (thingId, success, error) {
  var path = '/things/' + thingId + '/publish';
  return poster(path, null, success, error);
}

function deleteThing (thingId, success, error) {
  var path = '/things/' + thingId;
  return deleter(path, success, error);
}

function collectionsByUser (success, error) {
  return getter('/users/me/collections', success, error);
}


function addThingToCollection (thingId, collectionId, success, error) {
  var path = '/collections/' + collectionId + '/thing/' + thingId;
  return poster(path, null, success, error);
}

module.exports = {
  getCurrentUser: getCurrentUser,
  createThing: createThing,
  requestUpload: requestUpload,
  s3Upload: s3Upload,
  finalizeUpload: finalizeUpload,
  publishThing: publishThing,
  deleteThing: deleteThing,
  collectionsByUser: collectionsByUser,
  addThingToCollection: addThingToCollection,
  ConnectionManager: ConnectionManager
};
