var assert  = require('assert'),
    MockDB  = require('./lib/mock_db').type,
    rocket  = require('../lib/rocket'),
    db      = require('../lib/db'),
    sa      = require('superagent'),
    should  = require('should');

describe(require('path').basename(__filename), function(){

    rocket.__test_override_https({
        request: function(o, next){
            process.nextTick(function(){ next({statusCode: 200}); });

            return{
                write: function(str){},
                end: function(){},
                on: function(){}
            };
        }
    });

    describe('timesheets', function(){
        let type = require('../lib/notifier/timesheets');
        it('should flag < 70%', function(done){
            db.__test_override(
                new MockDB([
                    [null, {rows: [{fullname: 'Bob', worked: 69.0}]}]
                ])
            );
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.exist(msg);
                    should.exist(msg.text.match(/Bob\s+69%/));
                    done();
                }
            });
            notifier.run();
        });
    });
    describe('updates', function(){
        let type = require('../lib/notifier/updates');
        it('with note by us and last status change by us', function(done){
            let sent = false;
            let notifier = new type({
                __test_hook: function(err, msg){
                    sent = true;
                }
            });
            notifier.run({
                activity: {
                    rows: [
                        {fresh: true, email: 'a@b.c', fullname: 'Bob', source: 'status', status: 'New'},
                        {fresh: true, email: 'cindy@catalyst-eu.net', fullname: 'Cindy', source: 'status', status: 'Need info'},
                        {fresh: true, email: 'cindy@catalyst-eu.net', fullname: 'Cindy', source: 'note', note: 'words'}
                    ]
                },
                wr: 1234,
                req: {
                    org: 'ABC corp'
                }
            });

            setTimeout(function(){
                sent.should.equal(false);
                done();
            }, 100);
        });
        it('with note by client and status changes by both', function(done){
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.exist(msg);
                    (msg.text.match(/Bob added a note and we set status to `Need info`/) !== null).should.equal(true);
                    should.not.exist(msg.channel);
                    done();
                }
            });
            notifier.run({
                activity: {
                    rows: [
                        {fresh: true, email: 'a@b.c', fullname: 'Bob', source: 'status', status: 'New'},
                        {fresh: true, email: 'cindy@catalyst-eu.net', fullname: 'Cindy', source: 'status', status: 'Need info'},
                        {fresh: true, email: 'a@b.c', fullname: 'Bob', source: 'note', note: 'Here is info'}
                    ]
                },
                wr: 1234,
                req: {
                    org: 'ABC corp'
                }
            });
        });
    });
});
