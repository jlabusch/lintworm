var assert  = require('assert'),
    sa      = require('superagent'),
    rocket  = require('../lib/rocket'),
    config  = require('./lib/config'),
    wr_uri  = config.get('server.wrms_uri'),
    should  = require('should');

describe(require('path').basename(__filename), function(){
    rocket.__test_override_config(config);
    config.set('rocketchat.firehose', null); // default channel

    describe('format', function(){
        it('should abbreviate org name', function(){
            rocket.format.wr(1234).should.equal('`WR #1234` ' + wr_uri + '/1234');
            rocket.format.org('Caps In Name').should.equal('CIN');
            rocket.format.org('ABC Company').should.equal('ABC');
            rocket.format.org('Foo Company UK').should.equal('FCUK');
            rocket.format.org('University of Foo').should.equal('Foo');
            rocket.format.org('Foo University').should.equal('Foo');
            rocket.format.org('Foo University').should.equal('Foo');
            rocket.format.status('Foo').should.equal('`Foo`');
            rocket.format.brief('Foo').should.equal('*Foo*');
        });
    });
    describe('send', function(){
        it('should send something new (1)', function(done){
            rocket.send('hello world').about(123).to(null).channel('foo').then((err, result) => {
                should.not.exist(err);
                should.exist(result);
                result.text.should.equal('hello world');
                result.channel.should.equal('foo');
                result.missing_uri.should.equal(true);
                done();
            });
        });
        it('should send something new (2)', function(done){
            rocket.send('hello back').about(234).to(null).then((err, result) => {
                should.not.exist(err);
                should.exist(result);
                result.text.should.equal('hello back');
                should.not.exist(result.channel);
                result.missing_uri.should.equal(true);
                done();
            });
        });
        it('should skip duplicates', function(done){
            rocket.send('hello world').about(123).to(null).then((err, result) => {
                should.not.exist(err);
                should.not.exist(result);
                done();
            });
        });
        it('should track duplicates off key not message', function(done){
            rocket.send('blah blah').about(123).to(null).then((err, result) => {
                should.not.exist(err);
                should.not.exist(result);
                done();
            });
        });
        it('should trim sent messages', function(done){
            config.set('rocketchat.dedup_window_hours', 0);
            rocket.trim_sent_messages(new Date().getTime());
            rocket.send('bloo bloo').about(123).to(null).then((err, result) => {
                should.not.exist(err);
                should.exist(result);
                done();
            });
        });
    });
    describe('https', function(){
        it('should send successfully', function(done){
            let done_request = false,
                done_write = false,
                done_end = false;

            rocket.__test_override_https({
                request: function(o, next){
                    o.hostname.should.equal('foo.com');
                    o.path.should.equal('/bar/baz');
                    done_request = true;
                    process.nextTick(function(){ next({statusCode: 200}); });

                    return{
                        write: function(str){
                            JSON.stringify({text:'words'}).should.equal(str);
                            done_write = true;
                        },
                        end: function(){
                            done_end = true;
                        },
                        on: function(){}
                    };
                }
            });

            rocket.send('words').to('https://foo.com/bar/baz').then((err, result) => {
                done_request.should.equal(true);
                done_write.should.equal(true);
                done_end.should.equal(true);
                should.not.exist(err);
                should.exist(result);
                result.text.should.equal('words');
                should.not.exist(result.channel);
                should.not.exist(result.missing_uri);
                done();
            });
        });
    });
});
