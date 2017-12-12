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
                    SELECT array_to_string(
                        array(
                            SELECT COALESCE(SUM(rt.work_quantity),0)
                            FROM (SELECT generate_series('__DATE1', '__DATE2', interval '1 day') AS d) dates
                            LEFT JOIN request_timesheet rt ON
                                date_trunc('day', dates.d)=date_trunc('day', rt.work_on) AND
                                rt.work_by_id=u.user_no
                            GROUP by dates.d
                            ORDER by dates.d
                        ),
                        ','
                    )
                ) AS history,
                (
                    SELECT COALESCE(SUM(rt.work_quantity),0)
                    FROM request_timesheet rt
                    WHERE rt.work_by_id=u.user_no AND
                          rt.work_on >= current_date - interval '14 days'
                )/80*100 AS worked
        FROM usr u
        WHERE u.active AND
              u.email LIKE '${config.get('server.email_domain_like')}' AND
              u.username NOT LIKE 'catadmin%' AND
              u.username NOT LIKE 'sysadmin%' AND
              u.user_no NOT IN (${config.get('timesheets.exclude_users').join(',')})
        ORDER by u.fullname`
        .replace(/\s+/g, ' ');

function check_timesheets(next){
    let now = new Date(),
        date2 = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate();

    now.setDate(now.getDate() - 14);

    let date1 = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate();

    db.get().query("timesheets", timesheet_sql.replace('__DATE1', date1).replace('__DATE2', date2))
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

function format_history(h){
    return h.split(',')
            .map(
                n => {
                    let i = parseFloat(n);
                    if (isNaN(i)){
                        i = 0;
                    }
                    if (i > 6){
                        return '#';
                    }else if (i > 4){
                        return '=';
                    }else if (i > 2){
                        return '-';
                    }else{
                        return '_';
                    }
                }
            ).join('');
}

TimesheetChecker.prototype.run = function(){
    let label = _L('run');
    check_timesheets((err, data) => {
        if (err){
            log.error(label + err);
            this.__test_hook && this.__test_hook(err);
            return;
        }
        if (data && data.rows && data.rows.length > 0){
            let too_low = data.rows.filter((r) => { return r.worked < 85; });
            if (too_low.length > 0){
                let quote = (Math.random() * miagi.length)|0;
                let msg = `${miagi[quote]}: \n` + "```" +
                            too_low.map((r) => {
                                let hist = format_history(r.history);
                                return r.fullname + ' '.repeat(30 - r.fullname.length) + hist + '  ' + (r.worked|0) + '%';
                            }).join('\n')
                            + "```\n"
                log.warn(`${msg}---------------------------------\n`);
                this.rocket.send(msg).to(muted ? null : webhook).then(this.__test_hook);
            }
        }
    });
}

module.exports = TimesheetChecker;

