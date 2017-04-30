var log = require('./log');

'use strict'

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Lintworm(){
    this.db = undefined;
}

Lintworm.prototype.init = function(db){
    this.db = db;
}

Lintworm.prototype.poll = function(limit, next){
    log.trace(_L('poll') + sql.poll.replace(/\s+/g, ' '));
    this.db.query(
        "poll",
        sql.poll,
        [limit || 10],
        next
    );
}

module.exports = new Lintworm();

var sql = {
    poll:   "SELECT request.request_id," +
            "       request.brief," +
            "       request.last_status," +
            "       uu.fullname as updated_by," +
            "       ru.fullname as requested_by," +
            "       request_activity.date as updated_on, " +
            "       (SELECT " +
            "           SUM(" +
            "               CASE WHEN work_units = 'days' THEN work_quantity * 8 ELSE " +
            "               CASE WHEN work_units = 'hours' THEN work_quantity ELSE " +
            "               -999999 " +
            "               END END)" +
            "           FROM request_timesheet ts" +
            "           WHERE ts.request_id=request.request_id) as total_hours," +
            "       org.org_name " +
            "FROM request " +
            "JOIN request_activity on request_activity.request_id=request.request_id " +
            "JOIN usr uu on uu.user_no = request_activity.worker_id " +
            "JOIN usr ru on ru.user_no=request.requester_id " +
            "JOIN organisation org on org.org_code=ru.org_code " +
            "WHERE org.org_code in (1137,1286,1328,1360,1423,1478,1484,1493,1521,1527,1562,1577,1597,1625,1690,1700,1724,1729,1730,1731,1739,1742,1743) " +
            "   AND request_activity.date > '2017-04-29' " +
            "   AND request_activity.date < '2017-5-1' " +
            "ORDER BY request_activity.date desc " +
            "LIMIT $1",
};

