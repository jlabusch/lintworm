var //config  = require('config'),
    restify = require('restify'),
    log     = require('./log'),
    pkg     = require('../package.json'),
    notifier= require('./notifier').notifier;

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

setup('get', '/check_timesheets', (req, res, next) => {
    notifier.timesheets.__test_hook = function(err, data){
        notifier.timesheets.__test_hook = undefined;
        if (data){
            // also sent to rocketchat as a side effect
            res.json(data);
        }else{
            log.error(_L('check_timesheets') + err);
            res.json({error: true});
        }
        next(false);
    }
    notifier.run('timesheets');
});

