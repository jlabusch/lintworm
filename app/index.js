var config  = require('config'),
    log     = require('./lib/log'),
    server  = require('./lib/server'),
    notifier= require('./lib/notifier'),
    lwm     = require('./lib/lintworm');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function run(db, port){
    lwm.init(db);
    notifier.start();
    server.listen(port, (err) => {
        if (err){
            throw err;
        }
    });
}

exports.run = run;

if (require.main === module){
    let port = config.get('server.port');
    log.info(_L('main') + 'listening on port ' + port);
    run(
        require('./lib/db.js').create(),
        port
    );
}

