var log     = require('../log'),
    config	= require('config'),
    webhook = config.get('rocketchat.timesheet');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function TimesheetChecker(refs){
    this.lwm = refs.lwm;
    this.rocket = refs.rocket;
}

TimesheetChecker.prototype.start = function(){
    if (config.get('timesheets.check_on_startup')){
        setTimeout(() => { this.run() }, 5*1000);
    }
    setInterval(() => { this.run() }, config.get('timesheets.check_interval_minutes')*60*1000);
}

TimesheetChecker.prototype.run = function(){
    let label = _L('run');
    this.lwm.check_timesheets((err, data) => {
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
                this.rocket.send(msg).to(webhook);
            }
        }
    });
}

module.exports = TimesheetChecker;

