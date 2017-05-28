var log     = require('../log'),
    config	= require('config');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Notifier(lintworm, rocket){
    this.lwm = lintworm || require('../lintworm');
    this.rocket = rocket || require('../rocket');

    this.notifiers = ['linting', 'timesheets', 'wr_updates'];

    this.notifiers.forEach((n) => {
        let type = require('./' + n);
        this[n] = new type(this);
    });
}

Notifier.prototype.start = function(){
    this.notifiers.forEach((n) => {
        this[n].start();
    });
}

Notifier.prototype.run = function(subroutine){
    this[subroutine].run();
}

module.exports = {
    notifier: new Notifier(),
    type: Notifier
}


