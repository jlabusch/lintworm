var log = require('./log'),
    db = require('./db'),
    hooks = require('./hook'),
    config = require('config');

const days = 24*60*60*1000;

'use strict'

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function tidy(s){
    return s[0].replace(/\s+/g, ' ');
}

function Poller(){
    const today = new Date().getTime();

    hooks.enable(this, _L('hooks'));

    this.__latest_update = new Date(today - config.get('lint.rewind_on_startup')*days);
}

Poller.prototype.start = function(){
    if (config.get('server.wrms_poll_on_startup')){
        setTimeout(() => { this.poll() }, 5*1000);
    }
    setInterval(() => { this.poll() }, config.get('server.wrms_poll_interval_seconds')*1000);
}

Poller.prototype.set_latest_update = function(d){
    this.__latest_update = d;
}

// FIXME: shouldn't use both > and < date comparisons (use >=)
const poll_sql =
        tidy`SELECT
                r.request_id,
                (
                    SELECT MAX(rasub.date)
                    FROM request_activity rasub
                    WHERE rasub.request_id=r.request_id
                ) as newest
            FROM request r
            JOIN work_system sys ON r.system_id=sys.system_id
            JOIN request_activity ra ON ra.request_id=r.request_id
            INNER JOIN lookup_code stat ON stat.source_table='request' AND
                        stat.lookup_code=r.last_status
            INNER JOIN lookup_code urg ON urg.source_table='request' AND
                        urg.source_field='urgency' AND
                        urg.lookup_code=cast(r.urgency as text)
            INNER JOIN lookup_code imp ON imp.source_table='request' AND
                        imp.source_field='importance' AND
                        imp.lookup_code=cast(r.importance as text)
            JOIN usr ru ON ru.user_no=r.requester_id
            JOIN organisation o ON o.org_code=ru.org_code
            WHERE ra.date > $1 AND ra.date < $2 AND
                r.system_id NOT IN (2881,2657,2758) AND
                o.org_code in (
                    SELECT o.org_code
                    FROM organisation o
                    JOIN org_system os ON os.org_code=o.org_code
                    JOIN work_system s ON s.system_id=os.system_id
                    JOIN system_usr su ON su.system_id=os.system_id
                    JOIN usr u ON u.user_no=su.user_no
                    WHERE o.org_code NOT IN (37,1098,1185,1137) AND
                        s.system_id NOT IN (18,164) AND
                        u.user_no > 4000 AND
                        u.email LIKE '%catalyst-eu.net' )
            GROUP BY r.request_id,newest ORDER BY newest ASC`;

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
                    let newest = new Date(data.rows[data.rows.length-1].newest);
                    if (this.__latest_update < newest){
                        this.__latest_update = newest;
                    }
                    this.call_hooks(data.rows);
                }
                next(null, data);
            },
            (err) => {
                next(err);
            }
        );
}

module.exports = new Poller();


