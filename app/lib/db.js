var config  = require('config'),
    log     = require('./log'),
    pg      = require('pg');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function DB(){
    var self = this;

    this.client = null;
    this.config = config.get('db');

    this.config.host = this.config.host || 'catwgtn-prod-pg92.db.catalyst.net.nz';

    pg.on('error', function(err){
        log.error(_L('pg#error') + err);
        reconnect(self);
    });

    process.nextTick(function(){ reconnect(self) });
}

function reconnect(o, done){
    var label = _L('reconnect');
    if (o.client){
        try{
            o.client.end();
        }catch(ex){ /* don't care */ }
    }
    o.client = new pg.Client(o.config);
    o.client.connect(function(err){
        if (err){
            log.error(label + "Couldn't connect to database: " + err);
            setTimeout(function(){ reconnect(o) }, 5*1000);
        }else{
            log.info(label + "Connected to database");
        }
        done && done(err);
    });
}

DB.prototype.query = function(){
    if (!this.client){
        log.error(_L('DB#query') + 'query aborted, null client');
    }
    var start = new Date(),
        args = Array.prototype.slice.call(arguments, 0),
        query_name = args.shift(),
        label = _L('DB#query(' + query_name + ')'),
        handler = args[args.length-1];

    var proxy = function(err, data){
            var end = new Date();
            log.info(label + 'rtt ' + (end.getTime() - start.getTime()) + 'ms');
            if (!err){
                log.debug('store ' + cache_key + ' -> ' + JSON.stringify(data).length + ' bytes');
                cache[cache_key] = {data: data, time: new Date()};
            }
            return handler(err, JSON.parse(JSON.stringify(data)));
        };
    args[args.length-1] = proxy;
    this.client.query.apply(this.client, args);
}

module.exports = {
    type: DB,
    create: function(cfg){ return new DB(cfg) }
}

