# Sustainable lightweight operation

## Scope and invariants

Keep the existing SmokePing/RRD data model, 60-second configured step, 20 pings,
IPv4/IPv6/external labels and HTTPS HMAC-authenticated slave upload. Do not lower
measurement fidelity to produce attractive memory numbers. A node with dead
probe children consumes less memory but is not a valid optimization baseline.
Do not restore a public direct-to-master upload port or install SSH secrets on
the master. No new Python packages, collector fork or replacement database are
required by this change.

## Option 1: hide the legacy UI, retain the receiver

The legacy Caddy host accepts only POST at `/smokeping/` and
`/smokeping/smokeping.cgi`; all other methods/paths return 404. The custom UI
has its own unchanged virtual host. Apache/FCGI still listen on loopback for
slave configuration and result exchange. This is **not** removal of Apache,
nor a promise to reclaim its resident memory. It avoids legacy browser page
and graph work while preserving the supported slave protocol. SmokePing's
existing HMAC checks remain the authentication boundary; method filtering is
not authentication.

`deploy/smokeping/restrict-legacy-web.py /path/to/Caddyfile` validates a candidate,
saves the previous file, reloads Caddy and restores the previous file if reload
fails. It intentionally refuses configurations without exactly one expected
loopback legacy upstream. Review private vhosts and paths before running it.
Never publish the real Caddyfile or TLS credentials.

## Optimization 1: foreground lifecycle and real health

In the deployed upstream SmokePing code, `--nodaemon` skips `daemonize_me()`,
which otherwise creates `smokeping.pid`. A slave probe receiving new config
signals the parent using that PID file. The new foreground run script writes
its PID before `exec`, explicitly sets `--pid-dir` and retains s6 supervision.
No upstream Perl files are patched.

The in-container healthcheck verifies the parent PID and direct, non-zombie
probe children. Set `IPPPING_REQUIRED_PROBES=FPing,TCPPing` on IPv4-only nodes;
dual-stack nodes use `FPing,FPing6,TCPPing`. This assumes this project's
multi-probe deployment with upstream process naming enabled. Adjust the check
before using single-probe or custom probe-name deployments.

Healthchecks run every minute with a five-minute startup allowance and five
consecutive failures before unhealthy. Docker's restart policy alone does not
recover an unhealthy-but-running container. A small host systemd timer restarts
only sustained unhealthy containers, with a 15-minute recovery cooldown. The
cooldown lives in `/run` and resets on host reboot. Network/upload failures are
not treated as permission to repeatedly restart otherwise healthy probes.

`check_freshness.py` separately checks one canonical RRD for each configured
probe family on every inventory slave. Missing files or samples older than
600 seconds fail the check; 100% packet loss is still a valid measurement.
This is representative per-probe coverage, not a guarantee that every target
or every external-v6 RRD is fresh. `/healthz` remains API liveness only.
`ipppping-freshness.timer` runs this read-only end-to-end check every five minutes;
failures are visible in the service status/journal, without external alerts.

When changing master targets/probes, validate first, then advance the mtime of
the main configuration file used by CGI (`/etc/smokeping/config` in this image).
Changing only an included `Targets`/`Probes` file is not a reliable config-version
bump. After any container recreation, check the effective main-file version
again. Validate Apache config and gracefully reload its FastCGI receiver after
the version bump (`apachectl -t` then `apachectl -k graceful` inside the master
container); do not rely solely on an already-running CGI process noticing the
file timestamp. Confirm children restart and RRDtool timestamps advance; a successful
container restart or a rendered graph with old data is insufficient.

## Optimization 2: bounded API resources

- PNG cache: 128 entries / 16 MiB estimated Python object payload, TTL 30s.
- Shared stats/series cache: 256 entries / 8 MiB estimated payload, TTL 15s.
- Expired keys are swept on reads/writes, including obsolete RRD-mtime keys;
  LRU evicts the oldest entry at either cap. Oversized single entries are not
  cached. These are cache budgets, not hard total-process RSS limits.
- Fixed-size striped locks coalesce identical in-process concurrent misses;
  there is no unbounded per-key lock table. PNG cache lookup precedes the
  range-probe subprocess, so hits do no RRDtool work.
- `IPPPING_MAX_GRAPH_WORKERS` defaults to 4 RRDtool slots and shared batch
  workers; `IPPPING_MAX_BATCH_REQUESTS` defaults to 4 admitted batches.
  Each batch submits at most four futures, not all 500 allowed pairs.
