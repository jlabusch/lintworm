var assert  = require('assert'),
    sa      = require('superagent'),
    rocket  = require('../lib/rocket'),
    should  = require('should');

describe(require('path').basename(__filename), function(){
    describe('send', function(){
        it('should send something new (1)', function(done){
            let r = rocket.send('hello world', null);
            r.should.equal(true);
            done();
        });
        it('should send something new (2)', function(done){
            let r = rocket.send('hello back', null);
            r.should.equal(true);
            done();
        });
        it('should skip duplicates', function(done){
            let r = rocket.send('hello world', null);
            r.should.equal(false);
            done();
        });
    });
});
