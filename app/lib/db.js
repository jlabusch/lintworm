var config  = require('config'),
    log     = require('./log'),
    pg      = require('pg');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function DB(driver){
    let self = this;

    this.driver = driver || pg;
    this.client = null;
    this.config = config.get('db');

    this.config.host = this.config.host || 'catwgtn-prod-pg92.db.catalyst.net.nz';

    this.driver.on('error', function(err){
        log.error(_L('driver.error') + (err.stack || err));
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
    o.client = new o.driver.Client(o.config);
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

DB.prototype.query = function(){
    if (!this.client){
        throw new Error(_L('DB.query') + 'query aborted, null client');
    }
    let start = new Date(),
        args = Array.prototype.slice.call(arguments, 0),
        query_name = args.shift(),
        label = _L('DB.query(' + query_name + ')');

    log.trace(label + args[0]);

    return new Promise((resolve, reject) => {
        args.push(function(err, data){
            let end = new Date();
            data = data || {rows: []};
            log.debug(label + data.rows.length + ' rows, rtt ' + (end.getTime() - start.getTime()) + 'ms');
            if (err){
                reject(err);
            }else{
                let j = JSON.stringify(data, null, 2);
                log.trace(label + j);
                resolve(JSON.parse(j));
            }
        });
        this.client.query.apply(this.client, args);
    });
}

let instance = undefined;

module.exports = {
    type: DB,
    create: function(){ instance = new DB(); return instance; },
    get: function(){ return instance; },
    __test_override: function(i){ instance = i; }
}

