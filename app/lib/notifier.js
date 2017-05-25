var log     = require('./log'),
    config	= require('config'),
    https   = require('https'),
    lwm     = require('./lintworm');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Notifier(){
    this.first_run = true;
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
    lwm.poll((err, data) => {
        if (err){
            return next(err);
        }
        if (data && data.rows){
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

const uri = config.get('rocketchat.hook'),
    uri_parts = uri ? uri.match(/https:\/\/(.*?)\/(.*)/) : [],
    options = {
        hostname: uri_parts[1],
        port: 443,
        path: '/' + uri_parts[2],
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

function send_to_webhook(msg){
    const label = _L('send_to_webhook');
    if (uri){
        const req = https.request(options, (res) => {
            if (res.statusCode !== 200){
                log.error(label + res.statusCode);
            }else{
                log.info(label + res.statusCode);
            }
        });
        req.on('error', (e) => {
            log.error(label + e);
        });
        req.write(JSON.stringify({text: msg}));
        req.end();
    }
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

function process_update(x, xs, next){
    if (!x){
        return next();
    }
    const label = _L('process_update');
    log.info(label + 'WR# ' + x.request_id);
    lwm.lint(x.request_id, (err, data) => {
        if (err){
            return next(err);
        }
        log.info(label + JSON.stringify(data.rows, null, 2));
        let warnings = data.rows.filter((x) => { return x.warning }).map((x) => { return x.warning; });
        if (warnings.length){ // then there's something unusual
            let v = data.rows[data.rows.length-1],
                a = v.to && v.to.length ? `[see ${v.to.map(to_chat_handle).join(', ')}]\n` : '',
                s = `Can someone please check WR# ${v.wr} for ${to_org_abbrev(v.org)} [${x.status}] ${x.brief}? (${warnings.join(', ')})\n${a}`;
            log.warn(`\n---------------------------------\n${s}${v.msg}\n`);

            send_to_webhook(s);
        }
        process.nextTick(() => { process_update(xs.shift(), xs, next); });
    });
}

module.exports = new Notifier();

