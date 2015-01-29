'use strict';

var notifier = require('node-notifier');
var config = require('./config');


function newThing (name, id) {
  notifier.notify({
    title: 'New thing created',
    message: 'name: ' + name + ', id: ' + id,
    time: config.notificationTime
    // wait: true
  });
}


function unreachable() {
  notifier.notify({
    title: 'DropThing Error',
    message: "Thingiverse unreachable (check wifi?).",
    time: config.notificationTime
    // wait: true
  });
}


module.exports = {
	newThing: newThing,
	unreachable: unreachable
};
