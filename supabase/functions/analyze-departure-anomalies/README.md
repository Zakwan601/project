# Departure anomaly analysis

Admin-only Edge Function for probable bunking and early-departure detection.

The official departure time is supplied for the selected class and date on every
request. It is stored with that date for auditability and is reused only when
evaluating historical recurrence for that same historical date.

Deploy:

```bash
supabase db push
supabase functions deploy analyze-departure-anomalies
```

The standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` function secrets are required.

## Request

```http
POST /functions/v1/analyze-departure-anomalies
Authorization: Bearer <active-admin-access-token>
Content-Type: application/json

{
  "class_id": "00000000-0000-4000-8000-000000000000",
  "date": "2026-08-05",
  "departure_time": "15:00"
}
```

## Load an existing report

The admin frontend automatically requests the latest stored result when a class
and date are selected:

```http
GET /functions/v1/analyze-departure-anomalies?class_id=<CLASS_UUID>&date=2026-08-05
Authorization: Bearer <active-admin-access-token>
```

This reads the persisted report even after its computation-cache TTL has expired.
It returns `404` with `code: saved_analysis_not_found` when that class/date has
never been analyzed. Posting the same class/date with a different
`departure_time` recomputes and replaces the stored report.

## Successful response shape

```json
{
  "report_id": "uuid",
  "algorithm_version": "departure-risk-v1",
  "generated_at": "2026-08-05T10:30:00.000Z",
  "date": "2026-08-05",
  "class": { "id": "uuid", "name": "Class 8 A", "grade": "8", "section": "A" },
  "configuration": {
    "departure_time": "15:00:00",
    "timezone": "Asia/Dhaka",
    "early_threshold_minutes": 30,
    "history_window_days": 60,
    "minimum_cohort_size": 8,
    "cache_ttl_seconds": 300
  },
  "cohort": {
    "total_active_students": 35,
    "students_arrived": 33,
    "with_departure": 31,
    "without_departure": 2,
    "minimum_size_for_outliers": 8,
    "median_departure_time": "15:03:00",
    "q1_departure_time": "14:58:00",
    "q3_departure_time": "15:07:00",
    "iqr_minutes": 9,
    "mad_minutes": 4,
    "statistics_reliable": true
  },
  "summary": {
    "total_flagged": 3,
    "by_category": { "missing_departure": 1, "significantly_early": 2, "statistical_outlier": 1 },
    "by_risk_level": { "high": 1, "medium": 2, "low": 0 }
  },
  "flagged_students": [
    {
      "student_id": "uuid",
      "admission_number": "A-1007",
      "roll_number": 7,
      "student_name": "Example Student",
      "arrival_at": "2026-08-05T08:47:00+00:00",
      "departure_at": "2026-08-05T13:42:00+00:00",
      "arrival_time": "08:47:00",
      "departure_time": "13:42:00",
      "scan_count": 2,
      "categories": ["significantly_early", "statistical_outlier"],
      "risk_score": 91,
      "risk_level": "High",
      "confidence": "High",
      "reasons": [
        {
          "code": "EARLY_BEFORE_OFFICIAL_DISMISSAL",
          "category": "significantly_early",
          "message": "Departure was 78 minutes before the supplied 15:00:00 departure time.",
          "evidence": { "minutes_before_dismissal": 78 }
        }
      ],
      "evidence": {},
      "history": {
        "window_days": 60,
        "observed_days": 32,
        "comparable_early_departure_days": 18,
        "missing_departure_days": 0,
        "early_departure_days": 4
      }
    }
  ],
  "cached": false,
  "cache_expires_at": "2026-08-05T10:35:00.000Z",
  "request_id": "uuid"
}
```

Possible non-200 `code` values include `analysis_not_ready`, `future_date`, and
`class_not_found`.

## Statistical policy

- Official-time early departure uses the manually supplied departure time for
  the selected class/date and the database-configured threshold.
- Cohort outliers use the early-side modified Z-score based on median/MAD.
- If MAD is zero, the lower Tukey IQR fence is used. If both spreads are zero,
  a conservative median-distance fallback is used.
- Statistical outliers are disabled until the configured minimum number of
  departure scans exists.
- Missing-scan recurrence uses earlier days on which that student had at least
  one raw scan. Historical early-departure recurrence uses only earlier days
  with their own stored, manually supplied departure time; it never applies the
  selected day's time to another day.
