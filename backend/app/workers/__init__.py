"""Worker processes: the job runner, the scheduler and the task handlers.

The MVP runs these in-process alongside the API so the whole stack starts with one
command. Setting a Redis URL and running app/workers/runner.py as a separate process
gives the deployment topology in PRD 7.6 with no code change: the queues, the claim
semantics and the idempotency rules are the same either way.
"""
