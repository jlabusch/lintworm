var assert  = require('assert'),
    config  = require('config'),
    DB      = require('../lib/db'),
    should  = require('should');


let driver_hooks = {
    on_end: function(){},
    on_connect: function(){},
    on_query: function(){}
};

function reset_hooks(){
    Object.keys(driver_hooks).forEach((f) => {
        driver_hooks[f] = function(){};
    });
}

function DriverClient(cfg){
    this.config = cfg;
}

DriverClient.prototype.end = function(){ driver_hooks.on_end(); }

DriverClient.prototype.connect = function(fn){
    process.nextTick(() => {
        driver_hooks.on_connect(this);
        fn && fn();
    });
}

DriverClient.prototype.query = function(){
    let args = Array.prototype.slice.call(arguments, 0);
    process.nextTick(() => {
        driver_hooks.on_query(this, args);
        let f = args.pop();
        if (typeof(f) === 'function'){
            f(fake_driver.next_err, fake_driver.next_res);
        }
    });
}

var callbacks = {};

var fake_driver = {
    on: function(key, fn){
        callbacks[key] = fn;
    },
    next_err: undefined,
    next_res: undefined,
    Client: DriverClient
};

describe(require('path').basename(__filename), function(){
    describe('connection', function(){
        it('should establish on startup', function(done){
            let d = new DB.type(fake_driver),
                count = 0;
            reset_hooks();
            driver_hooks.on_connect = function(){
                ++count;
                count.should.equal(1);
                done();
            }
        });
        it('should reconnect on error', function(done){
            let d = new DB.type(fake_driver),
                count = 0,
                ended = false;
            reset_hooks();
            driver_hooks.on_connect = function(){
                ++count;
                count.should.equal(1);
                driver_hooks.on_connect = function(){
                    ++count;
                    count.should.equal(2);
                    ended.should.equal(true);
                    done();
                }
                callbacks.error(new Error('test'));
            }
            driver_hooks.on_end = function(){
                count.should.equal(1);
                ended = true;
            }
        });
    });
    describe('query', function(){
        it('should run', function(done){
            let d = new DB.type(fake_driver),
                called_hook = false;
            reset_hooks();
            driver_hooks.on_query = function(o, sql){
                called_hook = true;
            };
            fake_driver.next_err = null;
            fake_driver.next_res = {rows: [1, 2, 3]};
            setTimeout(function(){
                d.query('label', 'select 1')
                    .then(data => {
                        should.exist(data.rows);
                        data.rows.length.should.equal(3);
                        called_hook.should.equal(true);
                        done();
                    })
                    .catch(e => {
                        should.not.exist(e);
                    });
            }, 100);
        });
    });
});
