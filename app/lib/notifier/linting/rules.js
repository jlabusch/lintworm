var log = require('../../log'),
    config = require('config'),
    our_email_domain = require('../../our_email_domain'),
    max_allocations = config.get('lint.max_allocations'),
    quote_leeway = config.get('lint.hours_before_quote_required'),
    budget_grace = config.get('lint.acceptable_hours_budget_overrun');

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

'use strict'

function contains_row_data(x){
    return x && x.rows && x.rows.length > 0;
}

function unallocated(context){
    return contains_row_data(context.alloc) === false &&
        ['Finished', 'Cancelled'].indexOf(context.req.status) < 0;
}

exports.unallocated = unallocated;

function is_not_sysadmin(x){
    return !x.fullname || x.fullname !== 'Catalyst Sysadmin Europe';
}

function multiple_allocations(context){
    return contains_row_data(context.alloc) &&
        context.alloc.rows.filter(is_not_sysadmin).length > max_allocations;
}

exports.multiple_allocations = multiple_allocations;

function sum_quotes(direct, indirect){
    let result = {
        wr: {
            quoted: 0,
            approved: 0
        },
        ancestor: {
            quoted: 0,
            approved: 0
        },
        total: {
            quoted: 0,
            approved: 0
        }
    };
    if (contains_row_data(direct)){
        direct.rows.forEach((r) => {
            log.trace(_L('sum_quotes') + JSON.stringify(r));
            // lint_quote_sql query
            switch(r.quote_units)
            {
            case 'hours':
                result.wr.quoted += r.quote_amount;
                if (r.approved_by_id && !r.quote_cancelled_by) result.wr.approved += r.quote_amount;
                break;
            case 'days':
                result.wr.quoted += r.quote_amount*8;
                if (r.approved_by_id && !r.quote_cancelled_by) result.wr.approved += r.quote_amount*8;
                break;
            }
        });
    }
    if (contains_row_data(indirect)){
        indirect.rows.forEach((r) => {
            // lint_parent_sql query
            result.ancestor.quoted += r.quoted_hours;
            result.ancestor.approved += r.approved_hours;
        });
    }
    result.total.quoted = result.wr.quoted + result.ancestor.quoted;
    result.total.approved = result.wr.approved + result.ancestor.approved;
    log.trace(_L('sum_quotes') + JSON.stringify(result, null, 2));
    return result;
}

function is_warranty_tag(x){
    return x.tag_description.match(/^warranty$/i);
}

function under_warranty(context){
    if (context.under_warranty !== undefined){
        return context.under_warranty;
    }
    context.under_warranty =
        contains_row_data(context.tags) &&
        context.tags.rows.filter(is_warranty_tag).length > 0;
    return context.under_warranty;
}
exports.under_warranty = under_warranty;

function exceeds_approved_budget(context){
    if (contains_row_data(context.quote) && !context.sum_quotes){
        context.sum_quotes = sum_quotes(context.quote.rows);
    }

    if (under_warranty(context)){
        return false;
    }

    let approved = context.sum_quotes ? context.sum_quotes.total.approved : 0,
        diff = approved - context.req.total_hours,
        grace = approved ? budget_grace : quote_leeway;
    log.trace(_L('exceeds_approved_budget') + `${approved} - ${context.req.total_hours} = ${diff} (grace ${grace})`);
    return diff + grace < 0;
}

exports.exceeds_approved_budget = exceeds_approved_budget;

function exceeds_requested_budget(context){
    if (!context.sum_quotes){
        context.sum_quotes = sum_quotes(context.quote, context.parents);
    }
    let a = (context.sum_quotes ? context.sum_quotes.total.quoted : 0) || quote_leeway,
        b = context.req.total_hours;
    log.trace(_L('exceeds_requested_budget') + `${a} - ${b} = ${a-b}`);
    return !under_warranty(context) && a - b < 0;
}

