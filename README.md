# lintworm

Lintworm watches WRMS and mentions things we might want to react to.

[![Code Climate](https://codeclimate.com/github/jlabusch/lintworm/badges/gpa.svg)](https://codeclimate.com/github/jlabusch/lintworm)
[![Test Coverage](https://codeclimate.com/github/jlabusch/lintworm/badges/coverage.svg)](https://codeclimate.com/github/jlabusch/lintworm/coverage)


### For example:

 - A client posts a comment or changes a ticket's status (by default our own comments are ignored)
 - A ticket's state is bad, e.g. work with no quote, too many people allocated, client chasing us for response&hellip;
 - People need to be reminded about timesheets

### Configuration:

 - Create `./config/default.json` based on `./config/default.json.example`
 - The hardest bits of config to come by are `db.host` because access is limited and `rocketchat.*` because someone needs to create incoming webhooks for you. You can't run without `db.host`, but leaving `rocketchat.* = null` is fine for testing.

### Useful commands:

 - `make test` to run ESLint and Mocha
 - `make run` to start the app; roughly equivalent to `docker-compose up`
 - `docker-compose down` to stop the app

### Things to know:

 - `make test` uses Istanbul to write code coverage metrics to `./coverage/lcov-report/index.html`
 - We monkeypatch Bunyan to change the "simple" log format
 - The RocketChat incoming webhook script is `./rocketchat/incoming.js`
 - You can change the log level in `./config/default.json:log.level`
 - To add new notifiers, take a look in `./app/lib/notifiers/*`. Use `app/lib/hook.js` if you can, to avoid additional queries.
 - To send test coverage reports to CodeClimate, add the following script to `package.json`:

```javascript
"posttest": "CODECLIMATE_REPO_TOKEN=$token ./node_modules/.bin/codeclimate-test-reporter < ./coverage/lcov.info",
```
