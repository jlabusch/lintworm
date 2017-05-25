var log     = require('./log'),
    config	= require('config'),
    https   = require('https');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

var sent_messages = {};

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

exports.send = function(msg){
    const label = _L('send');
    if (sent_messages[msg]){
        log.info(label + `Skipping repeat of ${msg} [last sent ${sent_messages[msg]}]`);
        return false;
    }
    sent_messages[msg] = new Date();
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
    return true;
}


