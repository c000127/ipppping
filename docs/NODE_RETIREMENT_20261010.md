# Scoped node retirement — 2026-10-10

The user requested removal of two production nodes and peer synchronization,
with Legend SG explicitly exempt because it was temporarily offline. Production
names, addresses and operational inventory remain private; the actual removed
IDs and names are recorded in the controller's private backup and local ignored
rollout reports. This document records behavior and evidence, not a public
replacement inventory.

## Applied scope

At 12:49:02.994 UTC (20:49 Singapore time), the controller had applied:

- removal of four target blocks (IPv4 and IPv6 for each retired node);
- removal of both aliases from every remaining target's slave assignments;
- removal of both slave registrations and their upload-authentication entries;
- removal of both rows from the credential-free SSH inventory and legacy
  address inventory;
- removal of both entries from the API's startup-loaded private node JSON.

The temporarily offline node retains its API entry, target blocks, slave
registration and upload authentication. No SSH connection or forced refresh
was attempted against that node. Its next successful normal signed exchange
can receive the current master configuration when it returns; that future
exchange has not been tested or counted as completed synchronization.

No historical RRD files, prior backups, node OS packages or Docker installation
were deleted. Retirement from the production registry does not certify that
the collectors on the two removed machines have been uninstalled or stopped.

## Activation and recovery

All six original files and a restore manifest are in the private mode-0700
directory:

`/root/ipppping-retire-alpha-tamago-20261010T124900Z`

Its files are mode 0600; the manifest records original ownership, permissions
and hashes. Do not publish this directory: one member contains shared upload
authentication. Restoring it requires checking whether later configuration
changes have occurred, restoring the appropriate files and ownership, validating
SmokePing, advancing the main configuration version, gracefully reloading the
receiver, signaling the supervised collector and reloading the API node list.
Restoring old registrations is an explicit re-enrollment decision, not routine
backup restoration.

SmokePing configuration and Apache syntax checks passed. The main configuration
version was advanced, Apache/FCGI gracefully reloaded, and the supervised master
collector received HUP. The API was restarted once because the deployed node
list is read at process startup. API PID changed from 4089341 to 677905,
`NRestarts=0`, and local health/nodes checks passed. Application Python,
frontend assets, probe settings and database settings retained their hashes.

## Peer and public verification

All 12 remaining non-exempt slaves were reachable and Docker-healthy. Their
latest collector startup logs confirmed the assigned probe counts:

| Slave capability | FPing | FPing6 | TCPPing | Configured step |
| --- | ---: | ---: | ---: | ---: |
| Dual stack | 16 | 12 | 6 | 60 seconds |
| IPv4 only | 16 | not assigned | 3 | 60 seconds |

These counts match each slave's actual assignment in the new master Targets,
including unchanged external checks and self-target exclusion. The installed
slave `/config/Targets` contains image defaults and is not evidence of the live
signed configuration; acceptance used collector reload/probe-count logs and
received measurements instead. Log streams were ordered by their timestamps
before evaluating the latest probe counts.

At 12:51:04 UTC, all 33 representative raw measurements passed: FPing and
TCPPing on every checked slave, plus FPing6 on dual-stack slaves. Loss fields
were finite and within the 20-ping schema; measured ages were within the
existing 600-second limit, with maximum age 280.8 seconds. This verifies
representative probe-family continuity, not freshness of every matrix route.
The offline exemption was excluded from this verdict, not counted as passed.

Public `/api/nodes` returned HTTP 200 and 20 entries: 14 VPS and six external
targets. Both retired IDs were absent and the exempt node remained present.
Existing browser tabs need a page reload to fetch the new node list. No new
frontend release or capacity test was required for this private configuration
change.

Private local evidence (ignored, never committed):

- `test-results/retire-nodes-20261010-apply.json`
- `test-results/retire-nodes-20261010-peers.json`
- `test-results/retire-nodes-20261010-verification.json`
