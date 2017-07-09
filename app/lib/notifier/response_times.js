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

const mins = 60*1000,
      hours = 60*mins;

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function ResponseTimer(refs){
    this.rocket = refs.rocket || rocket;
    this.__test_hook = refs.__test_hook; // __test_hook !== undefined means we're in a unit test,
                                         // so don't setTimeout()
    this.__test_time_now = undefined;

    if (refs.__test_overrides){
        if (refs.__test_overrides.hook){
            this.__test_hook = refs.__test_overrides.hook;
        }
        if (refs.__test_overrides.config){
            config = refs.__test_overrides.config;
        }
        if (refs.__test_overrides.now){
            this.__test_time_now = refs.__test_overrides.now;
        }
    }
}

ResponseTimer.prototype.start = function(notifier){
    notifier.linting.add_hook('response_times', context => { this.run(context) });
}

// If urgency is low but importance is high, we should probably respond.
// Convert importance into the corresponding urgency and return the highest.
function max_urgency(urg, imp){
    const imps  = [
        "Minor importance",
        "Average importance",
        "Major importance",
        "Critical!"
    ];
    let imp_n = imps.indexOf(imp);

    const urgs = {
        "Anytime": 0,
        "Sometime soon": 1,
        "As Soon As Possible": 2,
        "'Yesterday'": 3,
        // Nothing in "importance" can top these:
        "Before Specified Date": 4,
        "On Specified Date": 4,
        "After Specified Date": 4
    };
    let urg_n = urgs[urg];

    if (imp_n > urg_n){
        return Object.keys(urgs).find(x => {return urgs[x] === imp_n});
    }

    return urg;
}