exports.exceeds_requested_budget = exceeds_requested_budget;

function requires_parent_budget(context){
    if (!context.sum_quotes){
        context.sum_quotes = sum_quotes(context.quote, context.parents);
    }
    return !under_warranty(context) &&
        context.sum_quotes ?
            context.sum_quotes.wr.approved < context.req.total_hours &&
            context.sum_quotes.total.approved >= context.req.total_hours :
            false;
}
exports.requires_parent_budget = requires_parent_budget;

function read_notes(context){
    if (context.last_comment){
        return;
    }

    context.last_comment = {
        catalyst: undefined,
        client: undefined
    };

    context.our_notes = context.activity.rows.filter((r) => {
        if (r.source === 'note' && r.email){
            if (our_email_domain(r.email)){
                context.last_comment.catalyst = r.updated_on;
                return true;
            }else{
                context.last_comment.client = r.updated_on;
            }
        }
        return false;
    });
}

function too_many_notes_with_no_timesheets(context){
    if (!contains_row_data(context.activity)){
        return false;
    }

    read_notes(context);

    return context.our_notes.length > 1 && context.req.total_hours === 0;
}

exports.too_many_notes_with_no_timesheets = too_many_notes_with_no_timesheets;

function being_chased_for_response(context){
    if (!contains_row_data(context.activity)){
        return false;
    }

    read_notes(context);

    let theirs = new Date(context.last_comment.client).getTime(),
        ours = new Date(context.last_comment.catalyst).getTime(),
        grace = 7*24*60*60*1000;
    return ours + grace < theirs;
}

exports.being_chased_for_response = being_chased_for_response;

function format_author(row){
    return row.email;
}

exports.apply = function(context, next){
    let res = [],
        author = [];

    // if (unallocated(context)){
    //     res.push({warning: "nobody allocated", score: -10});
    // }else
    if (multiple_allocations(context)){
        res.push({warning: "over-allocated", score: -5});
    }

    if (contains_row_data(context.alloc)){
        context.alloc.rows.forEach((x) => {
            if (x.email &&
                x.fullname &&
                our_email_domain(x.email) &&
                x.fullname !== 'Catalyst Sysadmin Europe')
            {
                author.push(format_author(x));
            }
        });
    }

    if (under_warranty(context)){
        res.push({
            info: `Found warranty tag`,
            score: 20
        });
    }else if (exceeds_requested_budget(context)){
        res.push({
            warning: `over budget by ${context.req.total_hours - context.sum_quotes.total.quoted}h`,
            score: -20
        });
    }else if (exceeds_approved_budget(context)){
        res.push({
            warning: `needs another ${context.req.total_hours - context.sum_quotes.total.approved}h approved`,
            score: -10
        });
    }else if (requires_parent_budget(context)){
        res.push({
            info: "relies on parent WR quotes, please check the math",
            score: -5
        });
    }

    if (too_many_notes_with_no_timesheets(context)){
        res.push({
            warning: `${context.our_notes.length} notes from us with no timesheets`,
            score: -5
        });
    }

    if (context.last_comment && context.last_comment.client){
        if (!context.last_comment.catalyst){
            res.push({
                warning: 'client notes with no response from us',
                score: -5
            });
        }else if (being_chased_for_response(context)){
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
        res.push({msg: `No warnings for WR# ${context.wr}`});
    }
    res[res.length-1].to = author;
    res[res.length-1].wr = context.wr;
    res[res.length-1].org = context.req.org;
    res[res.length-1].brief = context.req.brief;
    res[res.length-1].status = context.req.status;

    // const label = _L('__apply_lint_rules');
    // log.trace(label + wr + ': ' + JSON.stringify(res, null, 2));
    return next(null, {rows: res});
}

function to_chat_handle(email){
    let nicks = config.get('chat_nicks');
    if (nicks[email]){
        return nicks[email];
    }
    return email;
}

