var log     = require('../log'),
    config	= require('config'),
    format  = require('../rocket').format,
    webhook = config.get('rocketchat.lint');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Linting(refs){
    this.first_run = true;

    this.lwm = refs.lwm;
    this.rocket = refs.rocket;

    this.msg_queue = [];
}

Linting.prototype.start = function(){
    const minute = 60*1000,
        second = 1000,
        label = _L('interval');

    function print_err(e){
        if (e){
            log.error(label + (e.stack || e));
        }
    }

    let busy = false;

    let sweep_fn = () => {
        if (busy){
            log.debug(label + 'already busy, skipping this run()');
            return;
        }
        busy = true;
        this.run(err => {
            print_err(err);
            busy = false;
        });
    };

    setTimeout(sweep_fn, 5*second);

    setInterval(sweep_fn, config.get('lint.sweep_interval_minutes')*minute)

    setInterval(
        () => { this.flush_messages(print_err) },
        config.get('lint.flush_interval_minutes')*minute
    );
}

Linting.prototype.run = function(next){
    this.lwm.poll((err, data) => {
        if (err){
            next && next(err);
            return;
        }
        if (data && data.rows){
            log.info(_L('run') + `processing ${data.rows.length} updates`);
            this.process_update(data.rows.shift(), data.rows, next);
        }else{
            next && next();
        }
    });
}

Linting.prototype.process_update = function(x, xs, next){
    if (!x){
        next && next();
        return;
    }
    const label = _L('process_update');
    log.info(label + 'WR# ' + x.request_id);
    this.lwm.lint(x.request_id, (err, data) => {
        if (err){
            next && next(err);
            return;
        }
        log.debug(label + JSON.stringify(data.rows, null, 2));
        let warnings = data.rows
            .filter((r) => { return r.warning })
            .map((r) => { return r.warning });
        if (warnings.length){ // then there's something unusual
            this.msg_queue.push({req: x, warnings: warnings, summary: data.rows[data.rows.length-1]});
        }
        process.nextTick(() => { this.process_update(xs.shift(), xs, next); });
    });
}

Linting.prototype.flush_messages = function(next){
    const label = _L('flush_messages');

    log.trace(label + `sending ${this.msg_queue.length} messages...`);

    if (this.msg_queue.length < 1){
        next && next();
        return;
    }

    let key = []; // gathered as a side-effect of $lines

    const lines = this.msg_queue.map(
            (r) => {
                key.push(r.summary.wr);
                return format_single_msg(r)
            }
        ),
        msg = 'We need to check ' + (lines.length > 1 ? '\n> ' : '') + lines.join('> ');

    log.warn(label + msg);

    this.msg_queue = [];

    this.rocket.send(msg).about(key.join(',')).to(webhook).then(next);
}

function format_single_msg(x){
    const a = x.summary.to && x.summary.to.length
            ? ` - see ${x.summary.to.map(to_chat_handle).join(', ')}`
            : '';

    return `${format.wr(x.summary.wr)} for ${format.org(x.summary.org)} ${format.status(x.req.status)} ${format.brief(x.req.brief)} _(${x.warnings.join(', ')}${a})_\n`;
}

function to_chat_handle(email){
    let nicks = config.get('chat_nicks');
    if (nicks[email]){
        return nicks[email];
    }
    return email;
}

module.exports = Linting;

