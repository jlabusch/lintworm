var config  = require('config'),
    restify = require('restify'),
    log     = require('./log'),
    pkg     = require('../package.json'),
    lwm     = require('./lintworm');

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

