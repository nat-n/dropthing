'use strict'

var FormData = require('form-data');
var https = require('https');
var url = require('url');
var querystring = require('querystring');
var lodash = require('lodash');
var config = require('./config');

var AWS = require('aws-sdk');

var HOSTNAME = 'api.thingiverse.com';


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

  if (success) req.on('response', function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function(){
      data = JSON.parse(data)
      if (data.error) {
        error(data);
      } else {
        success(data);
      }
    });
  });

  if (error) req.on('error', error);

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

  if (success) req.on('response', function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function(){ success(JSON.parse(data)); });
  });

  if (error) req.on('error', error);

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

  if (success) req.on('response', function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function(){ success(JSON.parse(data)); });
  });

  if (error) req.on('error', error);

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
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function(){ success(data); });
    }, error);

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
  addThingToCollection: addThingToCollection
};
