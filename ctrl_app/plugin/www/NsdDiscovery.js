'use strict';

var exec = require('cordova/exec');

/**
 * NsdDiscovery — thin JS wrapper over the Android NsdDiscoveryPlugin.
 *
 * Usage:
 *   NsdDiscovery.startDiscovery('AudioAppWS', onEvent, onError);
 *   NsdDiscovery.stopDiscovery(onSuccess, onError);
 *
 * onEvent receives objects:
 *   { type: 'found', service: 'AudioAppWS', host: '192.168.x.x', port: 8080 }
 *   { type: 'lost',  service: 'AudioAppWS', host: '',             port: 0    }
 */
var NsdDiscovery = {

    startDiscovery: function (serviceName, onEvent, onError) {
        exec(onEvent, onError, 'NsdDiscovery', 'startDiscovery', [serviceName]);
    },

    stopDiscovery: function (onSuccess, onError) {
        exec(onSuccess || function () {}, onError || function () {},
             'NsdDiscovery', 'stopDiscovery', []);
    }

};

module.exports = NsdDiscovery;
