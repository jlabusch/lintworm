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
    hours = 60*mins,
    work_hours_per_day = 8,
    work_end_hour = 17,
    work_start_hour = work_end_hour - work_hours_per_day;


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

// Returns relative msec timestamp of the gap between the end of current_day
// to the start of the next business day.
//
ResponseTimer.prototype.__time_to_next_business_period = function(current_day){
    let result_hours = 0;

    switch(current_day){
        case 5: // Fri
            result_hours += 24;
        case 6: // Sat
            result_hours += 24;
        default:
            // find tomorrow
            result_hours += 24-work_end_hour + work_start_hour;
    }

    return result_hours*hours;
}

// start_date should be an absolute Date,
// hours_to_add should be a relative number of hours (hours, e.g. 12, not msec timestamp).
//
// Returns absolute msec timestamp rather than a Date.
//
ResponseTimer.prototype.__add_business_hours = function(start_date, hours_to_add){

    let rel_time  = start_date.getHours() * hours +
                    start_date.getMinutes() * mins +
                    start_date.getSeconds() * 1000 +
                    start_date.getMilliseconds(),
        final_adjustment = 0,
        time_added = 0;

    // If start_date is after business hours, pretend the request came in
    // right at the end of the working day.
    const work_end_time = work_end_hour * hours;
    if (rel_time > work_end_time){
        final_adjustment = work_end_time - rel_time;
        rel_time = work_end_time;
    }

    let time_left_to_add = hours_to_add*hours;

    const label = _L('__add_business_hours');

    while (time_left_to_add > 0){
        const available = work_end_hour*hours - rel_time;

        log.trace(label + `time_added:       ${time_added/hours} hours,
                           time_left_to_add: ${time_left_to_add/hours} hours,
                           time available:   ${available/hours} hours`
                           .replace(/\s+/g, ' '));

        if (time_left_to_add <= available){
            log.trace(label + `+${time_left_to_add/hours} hours => done`);
            time_added += time_left_to_add;
            log.trace(label + `Total: ${time_added/hours} hours`);
            time_left_to_add = 0;
        }else{
            if (available > 0){
                time_added += available;
                time_left_to_add -= available;
                log.trace(label + `+${available/hours} hours => need another day`);
            }

            // go to next day
            let curr = new Date(start_date.getTime() + time_added),
                jump = this.__time_to_next_business_period(curr.getDay());
            time_added += jump;
            log.trace(label + `+${jump/hours} hours to next work morning at ${work_start_hour}am`);
            rel_time = work_start_hour*hours;
        }
    }

    return start_date.getTime() + time_added + final_adjustment;
}

// Returns {
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
// If it's due by a specific date, assume due at 4pm and figure out warn_in and due_in.
// Otherwise, created_on + urgency_hours gives you warn_in and due_in.
// Extend warn_in and due_in as needed to fall within a business day (for non-Critical.)
//
ResponseTimer.prototype.__lateness = function(req){
    const label = _L('lateness');

    const rt_hours = config.get('response_times.urgency_hours'),
        warn_percent = config.get('response_times.warn_at_X_percent')/100,
        now = this.__test_time_now || new Date(),
        now_time = now.getTime(),
        then = new Date(req.created_on),
        then_time = then.getTime(),
        urgency = max_urgency(req.urgency, req.importance);

    if (urgency === 'After Specified Date'){
        // Can't really be late
        return null;
    }

    let due_at  = undefined,
        warn_at = undefined,
        type = 'dynamic'; // or "fixed"

    // Agreed-due and requested-by-date overrides urgency
    // USUALLY these are only set for urgency == {Before,On} Specified Date.
    // Agreed due is more important than requested by.
    const fixed_due_date = req.agreed_due_date || req.requested_by_date;
    if (fixed_due_date){
        due_at = (new Date(fixed_due_date)).getTime() + 16*hours;
        warn_at = then_time + (due_at - then_time)*warn_percent;
        type = 'fixed';
    }else{
        let time_limit = rt_hours[urgency];

        if (!time_limit){
            log.trace(label + 'No agreed_due_date or requested_by_date and no response_times.urgency_hours');
            return null;
        }

        if (urgency === "'Yesterday'"){
            // Then we need to take care of it on this calendar* day
            due_at = then_time + time_limit*hours;
            warn_at = then_time + time_limit*hours*warn_percent;
        }else{
            due_at = this.__add_business_hours(then, time_limit);
            warn_at = this.__add_business_hours(then, time_limit*warn_percent);
        }

    }

    return {
        message_type: type,
        warn_in: warn_at - now_time,
        warn:    now_time > warn_at,
        due_in:  due_at - now_time,
        overdue: now_time > due_at
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
            dynamic: "is past due for response, we're probably breaching SLA",
            fixed: "should have been done by now, please follow up"
        },
        warn: {
            dynamic: "needs to be responded to, please",
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

