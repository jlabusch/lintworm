var log     = require('../log'),
    config	= require('config'),
    our_email_domain = require('../our_email_domain'),
    db      = require('../db'),
    rocket  = require('../rocket'),
    format  = rocket.format,
    channels= config.get('rocketchat.channels'),
    webhook = config.get('rocketchat.firehose');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function ResponseTimer(refs){
    this.rocket = refs.rocket || rocket;
    this.__test_hook = refs.__test_hook || function(){};
}

ResponseTimer.prototype.start = function(notifier){
    notifier.linting.add_hook('response_times', context => { this.run(context) });
}

function lateness(urg, created_on){
    const cfg = config.get('response_times.urgency_hours');

    if (!cfg[urg]){
        // {Before,On,After} Specified Date
        return null;
    }

    const then = new Date(created_on).getTime(),
        mins = 60*1000,
        hours = 60*mins,
        due_at = then + cfg[urg]*hours,
        warn_at = due_at - config.get('response_times.warn_at_X_mins_left')*mins;

    const now = new Date().getTime();

    let result = {
        warn_at: warn_at,
        warn_in: warn_at - now,
        warn: now > warn_at,
        due_at: due_at,
        due_in: due_at - now,
        overdue: now > due_at
    };

    return result;
}

let notes_sql = `
        SELECT  u.fullname,
                u.email,
                ra.source
        FROM request_activity ra
        JOIN usr u ON u.user_no=ra.worker_id
        WHERE ra.request_id=$1 AND
            ra.source = 'note'
        ORDER BY ra.date ASC
    `.replace(/\s+/g, ' ');

function note_checker(wr, next){
    return function(){
        db.get().query("notes", notes_sql, [wr])
            .then(
                (data) => { next(null, data); },
                (err) => { next(err); }
            );
    }
}

function notes_by_us(list){
    return list.reduce((acc, val) => {
            if (val.source === 'note' && our_email_domain(val.email)){
                ++acc;
            }
            log.trace(_L('notes_by_us') + acc + JSON.stringify(val));
            return acc;
        },
        0
    );
}

ResponseTimer.prototype.check_lateness_and_set_timeout = function(data, req){
    const label = _L('check');

    log.trace(label + 'checking lateness of WR# ' + req.request_id);

    let rows = data && data.rows ? data.rows : [],
        n = notes_by_us(rows);

    if (n > 0){
        log.debug(label + `${req.request_id} has ${n} responses by us`);
        return;
    }

    if (!req.system.match(/(Hosting)|(Service.Level.Agreement)|(?:^|_|\b)SLA(?:$|_|\b)/)){
        log.info(label + "WR# " + req.request_id + ' ' + req.system + " isn't a Hosting or SLA system, skipping...");
        return;
    }

    const state = lateness(req.urgency, req.created_on),
        mins = 60*1000;

    if (!state){
        log.debug(label + "urgency time contraints are null, this check doesn't apply");
        return;
    }

    let next_check_in = undefined,
        msg = undefined;

    if (state.overdue){
        next_check_in = config.get('response_times.chase_overdue_every_X_mins')*mins;
        msg = 'is past due for response, we\'re breaching SLA';
    }else if (state.warn){
        next_check_in = state.due_in;
        msg = 'needs to be responded to, please';
    }else{
        next_check_in = state.warn_in;
    }

    log.trace(label + 'next check for WR# ' + req.request_id + ' in ' + next_check_in + 'ms');

    if (msg){
        const org = format.org(req.org),
            chan = channels[org];

        let s = `${org} ${format.wr(req.request_id)} (${req.urgency}) ${msg}\n`;
        log.info(label + s);
        this.rocket.send(s).to(webhook).channel(chan).then(this.__test_hook);
    }

    setTimeout(
        note_checker(req.request_id, (err, data) => {
            log.trace(label + '(callback) rechecking WR# ' + req.request_id);
            if (err){
                log.error(label + err);
                return;
            }
            this.check_lateness_and_set_timeout(data, req);
        }),
        next_check_in
    );
}

ResponseTimer.prototype.run = function(context){
    this.check_lateness_and_set_timeout(context.activity, context.req);
}

module.exports = ResponseTimer;
