var log     = require('./log'),
    config	= require('config'),
    https   = require('https');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

var sent_messages = {};

// Usage:
//  - rocket.send(msg).about(key).to(uri).then(fn)
//  - rocket.send(msg).about(key).to(uri)   // fn is noop
//  - rocket.send(msg).about(key)           // uri=cfg_uri
//  - rocket.send(msg)                      // key=msg
exports.send = function(msg){
    let key = msg,
        uri = config.get('rocketchat.hook'),
        next = function(){};
    process.nextTick(() => { __send(key, msg, uri, next); });
    let obj = {
        about: (id) => {
            key = id;
            return obj;
        },
        to: (dest) => {
            uri = dest;
            return obj;
        },
        then: (fn) => {
            next = fn;
            return obj;
        }
    };
    return obj;
}

function __send(key, msg, uri, next){
    const label = _L('send');
    if (sent_messages[key]){
        log.info(label + `Skipping repeat of ${key} [last sent ${sent_messages[key]}]`);
        next(null, false);
        return;
    }
    sent_messages[key] = new Date();
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
                    next(new Error(e));
                }else{
                    log.trace(label + `[${key}] ${msg} => ${res.statusCode}`);
                    next(null, true);
                }
            });
        req.on('error', (e) => {
            log.error(label + e);
            next(e);
        });
        req.write(JSON.stringify({text: msg}));
        req.end();
    }else{
        log.trace(label + `[${key}] ${msg} => not sent, rocketchat.hook not set`);
        next(null, true);
    }
}


