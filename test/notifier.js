var assert  = require('assert'),
    MockDB  = require('./lib/mock_db').type,
    rocket  = require('../lib/rocket'),
    config  = require('./lib/config'),
    db      = require('../lib/db'),
    sa      = require('superagent'),
    should  = require('should');

describe(require('path').basename(__filename), function(){

    config.set('rocketchat.firehose', null);
    config.set('rocketchat.lint', null);
    config.set('rocketchat.update', null);
    config.set('rocketchat.timesheet', null);

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

    describe('response_times', function(){
        let type = require('../lib/notifier/response_times');
        db.__test_override(
            new MockDB([])
        );
        function mk_context(){
            return {
                activity: {
                    rows: [
                        {fresh: true, email: 'a@b.c', fullname: 'Bob', source: 'status', status: 'New'}
                    ]
                },
                wr: 1234,
                req: {
                    request_id: 1234,
                    system: 'Service Level Agreement',
                    urgency: 'As Soon As Possible',
                    created_on: (new Date()).toISOString(),
                    org: 'ABC corp'
                }
            };
        }
        it('should be silent when WR is raised', function(done){
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.not.exist(err);
                    should.exist(msg);
                    msg.__ok.should.equal(true);
                    done();
                }
            });
            notifier.run(mk_context());
        });
        it('should be silent for non-SLA WRs', function(done){
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.not.exist(err);
                    should.exist(msg);
                    msg.__not_sla.should.equal(true);
                    done();
                }
            });
            let context = mk_context();
            context.req.system = 'Cheese';
            notifier.run(context);
        });
        it('should be silent for non-time constrained WRs', function(done){
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.not.exist(err);
                    should.exist(msg);
                    msg.__no_urgency.should.equal(true);
                    done();
                }
            });
            let context = mk_context();
            context.req.urgency = 'Before Specific Date';
            notifier.run(context);
        });
        it('should be silent if we\'ve responded', function(done){
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.not.exist(err);
                    should.exist(msg);
                    msg.__have_responded.should.equal(true);
                    done();
                }
            });
            let context = mk_context();
            context.activity.rows.push(
                {fresh: true, email: 'fred@catalyst-eu.net', fullname: 'Fred', source: 'note'}
            );
            notifier.run(context);
        });
        it('should warn if we\'re nearing the limit', function(done){
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.not.exist(err);
                    should.exist(msg);
                    should.exist(msg.text.match(/needs to be responded to/));
                    done();
                }
            });
            let context = mk_context();
            context.req.urgency = "'Yesterday'";
            let now = (new Date()).getTime(),
                mins = 60*1000,
                hours = 60*mins,
                max = config.get('response_times.urgency_hours')[context.req.urgency]*hours,
                warn = config.get('response_times.warn_at_X_mins_left')*mins;
            context.req.created_on = now - max + warn - 5*mins;
            notifier.run(context);
        });
        it('should warn if we\'re over the limit', function(done){
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.not.exist(err);
                    should.exist(msg);
                    should.exist(msg.text.match(/is past due/));
                    done();
                }
            });
            let context = mk_context();
            context.req.urgency = "'Yesterday'";
            let now = (new Date()).getTime(),
                mins = 60*1000,
                hours = 60*mins,
                max = config.get('response_times.urgency_hours')[context.req.urgency]*hours;
            context.req.created_on = now - max - 5*mins;
            notifier.run(context);
        });
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
        it('should show 0%', function(done){
            db.__test_override(
                new MockDB([
                    [null, {rows: [
                        {fullname: 'Bob', worked: 0}
                    ]}]
                ])
            );
            let notifier = new type({
                __test_hook: function(err, msg){
                    should.exist(msg);
                    should.exist(msg.text.match(/Bob\s+0%/));
                    done();
                }
            });
            notifier.run();
        });
    });
    describe('linting', function(){
        let type = require('../lib/notifier/linting');
        it('with note by us and last status change by us', function(done){
            let poll_rows = [
                {request_id: 1234},
                {request_id: 5678}
            ];
            let poller = {
                add_hook: function(str, fn){
                    process.nextTick(() => { fn(poll_rows); });
                },
                latest_update: function(x){
                    return x || new Date();
                },
                previous_update: function(x){
                    return x || new Date();
                }
            };
            db.__test_override(
                new MockDB([
                    [null, {rows: ['1234 req']}],
                    [null, {rows: ['1234 alloc']}],
                    [null, {rows: ['1234 quotes']}],
                    [null, {rows: ['1234 tags']}],
                    [null, {rows: ['1234 activity']}],
                    [null, {rows: ['1234 parents']}],
                    [null, {rows: ['5678 req']}],
                    [null, {rows: ['5678 alloc']}],
                    [null, {rows: ['5678 quotes']}],
                    [null, {rows: ['5678 tags']}],
                    [null, {rows: ['5678 activity']}],
                    [null, {rows: ['5678 parents']}]
                ])
            );
            let rules_result = [
                {
                    rows: [
                        {warning: 'test warning 1'},
                        {org: 'ABC co', wr: 1234, status: 'New', brief: 'description 1', to: ['Bob']}
                    ]
                },
                {
                    rows: [
                        {warning: 'test warning 2'},
                        {org: 'ABC co', wr: 5678, status: 'Allocated', brief: 'description 2'}
                    ]
                }
            ];
            let notifier = new type({
                __test_overrides: {
                    rules: {
                        apply: function(context, next){
                            next && next(null, rules_result.shift());
                        }
                    },
                    poller: poller
                }
            });
            notifier.start();
            setTimeout(() => {
                notifier.flush_messages((err, msg) => {
                    should.not.exist(err);
                    should.exist(msg);
                    console.log(JSON.stringify(msg));
                    (msg.text.match(/test warning 1/) !== null).should.equal(true);
                    (msg.text.match(/test warning 2/) !== null).should.equal(true);
                    should.not.exist(msg.channel);
                    done();
                });
            }, 200);
        });
    });
    describe('updates', function(){
        let type = require('../lib/notifier/updates');
        config.set('updates.client_only', true);

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
