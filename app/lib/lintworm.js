var log = require('./log'),
    config = require('config');

'use strict'

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function tidy(s){
    return s[0].replace(/\s+/g, ' ');
}

function Lintworm(){
    this.db = undefined;

    const days = 24*60*60*1000,
        today = new Date().getTime();
    this.latest_update = new Date(today - config.get('lint.rewind_on_startup')*days).toISOString();
}

Lintworm.prototype.init = function(db){
    this.db = db;
}

// FIXME: shouldn't use both > and < date comparisons (use >=)
const poll_sql =
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
                        0
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
            JOIN usr ru on ru.user_no=r.requester_id
            JOIN organisation o on o.org_code=ru.org_code
            WHERE ra.date > $1 AND ra.date < $2
                AND o.org_code in (
                    SELECT o.org_code
                        FROM organisation o
                        JOIN org_system os ON os.org_code=o.org_code
                        JOIN work_system s ON s.system_id=os.system_id
                        JOIN system_usr su ON su.system_id=os.system_id
                        JOIN usr u ON u.user_no=su.user_no
                        WHERE o.org_code NOT IN (37,1098,1185,1137) AND
                            s.system_id NOT IN (18,164) AND
                            u.user_no > 4000 AND
                            u.email LIKE '%catalyst-eu.net'
                )
            ORDER BY ra.date ASC`;

// Returns the list of WRs with updates since this.latest_update
// (defaulting to a few days ago).
// Edge triggered rather than level triggered.
// Limits the future to now+7 days so as to ignore egregious timesheet typos.
Lintworm.prototype.poll = function(next){
    const days = 24*60*60*1000,
        today = new Date().getTime(),
        label = _L('poll');
    let from = this.latest_update,
        to   = new Date(today + 7*days).toISOString();
    log.debug(label + `from ${from} to ${to}`);

    this.db.query("poll", poll_sql, [from, to])
        .then(
            (data) => {
                if (data && data.rows && data.rows.length > 0){
                    this.latest_update = data.rows[data.rows.length-1].updated_on;
                    let wrs = {};
                    data.rows = data.rows.filter((x) => {
                        let found = wrs[x.request_id];
                        wrs[x.request_id] = true;
                        return !found;
                    });
                }
                next(null, data);
            },
            (err) => {
                next(err);
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
                        0
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
                0 END END) as quoted_hours
            FROM request_quote q
            WHERE q.request_id=relations.request_id),
            (SELECT SUM(
                CASE WHEN q.quote_units='days' THEN q.quote_amount*8 ELSE
                CASE WHEN q.quote_units='hours' THEN q.quote_amount ELSE
                0 END END) as approved_hours
            FROM request_quote q
            WHERE q.request_id=relations.request_id AND q.approved_by_id IS NOT NULL)
        FROM relations
    `;

Lintworm.prototype.lint = async function(wr, next) {
    const label = _L('lint');
    log.debug(label + wr);

    let err = undefined,
        req_data = await this.db.query('lint.request', lint_req_sql, [wr]).catch((e) => { err = e });

    if (err || !req_data || !req_data.rows || req_data.rows.length < 1){
        err = err || new Error('Invalid empty request data for WR# ' + wr);
        return next(err);
    }

    let alloc_data      = await this.db.query('lint.alloc',     lint_alloc_sql,     [wr]).catch((e) => { err = e }),
        quote_data      = await this.db.query('lint.quotes',    lint_quote_sql,     [wr]).catch((e) => { err = e }),
        tag_data        = await this.db.query('lint.tags',      lint_tag_sql,       [wr]).catch((e) => { err = e }),
        activity_data   = await this.db.query('lint.activity',  lint_activity_sql,  [wr]).catch((e) => { err = e }),
        parent_data     = await this.db.query('lint.relations', lint_parent_sql,    [wr]).catch((e) => { err = e });

    if (err){
        return next(err);
    }

    this.__apply_lint_rules(
        wr,
        req_data.rows[0],
        alloc_data,
        quote_data,
        tag_data,
        activity_data,
        parent_data,
        next
    );
}

function contains_row_data(x){
    return x && x.rows && x.rows.length > 0;
}

function format_author(row){
    return row.email;
}

Lintworm.prototype.__format_author = format_author;

Lintworm.prototype.__apply_lint_rules = function(wr, req, alloc, quote, tags, activity, parents, next){
    let res = [],
        author = [],
        context = {
            wr: wr,
            req: req,
            alloc: alloc,
            quote: quote,
            tags: tags,
            activity: activity,
            parents: parents
        };

    let rules = require('./lint_rules');

    if (rules.unallocated(context)){
        res.push({warning: "nobody allocated", score: -10});
    }else if (rules.multiple_allocations(context)){
        res.push({warning: "over-allocated", score: -5});
    }

    if (contains_row_data(alloc)){
        alloc.rows.forEach((x) => {
            if (x.email &&
                x.fullname &&
                x.email.match(/catalyst/) &&
                x.fullname !== 'Catalyst Sysadmin Europe')
            {
                author.push(format_author(x));
            }
        });
    }

    if (rules.under_warranty(context)){
        res.push({
            info: `Found warranty tag`,
            score: 20
        });
    }else if (rules.exceeds_requested_budget(context)){
        res.push({
            warning: `over budget by ${req.total_hours - context.sum_quotes.total.quoted}h`,
            score: -20
        });
    }else if (rules.exceeds_approved_budget(context)){
        res.push({
            warning: `needs another ${req.total_hours - context.sum_quotes.total.approved}h approved`,
            score: -10
        });
    }else if (rules.requires_parent_budget(context)){
        res.push({
            info: "relies on parent WR quotes, please check the math",
            score: -5
        });
    }

    if (rules.too_many_notes_with_no_timesheets(context)){
        res.push({
            warning: `There are ${context.our_notes.length} notes from us with no timesheets`,
            score: -5
        });
    }

    if (context.last_comment && context.last_comment.client){
        if (!context.last_comment.catalyst){
            res.push({
                warning: 'client notes, but no response from us',
                score: -5
            });
        }else if (rules.being_chased_for_response(context)){
            res.push({
                warning: 'client just bumped a forgotten ticket',
                score: -5
            });
        }
    }

    // Add our last updater to authors if they're not there already
    if (context.our_notes && context.our_notes.length){
        let last_updater = format_author(context.our_notes[context.our_notes.length - 1]);
        if (author.findIndex((x) => { return x === last_updater }) < 0){
            author.push(last_updater);
        }
    }

    let num_warnings = res.reduce((acc, val) => { return acc + (val.warning ? 1 : 0) }, 0);
    if (num_warnings > 0){
        let score = res.reduce((acc, val) => { return acc+val.score }, 0);
        res.push({
            msg: `${num_warnings} warning${num_warnings === 1 ? '' : 's'}, final score ${score}`
        });
    }else{
        res.push({msg: `No warnings for WR# ${wr}`});
    }
    res[res.length-1].to = author;
    res[res.length-1].wr = wr;
    res[res.length-1].org = req.org;
    res[res.length-1].brief = req.brief;

    // const label = _L('__apply_lint_rules');
    // log.trace(label + wr + ': ' + JSON.stringify(res, null, 2));
    return next(null, {rows: res});
}

module.exports = new Lintworm();


