var log     = require('./log'),
    config	= require('config'),
    wr_uri  = config.get('server.wrms_uri'),
    https   = require('https');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

var sent_messages = {};

const hourly = 60*60*1000;

function trim_sent_messages(){
    const too_old = (new Date()).getTime() - config.get('rocketchat.dedup_window_hours')*hourly;

    let n = 0;

    Object.keys(sent_messages)
        .filter(key => { return sent_messages[key].getTime() < too_old })
        .forEach(key => { ++n; delete sent_messages[key] });

    log.debug(_L('trim_sent_messages') + `removed ${n} old messages`);

    return n;
}

exports.trim_sent_messages = trim_sent_messages;

setInterval(trim_sent_messages, hourly);

function to_org_abbrev(o){
    let acronym = o.match(/([A-Z]{3}[A-Z]*)/);
    if (acronym){
        return acronym[1];
    }
    o = o.replace(/ ?University( of )?/g, '');
    if (o.match(/\s/)){
        o = o.replace(/^The/, '').match(/(\b[A-Z]+)/g).join('');
    }
    return o;
}

exports.__test_override_https = function(x){ https = x; }
exports.__test_override_config = function(x){ config = x; }

exports.format = {
    wr: (n) => { return `\`WR #${n}\` ${wr_uri}/${n}` },
    wr_num: (n) => { return `\`WR #${n}\`` },
    org: to_org_abbrev,
    status: (s) => { return `\`${s}\`` },
    brief: (b) => { return `*${b.length > 45 ? b.slice(0,42) + '...' : b}*` }
};

// Usage:
//  - rocket.send(msg).about(key).to(uri).channel('#foo').then(fn)
//  - rocket.send(msg).about(key).to(uri).then(fn)
//  - rocket.send(msg).about(key).to(uri)   // fn is noop
//  - rocket.send(msg).about(key)           // uri=cfg_uri
//  - rocket.send(msg)                      // key=msg
exports.send = function(msg){
    let key = msg,
        uri = config.get('rocketchat.webhooks.harambe'),
        channel = undefined,
        next = function(){};
    process.nextTick(() => { __send(key, msg, uri, channel, next); });
    let obj = {
        about: (id) => {
            key = id;
            return obj;
        },
        to: (dest) => {
            uri = dest;
            return obj;
        },
        channel: (chan) => {
            channel = chan;
            return obj;
        },
        then: (fn) => {
            if (typeof(fn) === 'function'){
                next = fn;
            }
            return obj;
        }
    };
    return obj;
}

function __send(key, msg, uri, channel, next){
    const label = _L('send');
    if (sent_messages[key]){
        log.info(label + `Skipping repeat of ${key} [last sent ${sent_messages[key]}]`);
        next && next(null, null);
        return;
    }
    if (config.get('rocketchat.mute')){
        uri = null;
        log.debug(label + 'muted');
    }
    sent_messages[key] = new Date();
    const obj = {
        text: msg
    }
    if (channel){
        obj.channel = channel;
    }
    if (uri){
        const uri_parts = uri ? uri.match(/https:\/\/(.*?)\/(.*)/) : [],
            options = {
                hostname: uri_parts[1],
                port: 443,
                path: '/' + uri_parts[2],
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            },
            req = https.request(options, (res) => {
                if (res.statusCode !== 200){
                    let e = label + `[${key}] ${msg} => ${res.statusCode}`;
                    log.error(e);
                    next && next(new Error(e));
                }else{
                    log.trace(label + `[${key}] ${msg} => ${res.statusCode}`);
                    next && next(null, obj);
                }
            });
        log.trace(label + `Sending ${JSON.stringify(obj)} to ${uri}`);
        req.on('error', (e) => {
            log.error(label + e);
            next && next(e);
        });
        req.write(JSON.stringify(obj));
        req.end();
    }else{
        log.debug(label + `[${key}] ${JSON.stringify(obj)} => not sent, rocketchat hook not set`);
        obj.missing_uri = true;
        next && next(null, obj);
    }
}


