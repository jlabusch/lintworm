var assert  = require('assert'),
    sa      = require('superagent'),
    rocket  = require('../lib/rocket'),
    should  = require('should');

describe(require('path').basename(__filename), function(){
    describe('send', function(){
        it('should send something new (1)', function(done){
            rocket.send('hello world').about(123).to(null).then((err, result) => {
                should.not.exist(err);
                result.should.equal(true);
                done();
            });
        });
        it('should send something new (2)', function(done){
            rocket.send('hello back').about(234).to(null).then((err, result) => {
                should.not.exist(err);
                result.should.equal(true);
                done();
            });
        });
        it('should skip duplicates', function(done){
            rocket.send('hello world').about(123).to(null).then((err, result) => {
                should.not.exist(err);
                result.should.equal(false);
                done();
            });
        });
        it('should track duplicates off key not message', function(done){
            rocket.send('blah blah').about(123).to(null).then((err, result) => {
                should.not.exist(err);
                result.should.equal(false);
                done();
            });
        });
    });
});
