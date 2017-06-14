var log     = require('../log'),
    config	= require('config'),
    our_email_domain = require('../our_email_domain'),
    db      = require('../db'),
    rocket  = require('../rocket'),
    format  = rocket.format,
    sla_or_hosting_match=require('../sla_match'),
    channels= config.get('response_times.stick_to_default_channel')
                ? {}
                : config.get('rocketchat.channels'),
    persona = config.get('response_times.persona'),
    muted   = config.get('response_times.mute'),
    webhook = config.get('rocketchat.webhooks.' + persona);

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function ResponseTimer(refs){
    this.rocket = refs.rocket || rocket;
    this.__test_hook = refs.__test_hook; // __test_hook !== undefined means we're in a unit test,
                                         // so don't setTimeout()
    if (refs.__test_overrides){
        if (refs.__test_overrides.hook){
            this.__test_hook = refs.__test_overrides.hook;
        }
        if (refs.__test_overrides.config){
            config = refs.__test_overrides.config;
        }
    }
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
        warn_in: warn_at - now,
        warn: now > warn_at,
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
    return list.reduce(
        (acc, val) => {
            if (val.source === 'note' && our_email_domain(val.email)){
                ++acc;
            }
            return acc;
        },
        0
    );
}

function open_wr_status(s){
    return [
        'New request',
        'Allocated',
        'In Progress',
        'Failed Testing',
        'Provide Feedback',
        'Need Info',
        'Request for Quote'
    ].indexOf(s) >= 0;
}

ResponseTimer.prototype.check_lateness_and_set_timeout = function(data, req){
    const label = _L('check');

    log.trace(label + 'checking lateness of WR# ' + req.request_id);

    let rows = data && data.rows ? data.rows : [],
        n = notes_by_us(rows);

    if (n > 0){
        log.debug(label + `${req.request_id} has ${n} responses by us`);
        this.__test_hook && this.__test_hook(null, {__have_responded: true});
        return;
    }

    if (!sla_or_hosting_match(req.system)){
        log.info(label + "WR# " + req.request_id + ' ' + req.system + " isn't a Hosting or SLA system, skipping...");
        this.__test_hook && this.__test_hook(null, {__not_sla: true});
        return;
    }

    if (!open_wr_status(req.status)){
        log.info(label + "WR# " + req.request_id + ' status ' + req.status + " is safe, not chasing");
        this.__test_hook && this.__test_hook(null, {__safe_status: true});
        return;
    }

    const state = lateness(req.urgency, req.created_on),
        mins = 60*1000;

    if (!state){
        log.debug(label + "urgency time contraints are null, this check doesn't apply");
        this.__test_hook && this.__test_hook(null, {__no_urgency: true});
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
        this.rocket.send(s).to(muted ? null : webhook).channel(chan).then(this.__test_hook);
    }else{
        this.__test_hook && this.__test_hook(null, {__ok: true});
    }

    if (this.__test_hook){
        log.trace(label + 'in unit test, not calling setTimeout()');
        return;
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

