var log     = require('../log'),
    db      = require('../db'),
    rocket  = require('../rocket'),
    config	= require('config'),
    webhook = config.get('rocketchat.timesheet');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function TimesheetChecker(refs){
    this.rocket = refs.rocket || rocket;
    this.__test_hook = refs.__test_hook || function(){};
}

TimesheetChecker.prototype.start = function(notifier){
    if (config.get('timesheets.check_on_startup')){
        setTimeout(() => { this.run() }, 5*1000);
    }
    setInterval(() => { this.run() }, config.get('timesheets.check_interval_minutes')*60*1000);
}

const timesheet_sql = `
        SELECT u.fullname,
               u.email,
               SUM(rt.work_quantity)/40*100 AS worked
        FROM request_timesheet rt
        JOIN usr u ON u.user_no=rt.work_by_id
        WHERE u.email LIKE '%catalyst-eu.net' AND
              rt.work_on >= current_date - interval '10 days' AND
              rt.work_on < current_date - interval '3 days'
        GROUP by u.fullname,u.email
        ORDER by u.fullname`
        .replace(/\s+/g, ' ');

function check_timesheets(next){
    db.get().query("timesheets", timesheet_sql)
        .then(
            (data) => { next(null, data); },
            (err) => { next(err); }
        );
}

TimesheetChecker.prototype.run = function(){
    let label = _L('run');
    check_timesheets((err, data) => {
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
                this.rocket.send(msg).to(webhook).then(this.__test_hook);
            }
        }
    });
}

module.exports = TimesheetChecker;

