var log = require('./log');

'use strict'

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function tidy(s){
    return s[0].replace(/\s+/g, ' ');
}

function Lintworm(){
    this.db = undefined;
    this.latest_update = undefined;
}

Lintworm.prototype.init = function(db){
    this.db = db;
}

const poll_sql =
    tidy`SELECT r.request_id,
                r.brief,
                ru.fullname as requested_by,
                o.org_name as org,
                sys.system_desc as system,
                stat.lookup_desc as status,
                urg.lookup_desc as urgency,
                imp.lookup_desc as importance,
                uu.fullname as updated_by,
                ra.source as update_type,
                ra.date as updated_on,
                (SELECT
                    SUM(
                        CASE WHEN work_units = 'days' THEN work_quantity*8 ELSE
                        CASE WHEN work_units = 'hours' THEN work_quantity ELSE
                        -999999
                        END END)
                    FROM request_timesheet ts
                    WHERE ts.request_id=r.request_id) as total_hours
                FROM request r
                JOIN work_system sys on r.system_id=sys.system_id
                JOIN request_activity ra on ra.request_id=r.request_id
                INNER JOIN lookup_code stat on stat.source_table='request'
                    AND stat.lookup_code=r.last_status
                INNER JOIN lookup_code urg on urg.source_table='request'
                    AND urg.source_field='urgency'
                    AND urg.lookup_code=cast(r.urgency as text)
                INNER JOIN lookup_code imp on imp.source_table='request'
                    AND imp.source_field='importance'
                    AND imp.lookup_code=cast(r.importance as text)
                JOIN usr uu on uu.user_no=ra.worker_id
                JOIN usr ru on ru.user_no=r.requester_id
                JOIN organisation o on o.org_code=ru.org_code
                WHERE ra.date > $1 AND ra.date < $2
                    AND o.org_code in (1137,1286,1328,1360,1423,1478,1484,1493,1521,1527,1562,1577,1597,1625,1690,1700,1724,1729,1730,1731,1739,1742,1743)
                ORDER BY ra.date ASC`;

Lintworm.prototype.poll = function(next){
    const days = 24*60*60*1000,
        today = new Date().getTime();
    let from = this.latest_update || new Date(today - 3*days).toISOString(),
        to   = new Date(today + 7*days).toISOString();
    log.debug(_L('poll') + `from ${from} to ${to}`);
    this.db.query(
        "poll",
        poll_sql,
        [
            from,
            to // this cuts out future timesheet entries (usually typos)
        ],
        (err, data) => {
            if (!err && data && data.rows && data.rows.length > 0){
                this.latest_update = data.rows[data.rows.length-1].updated_on;
            }
            next(err, data);
        }
    );
}

const lint_req_sql =
    tidy`SELECT r.request_id,
                r.brief,
                ru.fullname as requested_by,
                o.org_name as org,
                sys.system_desc as system,
                stat.lookup_desc as status,
                urg.lookup_desc as urgency,
                imp.lookup_desc as importance,
                (SELECT
                    SUM(
                        CASE WHEN work_units = 'days' THEN work_quantity*8 ELSE
                        CASE WHEN work_units = 'hours' THEN work_quantity ELSE
                        -999999
                        END END)
                    FROM request_timesheet ts
                    WHERE ts.request_id=r.request_id) as total_hours
                FROM request r
                JOIN work_system sys on r.system_id=sys.system_id
                INNER JOIN lookup_code stat on stat.source_table='request'
                    AND stat.lookup_code=r.last_status
                INNER JOIN lookup_code urg on urg.source_table='request'
                    AND urg.source_field='urgency'
                    AND urg.lookup_code=cast(r.urgency as text)
                INNER JOIN lookup_code imp on imp.source_table='request'
                    AND imp.source_field='importance'
                    AND imp.lookup_code=cast(r.importance as text)
                JOIN usr ru on ru.user_no=r.requester_id
                JOIN organisation o on o.org_code=ru.org_code
                WHERE r.request_id=$1`,
    lint_alloc_sql = tidy`
        SELECT ra.allocated_on,u.fullname,u.email
        FROM request_allocated ra
        JOIN usr u on u.user_no=ra.allocated_to_id
        WHERE ra.request_id=$1
    `,
    lint_quote_sql = tidy`
        SELECT  rq.quote_amount,
                rq.quote_units,
                rq.approved_by_id,
                rq.quote_cancelled_by
        FROM request_quote rq
        WHERE rq.request_id=$1
    `,
    lint_tag_sql = tidy`
        SELECT r.request_id,t.tag_description
        FROM request r
        JOIN request_tag rt on r.request_id=rt.request_id
        JOIN organisation_tag t on t.tag_id=rt.tag_id
        WHERE r.request_id=$1
    `,
    lint_activity_sql = tidy`
        SELECT ra.source,u.fullname,u.email,ra.date
        FROM request_activity ra
        JOIN usr u on u.user_no=ra.worker_id
        WHERE ra.request_id=$1
        ORDER BY ra.date ASC
    `;

