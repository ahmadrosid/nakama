# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the
[Security tab](https://github.com/ahmadrosid/nakama/security) and click
**Report a vulnerability**. Only the maintainers see the report.

Please do not open a public issue, pull request or discussion for a
vulnerability before it is fixed. Everything posted in this repository is
public and stays in its edit history.

A useful report has:

- the version or commit you tested
- how the instance was deployed (Docker image, `bun` from source, desktop app)
- the steps to reproduce, and what an attacker gains
- whether the issue needs an authenticated user, and with which role

## What happens next

We aim to acknowledge a report within 7 days and to keep you updated until it
is resolved. Fixes ship in a normal release, and the advisory is published
once a fixed release is out. Reporters are credited in the advisory unless they
ask not to be.

## Supported versions

Only the latest release gets security fixes. Releases come out every few days,
so the fix for an issue is to upgrade. Older versions are not patched.

## Scope

What Nakama does and does not try to protect, and the risks it accepts, are
written down in [THREAT_MODEL.md](./THREAT_MODEL.md). A report that shows one
of those boundaries does not hold is in scope.
