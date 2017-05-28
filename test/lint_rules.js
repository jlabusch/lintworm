var assert  = require('assert'),
    config  = require('config'),
    quote_leeway = config.get('lint.hours_before_quote_required'),
    overrun_leeway = config.get('lint.acceptable_hours_budget_overrun'),
    lwm = require('../lib/lintworm.js'),
    should  = require('should');

function setup(pre, post){
    let context = {
        wr: 1234,
        req: {request_id: 1234, total_hours: 0, status: 'New Request'},
        alloc: {rows: [{email: 'a@b.c', fullname: 'A B'}]},
        quote: {rows: []},
        tags: {rows: []},
        activity: {rows: []},
        parents: {rows: []}
    };
    pre(context);
    return [
        context,
        function(err, data){
            data.rows.forEach((r) => {
                console.log('\t> ' + (r.warning || r.info || r.msg));
            });
            return post(err, data)
        }
    ];
}

describe(require('path').basename(__filename), function(){
    describe('sanity check', function(){
        it('should handle success', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        data.rows[0].wr.should.equal(1234);
                        should.exist(data.rows[0].msg.match(/^No warnings/))
                        done();
                    }
                )
            );
        });
    });
    describe('allocation rules', function(){
        it('shouldn\'t flag unallocated for Finished WRs', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.status = 'Finished';
                        c.alloc.rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].msg.match(/^No warnings/))
                        done();
                    }
                )
            );
        });
        it.skip('should flag unallocated in general', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.alloc.rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
        it('should flag multiple allocation', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.alloc.rows = [
                            {email: 'a@b.c', fullname: 'A B'},
                            {email: 'x@catalyst-eu.net', fullname: 'X'},
                            {email: 'y@catalyst-eu.net', fullname: 'X'},
                            {email: 'z@catalyst-eu.net', fullname: 'X'}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        should.exist(data.rows[0].warning);
                        data.rows[0].warning.match(/allocated/).should.not.be.null;
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
        it('...unless one of them is the Sysadmin account', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.alloc.rows = [
                            {email: 'y@catalyst-eu.net', fullname: 'Catalyst Sysadmin Europe'},
                            {email: 'x@catalyst-eu.net', fullname: 'X'}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].msg.match(/^No warnings/))
                        should.exist(data.rows[0].to);
                        should.exist(data.rows[0].to[0].match(/catalyst/));
                        done();
                    }
                )
            );
        });
    });
    describe('billing rules', function(){
        it('should recognise warranty', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.total_hours = quote_leeway + 1;
                        c.tags.rows = [
                            {tag_description: 'A'},
                            {tag_description: 'Warranty'},
                            {tag_description: 'C'}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].info);
                        should.exist(data.rows[1].wr);
                        should.exist(data.rows[1].msg.match(/^No warnings/))
                        done();
                    }
                )
            );
        });
        it('should flag hours with no quotes', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.wr = 221615,
                        c.req = {
                            request_id: 221615,
                            total_hours: quote_leeway+5
                        };
                        c.alloc.rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/over budget/));
                        should.exist(data.rows[1].wr);
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
        it('should flag unapproved quotes', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.total_hours = quote_leeway+1;
                        c.quote.rows = [
                            {quote_units: 'hours', quote_amount: 5, approved_by_id: undefined}
                        ]
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/approved/));
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        should.exist(data.rows[1].wr);
                        done();
                    }
                )
            );
        });
        it('should ignore cancelled quotes', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.total_hours = quote_leeway+1;
                        c.quote.rows = [
                            {quote_units: 'hours', quote_amount: 5, approved_by_id: undefined, quote_cancelled_by: 123}
                        ]
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/approved/));
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        should.exist(data.rows[1].wr);
                        done();
                    }
                )
            );
        });
        it('should consider approved quotes', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.total_hours = quote_leeway+1;
                        c.quote.rows = [
                            {quote_units: 'hours', quote_amount: 5, approved_by_id: 1}
                        ]
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].wr);
                        should.exist(data.rows[0].msg);
                        should.exist(data.rows[0].msg.match(/^No warning/));
                        done();
                    }
                )
            );
        });
        it('should respect config.lint.hours_before_quote_required', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.total_hours = quote_leeway;
                        c.quote.rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].wr);
                        should.exist(data.rows[0].msg);
                        should.exist(data.rows[0].msg.match(/^No warning/));
                        done();
                    }
                )
            );
        });
    });
    describe('notes', function(){
        it('should flag too many notes with no timesheets', function(done){
            let today = (new Date()).toISOString();
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.total_hours = 0;
                        c.activity.rows = [
                            {source: 'note', email: 'a@b.c', updated_on: today},
                            {source: 'note', email: 'me@catalyst-eu.net', updated_on: today},
                            {source: 'note', email: 'a@b.c', updated_on: today},
                            {source: 'note', email: 'me@catalyst-eu.net', updated_on: today}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/notes .* with no time/));
                        should.exist(data.rows[1].wr);
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
        it('should guess when client is chasing forgotten tickets', function(done){
            let today = (new Date()).toISOString(),
                last_week = (new Date(new Date().getTime()-14*24*60*60*1000)).toISOString();
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (c) => {
                        c.req.total_hours = 0;
                        c.activity.rows = [
                            {source: 'note', email: 'a@b.c', updated_on: last_week},
                            {source: 'note', email: 'me@catalyst-eu.net', updated_on: last_week},
                            {source: 'note', email: 'a@b.c', updated_on: today},
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/forgotten/));
                        should.exist(data.rows[1].wr);
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
    });
});
