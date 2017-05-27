var log     = require('../log'),
    config	= require('config');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Notifier(lintworm, rocket){
    this.lwm = lintworm || require('../lintworm');
    this.rocket = rocket || require('../rocket');
}

Notifier.prototype.start = function(){
    require('./linting').instance.start(this.lwm, this.rocket);
    require('./timesheets').instance.start(this.lwm, this.rocket);
}

module.exports = {
    notifier: new Notifier(),
    type: Notifier
}


