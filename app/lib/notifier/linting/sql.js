function tidy(s){
    return s[0].replace(/\s+/g, ' ');
}

exports.lint_req =
    tidy`SELECT r.request_id,
                r.brief,
                ru.fullname as requested_by,
                o.org_name as org,
                r.request_on as created_on,
                sys.system_desc as system,
                stat.lookup_desc as status,
                urg.lookup_desc as urgency,
                imp.lookup_desc as importance,
                (SELECT
                    SUM(
                        CASE WHEN work_units = 'days' THEN work_quantity*8 ELSE
                        CASE WHEN work_units = 'hours' THEN work_quantity ELSE
                        0
                        END END)
                    FROM request_timesheet ts
                    WHERE ts.request_id=r.request_id) as total_hours
                FROM request r
                JOIN work_system sys on r.system_id=sys.system_id
                INNER JOIN lookup_code stat on stat.source_table='request'
                    AND stat.lookup_code=r.last_status
                INNER JOIN lookup_code urg on urg.source_table='request'
                    AND urg.source_field='urgency'
                    AND urg.lookup_code=cast(r.urgency as text)
                INNER JOIN lookup_code imp on imp.source_table='request'
                    AND imp.source_field='importance'
                    AND imp.lookup_code=cast(r.importance as text)
                JOIN usr ru on ru.user_no=r.requester_id
                JOIN organisation o on o.org_code=ru.org_code
                WHERE r.request_id=$1`;

exports.lint_alloc = tidy`
        SELECT  ra.allocated_on,
                u.fullname,
                u.email
        FROM request_allocated ra
        JOIN usr u ON u.user_no=ra.allocated_to_id
        WHERE ra.request_id=$1
    `;

exports.lint_quote = tidy`
        SELECT  rq.quote_amount,
                rq.quote_units,
                rq.approved_by_id,
                rq.quote_cancelled_by,
                rq.invoice_no
        FROM request_quote rq
        WHERE rq.request_id=$1
    `;

exports.lint_tag = tidy`
        SELECT  r.request_id,
                t.tag_description
        FROM request r
        JOIN request_tag rt ON r.request_id=rt.request_id
        JOIN organisation_tag t ON t.tag_id=rt.tag_id
        WHERE r.request_id=$1
    `;

exports.lint_activity = tidy`
        SELECT  (SELECT ra.date > $2) AS fresh,
                ra.source,
                u.fullname,
                u.email,
                ra.date,
                ra.note,
                lc.lookup_desc as status
        FROM request_activity ra
        JOIN usr u ON u.user_no=ra.worker_id
        LEFT JOIN lookup_code lc ON lc.lookup_code=ra.note AND lc.source_field='status_code'
        WHERE ra.request_id=$1
        ORDER BY ra.date ASC
    `;

exports.lint_parent = tidy`
        WITH RECURSIVE relations AS (
            SELECT *
                FROM request_request
                WHERE link_type='I' AND to_request_id=$1
            UNION
            SELECT rr.*
                FROM request_request rr
                JOIN relations r
                ON (r.request_id = rr.to_request_id AND rr.link_type='I')
        )
        SELECT *,
            (SELECT SUM(
                CASE WHEN q.quote_units='days' THEN q.quote_amount*8 ELSE
                CASE WHEN q.quote_units='hours' THEN q.quote_amount ELSE
                0 END END) as quoted_hours
            FROM request_quote q
            WHERE q.request_id=relations.request_id),
            (SELECT SUM(
                CASE WHEN q.quote_units='days' THEN q.quote_amount*8 ELSE
                CASE WHEN q.quote_units='hours' THEN q.quote_amount ELSE
                0 END END) as approved_hours
            FROM request_quote q
            WHERE q.request_id=relations.request_id AND q.approved_by_id IS NOT NULL)
        FROM relations
    `;

