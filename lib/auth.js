'use strict';

var config = require('./config');
var logger = require('./logger');
var thingiverse = require('./thingiverse');
var express = require('express');
var cons = require('consolidate');
var open = require("open");

var app, server;

app = express();
app.set('views', './views')
app.engine('hbs', cons.handlebars);

app.get('/', function (req, res) {
  if (req.query.code) {
    // if provided a code, swap it for an access token, and use that to fetch
    // the user details.
    thingiverse.ConnectionManager.requestAccessToken(req.query.code,
      function (response) {
        if (response.hasOwnProperty('access_token')) {
          config.accessToken = response.access_token;
          config.saveProperty('accessToken');
          thingiverse.ConnectionManager.check(function () {
            // Return confirmation page with user details.
            logger.verbose('Successfully authenticated as user ' +
                           thingiverse.ConnectionManager.currentUser.name);
            thingiverse.collectionsByUser(function(collections){
              collections.unshift({id:'', name:'none'});
              var selected = false;
              for (var i = collections.length - 1; i >= 0; i--) {
                if (collections[i].id === parseInt(config.defaults.collectionId)) {
                  collections[i].selected = true;
                  selected = true;
                  break
                }
              };
              if (!selected) {
                collections[0] == selected;
                config.defaults.collectionId = '';
                config.saveProperty('defaults.collectionId');
              }
              res.render('index.hbs', {
                initAuth: false,
                user: thingiverse.ConnectionManager.currentUser,
                collections: collections
              });
            }, function(){
              res.render('index.hbs', {
                initAuth: false,
                user: thingiverse.ConnectionManager.currentUser
              });
            })
          });
        } else {
          logger.error('Failed to swap code for accessToken, requesting new code');
          res.render('index.hbs', {
            initAuth: true,
            clientId: config.clientId
          });
        }
      }
    );
  } else {
    // Initiate cientside authorisation loop
    res.render('index.hbs', {
      initAuth: true,
      clientId: config.clientId
    });
  }
});


app.get('/collection/:collectionId', function setCollection(req, res) {
  config.defaults.collectionId = req.params.collectionId;
  config.saveProperty('defaults.collectionId');
  res.send('OK');
});

function startServer() {
  if (server) { server.close(); }
  var server = app.listen(config.authServerPort, function () {
    var host = server.address().address
    var port = server.address().port
    logger.verbose('Auth interface server listening at http://%s:%s', host, port)
  });
}

function launchAuthPage() {
  open('http://' + server.address().address + ':' + server.address().port);
}

module.exports = {
  startServer: startServer,
  launchAuthPage: launchAuthPage
};
