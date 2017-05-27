var log     = require('../log'),
    config	= require('config');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function TimesheetChecker(lintworm, rocket){
    this.lwm = lintworm;
    this.rocket = rocket;
}

TimesheetChecker.prototype.start = function(lintworm, rocket){
    this.lwm = lintworm || this.lwm;
    this.rocket = rocket || this.rocket;

    if (config.get('lint.check_timesheets_on_startup')){
        setTimeout(() => { this.run() }, 5*1000);
    }
    setInterval(() => { this.run() }, 24*60*60*1000);
}

TimesheetChecker.prototype.run = function(){
    let label = _L('run');
    this.lwm.timesheets((err, data) => {
        if (err){
            log.error(label + (err.stack || err));
            return;
        }
        if (data && data.rows && data.rows.length > 0){
            let too_low = data.rows.filter((r) => { return r.worked < 70; });
            if (too_low.length > 0){
                let msg = "Timesheets to chase: \n```" +
                            too_low.map((r) => {
                                return r.fullname + ' '.repeat(30 - r.fullname.length) + (r.worked|0) + '%';
                            }).join('\n')
                            + "```\n"
                log.warn(`${msg}---------------------------------\n`);
                this.rocket.send(msg);
            }
        }
    });
}

module.exports = {
    type: TimesheetChecker,
    instance: new TimesheetChecker()
};

