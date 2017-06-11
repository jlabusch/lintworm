var log     = require('../log'),
    db      = require('../db'),
    rocket  = require('../rocket'),
    config	= require('config'),
    persona = config.get('timesheets.persona'),
    muted   = config.get('timesheets.mute'),
    webhook = config.get('rocketchat.webhooks.' + persona);

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function TimesheetChecker(refs){
    this.rocket = refs.rocket || rocket;
    this.__test_hook = refs.__test_hook || function(){};
}

TimesheetChecker.prototype.start = function(){
    if (config.get('timesheets.check_on_startup')){
        setTimeout(() => { this.run() }, 5*1000);
    }
    setInterval(() => { this.run() }, config.get('timesheets.check_interval_minutes')*60*1000);
}

const timesheet_sql = `
        SELECT  u.fullname,
                u.email,
                (
                    SELECT COALESCE(SUM(rt.work_quantity),0)
                    FROM request_timesheet rt
                    WHERE rt.work_by_id=u.user_no AND
                          rt.work_on >= current_date - interval '10 days' AND
                          rt.work_on < current_date - interval '3 days'
                )/40*100 AS worked
        FROM usr u
        WHERE u.active AND
              u.email LIKE '${config.get('server.email_domain_like')}' AND
              u.username NOT LIKE 'catadmin%' AND
              u.username NOT LIKE 'sysadmin%' AND
              u.user_no NOT IN (${config.get('timesheets.exclude_users').join(',')})
        ORDER by u.fullname`
        .replace(/\s+/g, ' ');

function check_timesheets(next){
    db.get().query("timesheets", timesheet_sql)
        .then(
            (data) => { next(null, data); },
            (err) => { next(err); }
        );
}

const miagi = [
    "It’s ok to lose to opponent. It’s never okay to lose to fear",
    "You trust the quality of what you know, not quantity",
    "Never put passion in front of principle, even if you win, you’ll lose",
    "Never trust spiritual leader who cannot dance",
    "Daniel-San, lie become truth only if person wanna believe it",
    "Wax on, wax off. Wax on, wax off"
];

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
                let quote = (Math.random() * miagi.length)|0;
                let msg = `${miagi[quote]}: \n` + "```" +
                            too_low.map((r) => {
                                return r.fullname + ' '.repeat(30 - r.fullname.length) + (r.worked|0) + '%';
                            }).join('\n')
                            + "```\n"
                log.warn(`${msg}---------------------------------\n`);
                this.rocket.send(msg).to(muted ? null : webhook).then(this.__test_hook);
            }
        }
    });
}

module.exports = TimesheetChecker;

