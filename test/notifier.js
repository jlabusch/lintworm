var assert  = require('assert'),
    sa      = require('superagent'),
    Notifier= require('../lib/notifier/linting').type,
    should  = require('should');

function Lintworm(state){
    this.state = state;
}

Lintworm.prototype.poll = function(next){
    process.nextTick(() => {
        next && next(this.state.poll.err, this.state.poll.data);
    });
}

Lintworm.prototype.lint = function(wr, next){
    next(this.state.lint.err, this.state.lint.data);
}

function Rocket(next){
    this.next = next;
}

Rocket.prototype.send = function(msg){
    let key = msg,
        uri = null,
        next = function(){};
    process.nextTick(() => { this.next && this.next(msg) });
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


describe(require('path').basename(__filename), function(){
    describe('run', function(){
        it('should poll', function(done){
            let lintworm = new Lintworm({
                poll: {
                    err: null,
                    data: { rows: [] }
                }
            });
            let tried_to_send = null;
            let rocket = new Rocket(msg => { tried_to_send = msg; });
            let notifier = new Notifier(lintworm, rocket);
            notifier.run(function(err){
                should.not.exist(err);
                (tried_to_send === null).should.equal(true);
                done();
            });
        });
        it('should process', function(done){
            let lintworm = new Lintworm({
                poll: {
                    err: null,
                    data: {
                        rows: [
                            {request_id: 123, brief: 'test', status: 'Finished'}
                        ]
                    }
                },
                lint: {
                    err: null,
                    data: {
                        rows: [
                            {warning: 'hello world'},
                            {to: ['Bob'], wr: 123, org: 'Org', msg: '1 Warning'}
                        ]
                    }
                }
            });
            let rocket = new Rocket(msg => {
                should.exist(msg);
                should.exist(msg.match(/123/));
                should.exist(msg.match(/Bob/));
                should.exist(msg.match(/hello world/));
                done();
            });
            let notifier = new Notifier(lintworm, rocket);
            notifier.run(function(){});
        });
    });
});
