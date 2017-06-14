var log     = require('../../log'),
    config  = require('config'),
    db      = require('../../db'),
    sql     = require('./sql'),
    hooks   = require('../../hook'),
    rules   = require('./rules'),
    rocket  = require('../../rocket'),
    format  = rocket.format,
    poller  = require('../../wrms_polling'),
    persona = config.get('lint.persona'),
    muted   = config.get('lint.mute'),
    webhook = config.get('rocketchat.webhooks.' + persona);

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Linting(refs){
    this.rocket = refs.rocket || rocket;
    this.msg_queue = [];

    if (refs.__test_overrides){
        if (refs.__test_overrides.poller){
            poller = refs.__test_overrides.poller;
        }
        if (refs.__test_overrides.rules){
            rules = refs.__test_overrides.rules;
        }
        if (refs.__test_overrides.config){
            config = refs.__test_overrides.config;
        }
    }

    hooks.enable(this, _L('hooks'));
}

Linting.prototype.start = function(){
    const label = _L('interval');

    poller.add_hook('linting', (rows) => {
        this.gather_messages(rows, (err) => {
            if (err){
                log.error(label + err.stack);
            }else{
                log.info(label + `processed ${rows.length} rows`);
            }
        });
    });

    setInterval(
        () => { this.flush_messages(err => { if (err){ log.error(label + err.stack); } }) },
        config.get('lint.flush_interval_minutes')*60*1000
    );
}

Linting.prototype.gather_messages = function(rows, next){
    log.debug(_L('gather_messages') + `processing ${rows.length} rows...`);
    this.process_update(rows.shift(), rows, poller.previous_update(), next);
}

Linting.prototype.run = Linting.prototype.gather_messages;

Linting.prototype.flush_messages = function(next){
    const label = _L('flush_messages');

    log.trace(label + `sending ${this.msg_queue.length} messages...`);

    if (this.msg_queue.length < 1){
        next && next(null, null);
        return;
    }

    let key = []; // gathered as a side-effect of $lines

    const lines = this.msg_queue.map(
            (r) => {
                key.push(r.req.wr);
                const a = r.req.to && r.req.to.length
                            ? ` - see ${r.req.to.map(to_chat_handle).join(', ')}`
                            : '';

                return  `${format.wr(r.req.wr)} for ${format.org(r.req.org)} ${format.status(r.req.status)} ` +
                        `${format.brief(r.req.brief)} _(${r.warnings.join(', ')}${a})_\n`;
            }
        ),
        msg = 'We need to check ' + (lines.length > 1 ? '\n> ' : '') + lines.join('> ');

    log.warn(label + msg);

    this.msg_queue = [];

    this.rocket.send(msg).about(key.join(',')).to(muted ? null : webhook).then(next);
}

function to_chat_handle(email){
    let nicks = config.get('rocketchat.nicks');
    if (nicks[email]){
        return nicks[email];
    }
    return email;
}

Linting.prototype.process_update = function(x, xs, fresh_after, next){
    if (!x){
        next && next();
        return;
    }
    const label = _L('process_update');
    log.info(label + 'WR# ' + x.request_id);
    this.lint(x.request_id, fresh_after, (err, data) => {
        if (err){
            next && next(err);
            return;
        }
        log.debug(label + JSON.stringify(data.rows, null, 2));
        let warnings = data.rows
                            .filter((r) => { return r.warning })
                            .map((r) => { return r.warning }),
            last_row = data.rows[data.rows.length - 1];
        if (warnings.length && !last_row.org.match(/Humanitarian/)){ // then there's something unusual
            this.msg_queue.push({req: last_row, warnings: warnings});
        }
        process.nextTick(() => { this.process_update(xs.shift(), xs, fresh_after, next); });
    });
}

Linting.prototype.lint = async function(wr, fresh_after, next){
    const label = _L('lint');

    log.debug(label + wr);

    let err = undefined,
        efn = function(e){ err = e },
        dbi = db.get();

    let req_data = await dbi.query('lint.request', sql.lint_req, [wr]).catch(efn);

    if (err || !req_data || !req_data.rows || req_data.rows.length < 1){
        err = err || new Error('No such WR (' + wr + ')');
        return next(err);
    }

    let context = {
        wr:      wr,
        req:     req_data.rows[0],
        alloc:   await dbi.query('lint.alloc',   sql.lint_alloc,   [wr]).catch(efn),
        quote:   await dbi.query('lint.quotes',  sql.lint_quote,   [wr]).catch(efn),
        tags:    await dbi.query('lint.tags',    sql.lint_tag,     [wr]).catch(efn),
        activity:await dbi.query('lint.activity',sql.lint_activity,[wr, fresh_after]).catch(efn),
        parents: await dbi.query('lint.parents', sql.lint_parent,  [wr]).catch(efn)
    };

    if (err){
        return next(err);
    }

    this.call_hooks(context);

    rules.apply(context, next);
}

module.exports = Linting;