- `IPPPING_MAX_HTTP_WORKERS` defaults to 16 active requests, with 10-second
  socket I/O timeouts. Excess requests receive 503/Retry-After. Batch overload
  responses are not cached. Batch workers are reused across requests.

## Optimization 3: request only selected results

The browser no longer prefetches an all-node matrix on startup or waits for
that background request. Batch statistics and session storage contain only
the committed selection; charts keep the existing viewport/lazy-load behavior.
Pair construction, optional unified axes, external Ext + v4/v6 labels, and
alphabetical node order are unchanged. Selecting many nodes still legitimately
costs work; the API selection/pair limits continue to apply.

## Optimization 4: reproducible lightweight slave runtime

Keep the installed LinuxServer image, pin its existing local digest, disable
slave Apache, and cap JSON logs at 2 files of 5 MiB. Do not pull a newer image as
part of this rollout. Future image upgrades require a canary startup, master
config reload and fresh-RRD test. Existing Docker/host networking/probe
capabilities remain in place; removing a host's Docker installation could
disrupt unrelated services and is not part of this change.

Stage all files from `deploy/smokeping/` on a slave, then run:

```sh
python3 install-slave-runtime.py --probes FPing,FPing6,TCPPing
```

The installer expects `/root/smokeping-slave/docker-compose.yml`, preserves its
private environment, writes `ipppping.override.yml`, pins the running image,
quietly validates merged Compose, and recreates only `smokeping-slave`. Existing
runtime overrides are backed up in a mode-0700 directory. It does not print or
copy shared secrets into this repository. The host needs Python 3, Compose and
systemd. New-machine Docker installation remains covered by DEPLOYMENT.md.

All subsequent Compose operations **must include both files**:

```sh
docker compose -f docker-compose.yml -f ipppping.override.yml up -d --pull never
```

## Verification and rollback

1. Run `python3 -m unittest -v` and `node --check web/app.js`.
2. Check legacy GET = 404, custom UI = 200, and real signed slave uploads.
3. Verify `slave-healthcheck`, absence of `httpd` on slaves, and active recovery
   timers. Test a canary HUP, then an actual master config-version update.
4. Check `rrdtool last` advances over multiple cycles for FPing, FPing6 and
   TCPPing. Also request real stats, an external-v6 series and a PNG.
5. Compare resource usage only after healthy sampling resumes. Record runtime
   limits separately from measured savings; do not extrapolate short samples.

API deployment helper `deploy/install-api.py STAGING_DIR` backs up only changed
application files, atomically replaces each file and restarts the service. It
rolls back on failed local API startup. Never overwrite the private nodes file.
To roll back later, restore the listed files from that backup and restart
`ipppping.service`. Restore the Caddy backup and validate/reload to re-enable
legacy browsing if necessary.

For slave rollback, disable `ipppping-slave-recover.timer`, restore the previous
override and scripts from its recorded backup and recreate with both Compose
files. If no prior override existed, use the untouched base Compose alone.
This returns to the previous configuration, including its known PID defect;
do not regard rollback as a long-term repair. No RRD data needs deletion.

## Upstream references

- [SmokePing command-line and foreground/slave operation](https://oss.oetiker.ch/smokeping/doc/smokeping.en.html)
- [LinuxServer SmokePing image and supported environment](https://docs.linuxserver.io/images/docker-smokeping/)

## Production validation notes (2026-09-21)

The rollout preserved existing image versions rather than mixing this change
with an image upgrade. All 17 slaves received foreground PID handling, bounded
logs, Docker healthchecks and recovery timers. Eight older slaves still ran
Apache before standardization; subsequent checks found no httpd processes on
any slave. The master keeps Apache/FCGI as designed in option 1.

The 33 backend/runtime tests and JavaScript syntax check passed. Live tests
returned legacy UI 404, custom UI/health 200, valid external IPv6 stats/series
and a PNG graph. Per-probe freshness covered 47 slave/probe combinations.
These checks do not constitute a long-duration memory soak test or proof of a
fixed percentage performance improvement.

One remaining operational limitation: the IPv4-only YXVM JP Vol was producing
data but logged polling rounds around 125–137 seconds despite the unchanged
configured 60-second step. Its slow sampling path needs separate profiling;
this rollout does not restore the unsafe direct master ingress to mask it.
