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
    this.poll_cache = [];
}

Lintworm.prototype.init = function(db){
    this.db = db;
}

// FIXME: shouldn't hardcode org codes, shouldn't use both > and < date comparisons (use >=)
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
                    AND o.org_code in (1137,1286,1328,1360,1423,1478,1484,1493,1521,1527,1562,1577,1597,1625,1690,1700,1724,1729,1730,1731,1739,1742,1743,1759)
                ORDER BY ra.date ASC`;

// Returns the list of WRs with updates we haven't processed yet.
// Limits the future to now+7 days so as to ignore egregious timesheet typos.
Lintworm.prototype.poll = function(next){
    const days = 24*60*60*1000,
        today = new Date().getTime(),
        label = _L('poll');
    let from = this.poll_cache.length ?
                    this.poll_cache[0].updated_on : // oldest unprocessed update
                    this.latest_update ?
                        this.latest_update : // newest processed update
                        new Date(today - 3*days).toISOString(),
        to   = new Date(today + 7*days).toISOString();
    log.debug(label + `from ${from} to ${to}`);
    this.db.query(
        "poll",
        poll_sql,
        [
            from,
            to
        ],
        (err, data) => {
            if (!err && data && data.rows && data.rows.length > 0){
                this.latest_update = data.rows[data.rows.length-1].updated_on;
                // Append new items to poll_cache.
                // In practice these data sets are small, don't @ me for linear search.
                let i = 0;
                if (this.poll_cache.length){
                    i = data.rows.findIndex((x) => {
                        return (new Date(x.updated_on) > new Date(this.poll_cache[this.poll_cache.length-1].updated_on));
                    });
                }
                if (i < 0){
                    // Nothing is new
                }else{
                    this.poll_cache = this.poll_cache.concat(data.rows.slice(i));
                }
                log.debug(label + 'poll_cache: ' + JSON.stringify(this.poll_cache.map((r) => { return {request_id: r.request_id, updated_on: r.updated_on} }), null, 2));
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
    `,
    lint_parent_sql = tidy`
        WITH RECURSIVE relations AS (
            SELECT *
                FROM request_request
                WHERE link_type='I' AND to_request_id=$1
            UNION
            SELECT rr.*
                FROM request_request rr
                JOIN relations r
                ON (r.request_id = rr.to_request_id AND rr.link_type='I')
        )
        SELECT *,
            (SELECT SUM(
                CASE WHEN q.quote_units='days' THEN q.quote_amount*8 ELSE
                CASE WHEN q.quote_units='hours' THEN q.quote_amount ELSE
                -99999 END END) as quoted_hours
            FROM request_quote q
            WHERE q.request_id=relations.request_id),
            (SELECT SUM(
                CASE WHEN q.quote_units='days' THEN q.quote_amount*8 ELSE
                CASE WHEN q.quote_units='hours' THEN q.quote_amount ELSE
                -99999 END END) as approved_hours
            FROM request_quote q
            WHERE q.request_id=relations.request_id AND q.approved_by_id IS NOT NULL)
        FROM relations
    `;

Lintworm.prototype.lint = function(wr, next) {
    const label = _L('lint');
    log.debug(label + wr);
    // Remove this WR from the list of unprocessed updates
    this.poll_cache = this.poll_cache.filter((r) => {
        if (r.request_id === wr){
            log.debug(label + `removing WR# ${wr} update ${r.updated_on}`);
            return false;
        }
        return true;
    });
    log.debug(label + 'poll_cache: ' + JSON.stringify(this.poll_cache.map((r) => { return {request_id: r.request_id, updated_on: r.updated_on} }), null, 2));
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
                        this.db.query('lint.relations', lint_parent_sql, [wr], (err, parent_data) => {
                            if (err){ return next(err) }
                            apply_lint_rules(
                                wr,
                                req_data,
                                alloc_data,
                                quote_data,
                                tag_data,
                                activity_data,
                                parent_data,
                                next
                            );
                        });
                    });
                });
            });
        });
    });
}

function contains_row_data(x){
    return x && x.rows && x.rows.length > 0;
}

function format_author(row){
    return row.email;
}

