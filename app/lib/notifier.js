var log     = require('./log'),
    config	= require('config'),
    lwm     = require('./lintworm');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Notifier(){
}

Notifier.prototype.start = function(){
    let self = this;
    function next(err){
        let delay = 60*1000;
        if (err){
            log.error(_L('interval') + (err.stack || err));
            delay = delay*10;
        }
        setTimeout(() => { self.run(next) }, delay);
    }
    next();
}

Notifier.prototype.run = function(next){
    lwm.poll((err, data) => {
        if (err){
            return next(err);
        }
        if (data && data.rows){
            let wrs = {};
            data.rows.filter((r) => {
                let x = wrs[r.request_id];
                wrs[r.request_id] = true;
                return !!x;
            });
            log.info(_L('run') + `processing ${data.rows.length} updates`);
            process_update(data.rows.shift(), data.rows, next);
        }else{
            next();
        }
    });
}

function to_chat_handle(email){
    let nicks = config.get('chat_nicks');
    if (nicks[email]){
        return nicks[email];
    }
    return email;
}

function choose_greeting(authors){
    if (!authors || authors.length < 1){
        return 'help, can someone';
    }
    if (authors.length === 1){
        return to_chat_handle(authors[0]) + ': can you';
    }
    return authors.map(to_chat_handle).join(', ') + ': can someone';
}

function process_update(x, xs, next){
    if (!x){
        return next();
    }
    log.info(_L('process_update') + 'WR# ' + x.request_id);
    lwm.lint(x.request_id, (err, data) => {
        if (err){
            return next(err);
        }
        log.info(JSON.stringify(data.rows, null, 2));
        let warnings = data.rows.filter((x) => { return x.warning });
        if (warnings.length){ // then there's something unusual
            let v = data.rows[data.rows.length-1],
                s = `${choose_greeting(v.to)} please take a look at WR# ${v.wr}?\n(${x.brief}, ${x.status})`;
            warnings.forEach((r) => {
                s = s + '\n - ' + r.warning;
            });
            s = s + '\n' + v.msg + '\n';
            log.warn('\n' + s);
        }
        process.nextTick(() => { process_update(xs.shift(), xs, next); });
    });
}

module.exports = new Notifier();

