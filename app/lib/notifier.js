var log     = require('./log'),
    config	= require('config');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Notifier(lintworm, rocket){
    this.first_run = true;
    this.lwm = lintworm || require('./lintworm');
    this.rocket = rocket || require('./rocket');
}

Notifier.prototype.start = function(){
    let self = this;
    function next(err){
        let delay = 60*1000;
        if (self.first_run){
            self.first_run = false;
            delay = 5*1000;
        }
        if (err){
            log.error(_L('interval') + (err.stack || err));
            delay = delay*10;
        }
        setTimeout(() => { self.run(next) }, delay);
    }
    next();
}

Notifier.prototype.run = function(next){
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

function to_chat_handle(email){
    let nicks = config.get('chat_nicks');
    if (nicks[email]){
        return nicks[email];
    }
    return email;
}

function to_org_abbrev(o){
    let acronym = o.match(/([A-Z]{3}[A-Z]*)/);
    if (acronym){
        return acronym[1];
    }
    let uni = o.match(/University/);
    if (uni){
        return o.replace(/ ?University( of )?/g, '');
    }
    return o.replace(/^The/, '').match(/(\b[A-Z])/g).join('');
}

Notifier.prototype.process_update = function(x, xs, next){
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
                a = v.to && v.to.length ? `[see ${v.to.map(to_chat_handle).join(', ')}]\n` : '',
                s = `Can someone please check WR# ${v.wr} for ${to_org_abbrev(v.org)} [${x.status}] ${x.brief}? (${warnings.join(', ')})\n${a}`;
            log.warn(`\n---------------------------------\n${s}${v.msg}\n`);

            this.rocket.send(s);
        }
        process.nextTick(() => { this.process_update(xs.shift(), xs, next); });
    });
}

module.exports = {
    notifier: new Notifier(),
    type: Notifier
}


