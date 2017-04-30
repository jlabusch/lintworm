var log = require('./log');

'use strict'

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Lintworm(){
    this.db = undefined;
    this.latest_update = undefined;
}

Lintworm.prototype.init = function(db){
    this.db = db;
}

Lintworm.prototype.poll = function(next){
    log.trace(_L('poll') + sql.poll.replace(/\s+/g, ' '));
    const days = 24*60*60*1000,
        today = new Date().getTime();
    let from = this.latest_update || new Date(today - 3*days).toISOString(),
        to   = new Date(new Date(from).getTime() + 7*days).toISOString();
    this.db.query(
        "poll",
        sql.poll,
        [
            from,
            to // this cuts out future timesheet entries (usually typos)
        ],
        (err, data) => {
            if (!err && data && data.rows && data.rows.length > 0){
                this.latest_update = data.rows[0].updated_on;
            }
            next(err, data);
        }
    );
}

module.exports = new Lintworm();

var sql = {
    poll:   "SELECT request.request_id," +
            "       ru.fullname as requested_by," +
            "       request.brief," +
            "       org.org_name, " +
            "       sys.system_desc AS system," +
            "       stat.lookup_desc AS request_status, " +
            "       urge.lookup_desc AS request_urgency, " +
            "       importance.lookup_desc AS request_importance, " +
            "       uu.fullname as updated_by," +
            "       ra.source as update_type, " +
            "       ra.date as updated_on, " +
            "       (SELECT " +
            "           SUM(" +
            "               CASE WHEN work_units = 'days' THEN work_quantity * 8 ELSE " +
            "               CASE WHEN work_units = 'hours' THEN work_quantity ELSE " +
            "               -999999 " +
            "               END END)" +
            "           FROM request_timesheet ts" +
            "           WHERE ts.request_id=request.request_id) as total_hours " +
            "FROM request " +
            "JOIN work_system sys ON request.system_id = sys.system_id " +
            "JOIN request_activity ra on ra.request_id=request.request_id " +
            "INNER JOIN lookup_code stat ON stat.source_table = 'request'" +
            "   AND stat.lookup_code = request.last_status " +
            "INNER JOIN lookup_code urge ON urge.source_table = 'request'" +
            "   AND urge.source_field = 'urgency'" +
            "   AND urge.lookup_code = cast(request.urgency as text) " +
            "INNER JOIN lookup_code importance ON importance.source_table = 'request'" +
            "   AND importance.source_field = 'importance'" +
            "   AND importance.lookup_code = cast(request.importance as text)" +
            "JOIN usr uu on uu.user_no = ra.worker_id " +
            "JOIN usr ru on ru.user_no = request.requester_id " +
            "JOIN organisation org on org.org_code=ru.org_code " +
            "WHERE org.org_code in (1137,1286,1328,1360,1423,1478,1484,1493,1521,1527,1562,1577,1597,1625,1690,1700,1724,1729,1730,1731,1739,1742,1743) " +
            "   AND ra.date > $1 " +
            "   AND ra.date < $2 " +
            "ORDER BY ra.date desc"
};

