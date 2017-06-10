var log = require('./log'),
    db = require('./db'),
    hooks = require('./hook'),
    config = require('config');

const days = 24*60*60*1000;

'use strict'

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Poller(){
    const today = new Date().getTime();

    hooks.enable(this, _L('hooks'));

    this.__latest_update = new Date(today - config.get('lint.rewind_on_startup')*days);
    this.__previous_update = this.__latest_update;
}

Poller.prototype.start = function(){
    if (config.get('wrms_poll.on_startup')){
        setTimeout(() => { this.poll() }, 5*1000);
    }
    setInterval(() => { this.poll() }, config.get('wrms_poll.interval_seconds')*1000);
}

function get_set_update(m){
    return function(x){
        if (x){
            this[m] = x;
        }
        return this[m];
    }
}

Poller.prototype.latest_update = get_set_update('__latest_update');

Poller.prototype.previous_update = get_set_update('__previous_update');

// FIXME: shouldn't use both > and < date comparisons (use >=)
const poll_sql =
        `SELECT
                r.request_id,
                (
                    SELECT MAX(rasub.date)
                    FROM request_activity rasub
                    WHERE rasub.request_id=r.request_id
                ) as newest
            FROM request r
            JOIN request_activity ra ON ra.request_id=r.request_id
            JOIN usr ru ON ru.user_no=r.requester_id
            JOIN organisation o ON o.org_code=ru.org_code
            WHERE ra.date > $1 AND ra.date < $2 AND
                r.system_id NOT IN (${config.get('wrms_poll.ignore_updates_for_system').join(',')}) AND
                o.org_code in (
                    SELECT DISTINCT o.org_code
                    FROM organisation o
                    JOIN org_system os ON os.org_code=o.org_code
                    JOIN work_system s ON s.system_id=os.system_id
                    JOIN system_usr su ON su.system_id=os.system_id
                    JOIN usr u ON u.user_no=su.user_no
                    WHERE o.org_code NOT IN (${config.get('wrms_poll.ignore_org_id').join(',')}) AND
                        s.system_id NOT IN (${config.get('wrms_poll.ignore_org_if_contains_system').join(',')}) AND
                        u.user_no > 4000 AND
                        u.email LIKE '${config.get('server.email_domain_like')}'
                    ORDER BY o.org_code
                )
            GROUP BY r.request_id,newest ORDER BY newest ASC`
            .replace(/\s+/g, ' ');

// Returns the list of WRs with updates since this.__latest_update
// (defaulting to ${lint.rewind_on_startup} days ago).
// Edge triggered rather than level triggered.
// Limits the future to now+7 days so as to ignore egregious timesheet typos.
Poller.prototype.poll = function(next){
    const label = _L('poll'),
        today = new Date().getTime(),
        to   = new Date(today + 7*days);

    log.debug(label + `from ${this.__latest_update} to ${to}`);

    db.get().query("poll", poll_sql, [this.__latest_update.toISOString(), to.toISOString()])
        .then(
            (data) => {
                if (data && data.rows && data.rows.length > 0){
                    this.__previous_update = this.__latest_update;

                    let newest = new Date(data.rows[data.rows.length-1].newest);
                    if (this.__latest_update < newest){
                        this.__latest_update = newest;
                    }
                    this.call_hooks(data.rows);
                }
                next && next(null, data);
            },
            (err) => {
                next && next(err);
            }
        );
}

module.exports = new Poller();