Lintworm.prototype.lint = function(wr, next) {
    const label = _L('lint');
    log.debug(label + wr);
    this.db.query("lint.request", lint_req_sql, [wr], (err, req_data) => {
        if (err){ return next(err) }
        this.db.query('lint.alloc', lint_alloc_sql, [wr], (err, alloc_data) => {
            if (err){ return next(err) }
            this.db.query('lint.quotes', lint_quote_sql, [wr], (err, quote_data) => {
                if (err){ return next(err) }
                this.db.query('lint.tags', lint_tag_sql, [wr], (err, tag_data) => {
                    if (err){ return next(err) }
                    this.db.query('lint.activity', lint_activity_sql, [wr], (err, activity_data) => {
                        if (err){ return next(err) }
                        apply_lint_rules(
                            wr,
                            req_data,
                            alloc_data,
                            quote_data,
                            tag_data,
                            activity_data,
                            next
                        );
                    });
                });
            });
        });
    });
}

function contains_row_data(x){
    return x && x.rows && x.rows.length > 0;
}

function apply_lint_rules(wr, req, alloc, quote, tags, activity, next){
    const label = _L('apply_lint_rules');
    let res = [];
    // Is it assigned?
    if (contains_row_data(alloc)){
        if (alloc.rows.length > 2){ // allow some slack for the sysadmin allocations
            res.push({warning: 'Allocated to multiple people', score: -5});
        }
    }else{
        res.push({warning: 'Unallocated', score: -10});
    }
    if (req.total_hours){
        //  If work done, is it quoted?
        if (contains_row_data(quote)){
            let quoted_hours = 0,
                approved_hours = 0;
            quote.rows.forEach((r) => {
                switch(r.quote_units)
                {
                case 'hours':
                    quoted_hours += r.quote_amount;
                    if (r.approved_by_id) approved_hours += r.quote_amount;
                    break;
                case 'days':
                    quoted_hours += r.quote_amount*8;
                    if (r.approved_by_id) approved_hours += r.quote_amount*8;
                    break;
                }
            });
            //  Are the quotes approved?
            if (approved_hours < req.total_hours){
                res.push({
                    warning: `Over approved budget by ${req.total_hours-approved_hours} hours`,
                    score: -10
                });
            }
            if (quoted_hours < req.total_hours){
                res.push({
                    warning: `Over requested budget by ${req.total_hours-quoted_hours} hours`,
                    score: -10
                });
            }
        }else{
            // If not quoted, does it have "warranty" tag?
            let warranty = false;
            tags.forEach((t) => {
                if (t.tag_description.match(/^warranty$/i)){
                    warranty = true;
                }
            });
            if (warranty){
                res.push({
                    info: `Found warranty tag`,
                    score: 20
                });
            }else{
                res.push({
                    warning: `${req.total_hours} timesheeted with no quotes`,
                    score: -20
                });
            }
        }
    }else{
        // If it has more than 1 note from us, have we timesheeted at all?
        if (contains_row_data(activity)){
            let notes = activity.rows.reduce(
                (acc, val) => {
                    if (val.email.match(/catalyst/i)){
                        ++acc;
                    }
                },
                0
            );
            if (notes > 1){
                res.push({
                    warning: `${notes} note${notes === 1 ? '' : 's'} from us with no timesheets`,
                    score: -5
                });
            }
        }
    }
    if (res.length > 0){
        let score = res.reduce((acc, val) => { return acc+val.score }, 0);
        res.push({msg: `${res.length} warning ${res.length === 1 ? '' : 's'} for WR#${wr}, final score ${score}`});
    }else{
        res.push({msg: `No warnings for WR#${wr}`});
    }
    log.info(label + wr + ': ' + JSON.stringify(res, null, 2));
    return next(null, {rows: res});
}

module.exports = new Lintworm();


