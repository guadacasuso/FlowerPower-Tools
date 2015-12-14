var SyncFP = require('./SyncFP');
var FlowerPowerCloud = require('../node-flower-power-cloud/FlowerPowerCloud');
var helpers = require('./helpers');
var util = require('util');
var async = require('async');
var EventEmitter = require('events');
var clc = require('cli-color');
var Chance = require('chance');
var chance = new Chance();

function FlowerBridge() {
	EventEmitter.call(this);
	this._state = 'off';
	this.user = null;
	this.api = new FlowerPowerCloud();
};

util.inherits(FlowerBridge, EventEmitter);

FlowerBridge.prototype.loginToApi = function(credentials, callback) {
	var self = this;

	this.api.login(credentials, function(err, token) {
		if (!err) self.emit('login', token);
		if (typeof callback != 'undefined') callback(err, token);
	});
};

FlowerBridge.prototype.getState = function() {
	return (this._state);
};

FlowerBridge.prototype.getUser = function(callback) {
	var self = this;

	async.parallel({
		garden: function(callback) {
			self.api.getGarden(function(err, garden) {
				callback(err, garden);
			});
		},
		userConfig: function(callback) {
			self.api.getProfile(function(err, config) {
				callback(err, config);
			});
		},
	}, function(error, results) {
		var user = helpers.concatJson(results.userConfig, results.garden);
		var sensors = {};
		for (var i = 0; i < user.sensors.length; i++) {
			sensors[user.sensors[i].sensor_serial] = user.sensors[i];
		}
		user.sensors = sensors;
		self.user = user;
		callback(error, user);
	});
};

FlowerBridge.prototype.info = function(message) {
	this.emit('info', {
		message: message,
		date: new Date()
	});
};

FlowerBridge.prototype.error = function(message) {
	this.emit('error', {
		message: message,
		date: new Date()
	});
};

FlowerBridge.prototype.proc = function(flowerPower) {
	var self = this;

	self.emit('newProcess', flowerPower);
};

FlowerBridge.prototype.automatic = function(options) {
	var self = this;
	var delay = 15;

	if (typeof options != 'undefined' && typeof options['delay'] != 'undefinded') {
		delay = options['delay'];
	}
	self.info('New process every ' + delay + ' minutes');
	self.processAll(options);
	setInterval(function() {
		if (self._state == 'off') self.processAll(options);
	}, delay * 60 * 1000);
};

FlowerBridge.prototype.processAll = function(options) {
	var self = this;

	if (self._state == 'off') {
		self._state = 'automatic';

		self.getUser(function(err, user) {
			if (err) self.error('Error in getInformationsCloud');
			else self._makeQueud(user, options);
		});
	}
};

FlowerBridge.prototype._makeQueud = function(user, options) {
	var self = this;
	var fpPriority = [];

	if (typeof options != 'undefined') {
		if (typeof options['priority'] != 'undefined') fpPriority = options['priority'];
	}

	self.info(clc.yellow('New scan for ' + clc.bold(Object.keys(user.sensors).length) + " sensors"));
	var q = async.queue(function(task, callbackNext) {
		var FP = new SyncFP(task.uuid, user, self.api);

		FP.on('newProcess', function(flowerPower) {
			self.proc(flowerPower);
			if (flowerPower.lastProcess == 'Disconnected') return callbackNext();
		});
		FP.findAndConnect(function(err) {
			if (err) return callbackNext();
			else self.syncFlowerPower(FP, function(err, res) {
				FP.disconnect();
			});
		});
	}, 1);

	q.drain = function() {
		self.info('All FlowerPowers have been processed');
		self._state = 'off';
	}

	for (var i = 0; i < fpPriority.length; i++) {
		q.push({uuid: fpPriority[i]});
	}
	for (var uuid in user.sensors) {
		q.push({uuid: helpers.uuidCloudToPeripheral(uuid)});
	}
};

FlowerBridge.prototype.syncFlowerPower = function(FP, callback) {
	async.series([
			function(callback) {
				FP.syncSamples(callback);
			}
			// More features?
			], function(err, results) {
				callback(err, results);
			});
};

FlowerBridge.prototype.live = function() {

};

module.exports = FlowerBridge;
