var assert  = require('assert'),
    config  = require('config'),
    sa      = require('superagent'),
    app     = require('../index.js'),
    should  = require('should');

const PORT = config.get('server.port'),
      URI = 'http://127.0.0.1:' + PORT;

// answers should be an array of [err, data] pairs.
function MockDB(answers){
    this.answers = answers || [];
}

var db = new MockDB();

MockDB.prototype.query = function(){
    try{
        let args = Array.prototype.slice.call(arguments, 0),
            callback = arguments[arguments.length - 1];
        // Example (one element): [null, {rows: ['a', 'b', 'c']}]
        let answer = this.answers.shift() || [new Error('No more data'), null];
        if (typeof(callback) === 'function'){
            callback.apply(this, answer);
        }
    }catch(ex){
        console.error(ex);
    }
}

app.run(db, PORT);

describe(require('path').basename(__filename), function(){
    describe('poll', function(){
        let agent = sa.agent();
        it('should support options', function(done){
            agent.options(URI + '/poll')
                .end(function(err, res){
                    should.not.exist(err);
                    res.status.should.equal(200);
                    done();
                });
        });
        it('should answer queries', function(done){
            db.answers.push([
                null,
                {rows: [
                    {
                        "brief": "Totara version upgrade to latest stable release.",
                        "org_name": "British Dental Association",
                        "request_id": 271750,
                        "request_importance": "Major importance",
                        "request_status": "In Progress",
                        "request_urgency": "Sometime soon",
                        "requested_by": "Stephen Macdonald",
                        "system": "BDA Totara 9 Upgrade 2017",
                        "total_hours": 6.5,
                        "update_type": "note",
                        "updated_by": "Jonathan Sharp - Euro",
                        "updated_on": "2017-04-28T09:54:07.000Z"
                    }
                ]}
			]);
            agent.get(URI + '/poll')
                .end(function(err, res){
                    should.not.exist(err);
                    res.status.should.equal(200);
                    let json = undefined;
                    try{
                        json = JSON.parse(res.text);
                    }catch(ex){
                    }
                    Array.isArray(json).should.equal.true;
                    json.length.should.equal(1);
                    json[0].update_type.should.equal('note');
                    done();
                });
        });
    });
});
