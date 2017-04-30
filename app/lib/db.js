var config  = require('config'),
    log     = require('./log'),
    pg      = require('pg');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function DB(){
    let self = this;

    this.client = null;
    this.config = config.get('db');

    this.config.host = this.config.host || 'catwgtn-prod-pg92.db.catalyst.net.nz';

    pg.on('error', function(err){
        log.error(_L('pg.error') + (err.stack || err));
        reconnect(self);
    });

    process.nextTick(function(){ reconnect(self) });
}

function reconnect(o, done){
    let label = _L('reconnect');
    if (o.client){
        try{
            o.client.end();
        }catch(ex){ /* don't care */ }
    }
    o.client = new pg.Client(o.config);
    o.client.connect(function(err){
        if (err){
            log.error(label + "Couldn't connect to database: " + (err.stack || err));
            setTimeout(function(){ reconnect(o) }, 5*1000);
        }else{
            log.info(label + "Connected to database");
        }
        done && done(err);
    });
}

// Usage: db.query('query_name', sql, [args,] handler_fn);
DB.prototype.query = function(){
    if (!this.client){
        throw new Error(_L('DB.query') + 'query aborted, null client');
    }
    let start = new Date(),
        args = Array.prototype.slice.call(arguments, 0),
        query_name = args.shift(),
        label = _L('DB.query(' + query_name + ')'),
        handler = args[args.length-1];

    if (typeof(handler) !== 'function'){
        throw new Error(label + 'no handler for query "' + query_name + '"');
    }

    log.debug(label + args[0]);

    let proxy = function(err, data){
        let end = new Date();
        data = data || {rows: []};
        log.info(label + data.rows.length + ' rows, rtt ' + (end.getTime() - start.getTime()) + 'ms');
        let result = JSON.stringify(data, null, 2);
        log.trace(result);
        return handler(err, JSON.parse(result));
    };
    args[args.length-1] = proxy;
    this.client.query.apply(this.client, args);
}

module.exports = {
    type: DB,
    create: function(){ return new DB() }
}

