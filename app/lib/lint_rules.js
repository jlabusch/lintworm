var log = require('./log'),
    config = require('config'),
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

exports.unallocated = function(context){
    return contains_row_data(context.alloc) === false &&
        ['Finished', 'Cancelled'].indexOf(context.req.status) < 0;
}

function is_not_sysadmin(x){
    return !x.fullname || x.fullname !== 'Catalyst Sysadmin Europe';
}

exports.multiple_allocations = function(context){
    return contains_row_data(context.alloc) &&
        context.alloc.rows.filter(is_not_sysadmin).length > max_allocations;
}

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
                if (r.approved_by_id) result.wr.approved += r.quote_amount;
                break;
            case 'days':
                result.wr.quoted += r.quote_amount*8;
                if (r.approved_by_id) result.wr.approved += r.quote_amount*8;
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

exports.exceeds_approved_budget = function(context){
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

exports.exceeds_requested_budget = function(context){
    if (!context.sum_quotes){
        context.sum_quotes = sum_quotes(context.quote, context.parents);
    }
    let a = (context.sum_quotes ? context.sum_quotes.total.quoted : 0) || quote_leeway,
        b = context.req.total_hours;
    log.trace(_L('exceeds_requested_budget') + `${a} - ${b} = ${a-b}`);
    return !under_warranty(context) && a - b < 0;
}

exports.requires_parent_budget = function(context){
    if (!context.sum_quotes){
        context.sum_quotes = sum_quotes(context.quote, context.parents);
    }
    return !under_warranty(context) &&
        context.sum_quotes ?
            context.sum_quotes.wr.approved < context.req.total_hours &&
            context.sum_quotes.total.approved >= context.req.total_hours :
            false;
}

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
            if (r.email.match(/catalyst/)){
                context.last_comment.catalyst = r.updated_on;
                return true;
            }else{
                context.last_comment.client = r.updated_on;
            }
        }
        return false;
    });
}

exports.too_many_notes_with_no_timesheets = function(context){
    if (!contains_row_data(context.activity)){
        return false;
    }

    read_notes(context);

    return context.our_notes.length > 1 && context.req.total_hours === 0;
}

exports.being_chased_for_response = function(context){
    if (!contains_row_data(context.activity)){
        return false;
    }

    read_notes(context);

    let theirs = new Date(context.last_comment.client).getTime(),
        ours = new Date(context.last_comment.catalyst).getTime(),
        grace = 7*24*60*60*1000;
    return ours + grace < theirs;
}


