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

MockDB.prototype.query = async function(){
    return new Promise((resolve, reject) => {
        // Example (one element): [null, {rows: ['a', 'b', 'c']}]
        let answer = this.answers.shift() || [new Error('No more data'), null];
        if (answer[0]){
            reject(answer[0]);
        }else{
            resolve(answer[1]);
        }
    });
}

MockDB.prototype.add_answer = function(err, rows){
    if (arguments.length < 2){
        rows = err;
        err = null;
    }
    if (!Array.isArray(rows)){
        rows = [rows];
    }
    this.answers.push([err, {rows: rows}]);
}

app.run(db, PORT);

describe(require('path').basename(__filename), function(){
    describe('lint', function(){
        let agent = sa.agent();
        it('should support options', function(done){
            agent.options(URI + '/lint/255592')
                .end(function(err, res){
                    should.not.exist(err);
                    res.status.should.equal(200);
                    done();
                });
        });
        it('should answer queries', function(done){
            db.add_answer( // lint.request
                {
                  "request_id": 255592,
                  "brief": "a b c d e f",
                  "requested_by": "Bob Smith",
                  "org": "Company Co",
                  "system": "Foo",
                  "status": "Allocated",
                  "urgency": "On Specified Date",
                  "importance": "Minor importance",
                  "total_hours": 2.5
                }
            );
            db.add_answer( // lint.alloc
                {
                    "allocated_on": "2016-04-26T11:12:40.000Z",
                    "fullname": "Bob Smith",
                    "email": "bob.smith@company.com"
                }
            );
            db.add_answer( // lint.quotes
                []
            );
            db.add_answer( // lint.tags
                []
            );
            db.add_answer( // lint.activity
                [
                    {
                      "source": "status",
                      "fullname": "Simon Jones",
                      "email": "simon.jones@company.com",
                      "date": "2014-09-02T14:59:39.000Z"
                    },
                    {
                      "source": "status",
                      "fullname": "Simon Jones",
                      "email": "simon.story@company.com",
                      "date": "2014-09-02T15:01:10.000Z"
                    },
                    {
                      "source": "status",
                      "fullname": "Simon Jones",
                      "email": "simon.story@company.com",
                      "date": "2014-10-27T14:24:14.000Z"
                    }
                ]
            );
            db.add_answer( // lint.relations
                {
                  "request_id": 87447,
                  "to_request_id": 255592,
                  "link_type": "I",
                  "link_data": null,
                  "quoted_hours": null,
                  "approved_hours": null
                }
            );
            agent.get(URI + '/lint/255592')
                .end(function(err, res){
                    should.not.exist(err);
                    res.status.should.equal(200);
                    let json = undefined;
                    try{
                        json = JSON.parse(res.text);
                    }catch(ex){
                    }
                    Array.isArray(json).should.equal.true;
                    json.length.should.equal(2);
                    json[1].wr.should.equal(255592);
                    done();
                });
        });
    });
});