function apply_lint_rules(wr, req, alloc, quote, tags, activity, parents, next){
    const label = _L('apply_lint_rules');
    let res = [],
        author = [];
    // TODO:
    //  - Have we been timesheeting without updating the WR notes?

    // Is it assigned?
    if (contains_row_data(alloc)){
        if (alloc.rows.length > 2){ // allow some slack for the sysadmin allocations
            res.push({warning: 'Allocated to multiple people', score: -5});
        }
        alloc.rows.forEach((x) => {
            if (!x.email || !x.fullname){
                log.error(label + 'invalid user: ' + JSON.stringify(x, null, 2));
                res.push({
                    error: `Allocated to invalid user ${x.fullname} <${x.email}>`,
                    score: -5
                });
                return;
            }
            if (x.email.match(/catalyst/) && x.fullname !== 'Catalyst Sysadmin Europe'){
                author.push(format_author(x));
            }
        });
    }else{
        if (req.status !== 'Finished' && req.status !== 'Cancelled'){
            res.push({warning: 'Unallocated', score: -10});
        }
    }
    if (req.total_hours){
        //  If work done, is it quoted?
        if (contains_row_data(quote)){
            let sq = sum_quotes(quote.rows);
            //  Are the quotes approved?
            if (sq.approved < req.total_hours){
                res.push({
                    warning: `Over approved budget by ${req.total_hours-sq.approved} hours`,
                    score: -10
                });
            }
            if (sq.quoted < req.total_hours){
                res.push({
                    warning: `Over requested budget by ${req.total_hours-sq.quoted} hours`,
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
                let parent_quote = false;
                // Is there a direct or indirect parent WR with a quote?
                if (contains_row_data(parents)){
                    let dpq = {quoted: 0, approved: 0};
                    parents.row.forEach((r) => {
                        if (r.quoted_hours){   dpq.quoted   += r.quoted_hours   }
                        if (r.approved_hours){ dpq.approved += r.approved_hours }
                    });
                    parent_quote = !!(dpq.quoted || dpq.approved);
                    if (parent_quote){
                        let over = false;
                        if (dpq.approved < req.total_hours){
                            over = true;
                            res.push({
                                warning: `Over parent WR's approved budget by ${req.total_hours-dpq.approved_hours} hours (without checking siblings)`,
                                score: -10
                            });
                        }
                        if (dpq.quoted < req.total_hours){
                            over = true;
                            res.push({
                                warning: `Over parent WR's requested budget by ${req.total_hours-dpq.quoted_hours} hours (without checking siblings)`,
                                score: -10
                            });
                        }
                        if (!over){
                            res.push({
                                info: `Within parent WR's quoted budget, but haven't considered other related WRs`,
                                score: -5
                            });
                        }
                    }
                }

                if (!parent_quote){
                    res.push({
                        warning: `${req.total_hours} timesheeted with no quotes`,
                        score: -20
                    });
                }
            }
        }
    }else{
        // If it has more than 1 note from us, have we timesheeted at all?
        if (contains_row_data(activity)){
            let updater = undefined;
            let notes = activity.rows.reduce(
                (acc, val) => {
                    if (!val.email){
                        log.trace(label + 'invalid user: ' + JSON.stringify(val, null, 2));
                        return;
                    }
                    if (val.email.match(/catalyst/i)){
                        ++acc;
                        updater = format_author(val);
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
            if (updater && author.findIndex((x) => { return x === updater }) < 0){
                author.push(updater);
            }
        }
    }
    if (res.length > 0){
        let score = res.reduce((acc, val) => { return acc+val.score }, 0);
        res.push({
            msg: `${res.length} warning ${res.length === 1 ? '' : 's'}, final score ${score}`
        });
    }else{
        res.push({msg: `No warnings for WR# ${wr}`});
    }
    res[res.length-1].to = author.join(', ');
    res[res.length-1].wr = wr;
    log.trace(label + wr + ': ' + JSON.stringify(res, null, 2));
    return next(null, {rows: res});
}

module.exports = new Lintworm();


function sum_quotes(rows){
    let quoted_hours = 0,
        approved_hours = 0;
    rows.forEach((r) => {
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
    return {quoted: quoted_hours, approved: approved_hours};
}

