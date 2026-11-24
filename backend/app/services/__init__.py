"""Service layer. Each module owns its tables and exposes functions, not tables.

No module reads another module's tables directly; cross-module reads go through these
service functions. In the full build an import-linter rule in CI enforces the boundary
(PRD 7.1).
"""
