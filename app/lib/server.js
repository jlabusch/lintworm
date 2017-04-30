var //config  = require('config'),
    restify = require('restify'),
    log     = require('./log'),
    pkg     = require('../package.json'),
    lwm     = require('./lintworm');

const GENERIC_ERROR = {error: 'Service interruption - please try again later'};

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

var server = restify.createServer({
    name: 'lintworm',
    versions: [pkg.version]
});

module.exports = server;

server.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    let m = req.headers['access-control-request-method'];
    if (m)  res.setHeader('Access-Control-Allow-Methods', m);
    let h = req.headers['access-control-request-headers'];
    if (h)  res.setHeader('Access-Control-Allow-Headers', h);
    return next();
});

server.use(restify.bodyParser({mapParams: true}));
server.use(restify.queryParser({mapParams: true}));
server.on('after', restify.auditLogger({log: log}));
server.on('uncaughtException', (req, res, route, err) => {
    log.error('restify.uncaughtException - ' + err.stack);
    res.send(500, GENERIC_ERROR);
});

function setup(method, uri, handler){
    // Preflight
    server.opts(uri, (req, res, next) =>{
        res.send(200);
        return next();
    });
    // Actual call
    server[method](uri, handler);
}

setup('get', '/ping', (req, res, next) => {
    res.end('pong\n');
    return next();
});

function query_response(label, res, filter, next){
    return function(err, data){
        if (err){
            log.error(label + (err.stack || err));
            res.send(500, GENERIC_ERROR);
        }else{
            filter = filter || function(x){ return x };
            res.json(filter(data.rows));
        }
        next(false);
    }
}

setup('get', '/poll', (req, res, next) => {
    lwm.poll(
        query_response(
            _L('poll'),
            res,
            null,
            next
        )
    );
});

setup('get', '/lint/:wr', (req, res, next) => {
    const wr = parseInt(req.params.wr),
        label = _L('lint');
    if (isNaN(wr)){
        log.warn(label + "Invalid WR number");
        res.send(400, {error: "Invalid WR number"});
        next(false);
        return;
    }
    lwm.lint(
        wr,
        query_response(
            label,
            res,
            null,
            next
        )
    );
});

