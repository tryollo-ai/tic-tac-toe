# Agent issue->PR loop — selectTickets CLI end-to-end evidence

The dispatch workflow runs:  gh issue list --json number,title,labels,createdAt,state | npx tsx selectTickets.cli.ts --max "$MAX_INPUT"
Below is that exact CLI driven over a realistic mixed issue list.

## Input issue list (/tmp/issues.json)
```json
[
  { "number": 101, "title": "Fix crash on empty board", "state": "OPEN",   "createdAt": "2026-06-10T09:00:00Z", "labels": [{ "name": "agent:ready" }, { "name": "priority:critical" }] },
  { "number": 102, "title": "Add dark mode",            "state": "OPEN",   "createdAt": "2026-06-01T09:00:00Z", "labels": [{ "name": "agent:ready" }, { "name": "priority:low" }] },
  { "number": 103, "title": "Improve lobby copy",       "state": "OPEN",   "createdAt": "2026-06-05T09:00:00Z", "labels": [{ "name": "agent:ready" }, { "name": "priority:high" }] },
  { "number": 104, "title": "Already being worked",     "state": "OPEN",   "createdAt": "2026-05-01T09:00:00Z", "labels": [{ "name": "agent:ready" }, { "name": "priority:critical" }, { "name": "claude:in-progress" }] },
  { "number": 105, "title": "Parked for captain",       "state": "OPEN",   "createdAt": "2026-05-02T09:00:00Z", "labels": [{ "name": "agent:ready" }, { "name": "claude:needs-captain" }] },
  { "number": 106, "title": "Not opted in",             "state": "OPEN",   "createdAt": "2026-05-03T09:00:00Z", "labels": [{ "name": "priority:critical" }] },
  { "number": 107, "title": "Closed but ready",         "state": "CLOSED", "createdAt": "2026-05-04T09:00:00Z", "labels": [{ "name": "agent:ready" }, { "name": "priority:high" }] },
  { "number": 108, "title": "Older high-priority",      "state": "OPEN",   "createdAt": "2026-06-02T09:00:00Z", "labels": [{ "name": "agent:ready" }, { "name": "priority:high" }] }
]
```

## Selection results

### Default run (max=3, json) — fed straight to the matrix via fromJSON()
```
$ gh issue list ... | npm run select-tickets
[101,108,103]
```
Picks 101 (critical), then high-priority FIFO 108 (Jun 2) before 103 (Jun 5).
Excludes: 104 claude:in-progress, 105 claude:needs-captain, 106 not agent:ready, 107 CLOSED.

### --max 5 --format lines (low-priority 102 now included, still last)
```
$ ... | npm run select-tickets -- --max 5 --format lines
101
108
103
102
```

### Security: non-numeric --max rejected (event-data injection guard)
```
$ echo '[]' | npm run select-tickets -- --max '3; rm -rf /'
exit=2
```

### Empty / no-eligible input -> clean no-op
```
$ echo '[]' | npm run select-tickets
[]
```

## Unit suite (selectTickets.test.ts)
```
 ✓ scripts/agent-loop/selectTickets.test.ts (10 tests) 10ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```
