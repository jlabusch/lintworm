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
}

Linting.prototype.start = function(){
    let self = this;
    function sweep_wrs(err){
        let delay = 60*1000;
        if (self.first_run){
            self.first_run = false;
            delay = 10*1000;
        }
        if (err){
            log.error(_L('interval') + (err.stack || err));
            delay = delay*10;
        }
        setTimeout(() => { self.run(sweep_wrs) }, delay);
    }
    sweep_wrs();
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
        log.info(label + JSON.stringify(data.rows, null, 2));
        let warnings = data.rows.filter((r) => { return r.warning }).map((r) => { return r.warning; });
        if (warnings.length){ // then there's something unusual
            let v = data.rows[data.rows.length-1],
                a = v.to && v.to.length ? ` - see ${v.to.map(to_chat_handle).join(', ')}` : '',
                s = `We need to check ${format.wr(v.wr)} for ${format.org(v.org)} ${format.status(x.status)} ${format.brief(x.brief)} _(${warnings.join(', ')}${a})_\n`;
            log.warn(`${s}${v.msg}\n---------------------------------\n`);

            this.rocket.send(s).about(v.wr).to(webhook);
        }
        process.nextTick(() => { this.process_update(xs.shift(), xs, next); });
    });
}

function to_chat_handle(email){
    let nicks = config.get('chat_nicks');
    if (nicks[email]){
        return nicks[email];
    }
    return email;
}

module.exports = Linting;