// Return {
//   warn: boolean,
//   warn_in: ms from now,
//   overdue: boolean,
//   due_in: ms from now
// }
//
// Inputs are req.created_on, req.urgency, req.importance and config.
//
// response_times.urgency_hours give you the response time windows.
// response_times.warn_at_X_percent gives you the warn/overdue split.
//
// If it's due by a specific date, assume due at noon and figure out warn_in and due_in.
// Otherwise, created_on + urgency_hours gives you warn_in and due_in.
// Extend warn_in and due_in as needed to fall within a business day (for non-Critical.)
//
ResponseTimer.prototype.__lateness = function(req){
    const label = _L('lateness');

    const rt_hours = config.get('response_times.urgency_hours'),
        warn_percent = config.get('response_times.warn_at_X_percent')/100,
        now = this.__test_time_now || new Date(),
        then = new Date(req.created_on).getTime(),
        urgency = max_urgency(req.urgency, req.importance);

    if (urgency === 'After Specified Date'){
        // Can't really be late
        return null;
    }

    let due_at  = undefined,
        warn_at = undefined,
        type = 'sla';

    // Agreed-due and requested-by-date overrides urgency
    // USUALLY these are only set for urgency == {Before,On} Specified Date
    const fixed_due_date = req.agreed_due_date || req.requested_by_date;
    if (fixed_due_date){
        // Agreed due is more important than requested by
        due_at = (new Date(fixed_due_date)).getTime() + 12*hours;
        warn_at = then + (due_at - then)*warn_percent;
        type = 'fixed';
    }else{
        let time_limit = rt_hours[urgency];

        if (!time_limit){
            log.trace(label + 'No agreed_due_date or requested_by_date and no response_times.urgency_hours');
            return null;
        }

        const work_hours_per_day = 8,
            work_end_hour = 17,
            hour_now = now.getHours() + now.getMinutes()/60,
            hours_until_work_end = work_end_hour - hour_now,
            work_hours_left_today = Math.min(hours_until_work_end, work_hours_per_day);

        if (urgency === "'Yesterday'" || time_limit <= work_hours_left_today){
            // Then we need to take care of it on this calendar* day
            due_at = then + time_limit*hours;
            warn_at = then + time_limit*hours*warn_percent;
        }else{
            // Push to a future business day
            function push(limit){
                let offset_hours = 0,
                    day_of_week = now.getDay(); // FIXME: "then" instead of "now"?

                const started_on_business_day = day_of_week > 0 && day_of_week < 6;

                // If this is a weekend, immediately push to Monday
                function skip_weekend(){
                    switch(day_of_week){
                        case 6:
                            offset_hours += 24;
                            // fall through
                        case 7:
                        case 0:
                            offset_hours += 24;
                            day_of_week = 1;
                    }
                }

                skip_weekend();

                // Eat up the rest of today
                if (started_on_business_day && work_hours_left_today > 0){
                    limit -= work_hours_left_today;
                }

                while (limit >= work_hours_per_day){
                    ++day_of_week;
                    offset_hours += 24;

                    skip_weekend();

                    limit -= work_hours_per_day;
                }

                return then + offset_hours + limit;
            }

            warn_at = push(time_limit*warn_percent)*hours;
            due_at = push(time_limit)*hours;
        }

    }

    const now_t = now.getTime();

    return {
        message_type: type,
        warn_in: warn_at - now_t,
        warn:    now_t > warn_at,
        due_in:  due_at - now_t,
        overdue: now_t > due_at
    };
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

// Called for follow-up checks (i.e. when we don't have a hook feeding us data.)
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

// A status update by itself is not a response.
function complain_if_no_note_for_status(s){
    let statuses = {
        'Allocated':            true,
        'Catalyst Testing':     true,
        'Development Complete': true,
        'Failed Testing':       true,
        'In Progress':          true,
        'Need Info':            true,
        'Needs Documenting':    true,
        'New request':          true,
        'Pending QA':           true,
        'Provide Feedback':     true,
        'Quoted':               true,
        'Ready for Staging':    true,
        'Request for Quote':    true,
        'Reviewed':             true,
        'Testing/Signoff':      true,

        'Blocked':              false, // client abrt
        'Cancelled':            false, // client abrt
        'Finished':             false,
        'For Sign Off':         false, // implicit ack from client
        'On Hold':              false, // client abrt
        'Ongoing Maintenance':  false,
        'Parked':               false, // client abrt
        'Production Ready':     false, // implicit ack from client
        'QA Approved':          false, // implicit ack from client
        'Quote Approved':       false  // response might be in quote detail
    };
    return statuses[s];
}

function raised_by_us(activity_rows){
    if (!activity_rows){
        return false;
    }

    if (!Array.isArray(activity_rows)){
        return false;
    }

    const first_status = activity_rows.find(x => { x.source === 'status' });

    if (!first_status){
        return false;
    }

    return our_email_domain(first_status.email);
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

    if (!complain_if_no_note_for_status(req.status)){
        log.info(label + "WR# " + req.request_id + ' status ' + req.status + " is safe, not chasing");
        this.__test_hook && this.__test_hook(null, {__safe_status: true});
        return;
    }

    if (raised_by_us(rows)){
        log.info(label + "WR# " + req.request_id + ' was raised by us, not chasing');
        this.__test_hook && this.__test_hook(null, {__raised_by_us: true});
        return;
    }

    const state = this.__lateness(req);

    if (!state){
        log.debug(label + "urgency time contraints are null, this check doesn't apply");
        this.__test_hook && this.__test_hook(null, {__no_urgency: true});
        return;
    }

    let next_check_in = undefined,
        msg = undefined;

    let messages = {
        overdue: {
            sla: "is past due for response, we're probably breaching SLA",
            fixed: "should have been done by now, please follow up"
        },
        warn: {
            sla: "needs to be responded to, please",
            fixed: "has a deadline coming up soon"
        }
    };

    if (state.overdue){
        next_check_in = config.get('response_times.chase_overdue_every_X_mins')*mins;
        msg = messages.overdue[state.message_type];
    }else if (state.warn){
        next_check_in = state.due_in;
        msg = messages.warn[state.message_type];
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

