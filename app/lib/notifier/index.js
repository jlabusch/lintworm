'use strict';

function Notifier(lintworm, rocket){
    this.rocket = rocket || require('../rocket');

    this.notifiers = ['linting', 'timesheets', 'updates'];

    this.notifiers.forEach((n) => {
        let type = require('./' + n);
        this[n] = new type(this);
    });
}

Notifier.prototype.start = function(){
    this.notifiers.forEach((n) => {
        this[n].start(this);
    });
}

Notifier.prototype.run = function(subroutine){
    this[subroutine].run();
}

module.exports = {
    notifier: new Notifier(),
    type: Notifier
}


