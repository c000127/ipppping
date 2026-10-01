# Finite low-resource NAT/SLAAC node trial — 2026-10-01

Scope: the user authorized testing Tamago HKT, then production enrollment and
peer synchronization only after passing. No production addresses, SSH material,
live inventory or secrets are included in this sanitized report. Private raw
reports stay in ignored `test-results/`; deployment backups remain on the hosts.

## Environment and controlled setup

- Provider/user specification: 0.25 vCPU N100, 0.25 GB RAM, 8 GB NVMe, NAT IPv4
  with DDNS and independent IPv6/SLAAC. The guest exposes no Docker CPU quota;
  the provider's 0.25-vCPU allocation is not independently verified by a guest
  cgroup setting.
- Observed Debian 12 bookworm, kernel 6.1.0-53-cloud-amd64, MemTotal 223,584 KiB
  (218.34 MiB), root filesystem 7.7 GiB, initially ~6.2 GiB available.
- Existing lz4 zram: 256 MiB logical capacity, priority 100. No resizing,
  swappiness changes, unrelated service removal, or OS upgrade. DDNS, Beszel and
  guest/network services remain running.
- Docker installed from the official Debian stable repository with the five
  required packages and `--no-install-recommends`. Engine 29.8.2, containerd
  2.3.6, Compose 5.5.1; `hello-world` passed. Versions are observed facts, not
  future upgrade recommendations.
- Same validated production SmokePing image, pinned at
  `sha256:c43ea9bf3ad313e4a2539dcde0be4772b1fc8c926f481cc7506694c0b1399f6c`.
  Apache disabled; host networking; no web port published. Foreground PID,
  required-probe healthcheck, bounded logs and recovery timer are retained.

## Isolated pre-enrollment evidence

An owned standalone trial copied only the existing production target/probe/
database shape, removing slave assignments and master-only polling exclusions.
No production secret was needed. It probed 38 targets: 18 FPing, 14 FPing6 and
6 TCPPing, retaining 60-second steps and 20 pings. A standalone collector also
writes local RRDs, so it is not identical to a signed-upload slave.

The first trial configuration lacked mandatory CGI URL/alert sender/recipient
fields and failed validation. It was repaired only in the isolated directory;
the failed configuration/logs were retained. No passing claim includes this
startup interval. Successful collector launch was around 11:47 UTC. At
11:53:11 UTC, all 38 RRDs contained at least five valid minute buckets, none
older than 180 seconds. Loss is a valid measurement, including 100%; unknown
loss is not. Representative IPv4/IPv6 ICMP and TCP records held 20 samples.

Docker installation produced transient memory pressure. Valid trial snapshots
showed ~25–34 MiB MemAvailable, ~120–138 MiB logical swap usage, memory PSI
`some avg60` ~0.7–2.9%; no global OOM kills, no container OOM or restart.
These are sparse snapshots, not certified peaks. Docker resident-only readings
were small because pages were swapped; they must not be advertised as the
collector's full memory footprint.

## Network semantics

The controller resolved the DDNS A record and received IPv4 ICMP replies;
the trial guest also resolved/pinged it. Production keeps the hostname, not a
snapshot IP. Source review confirmed FPing passes configured hostnames to a
new fping invocation each round. An actual public DDNS address change was not
forced or observed, so rotation timing remains unmeasured.

NAT IPv4 ICMP can originate from the gateway; inbound v4 latency is **not proof
of guest reachability**. The independent IPv6 replied, and the guest's incoming
ICMPv6 echo counter increased from 5 to 8 during a controller three-ping test.
The RA-derived default route remained present and renewed after Docker install
(observed expiry rose from ~1,008 to ~1,731 seconds). systemd-networkd handles RA;
kernel accept_ra=0 was not blindly changed. Existing SLAAC and explicit address
configuration were left intact.

## Production integration

After the isolated gate passed, private master Targets/Slaves/shared-secret
mapping, credential-free inventory, legacy address list and API node JSON were
backed up and updated. Alias: `tamago_hkt`. Self probes remain excluded. Existing
peers receive the normal signed configuration; there is no direct upload ingress
or new credential store on the controller.

Private restore manifest:
`/root/ipppping-tamago-enroll-backup-20261001T115425Z/manifest.json`, under a
mode-0700 directory. It maps the six pre-enrollment files to retained originals;
do not copy its secret-bearing contents into Git. A rollback needs those private
files, collector/CGI reload and one scoped API restart, plus stopping only the
new slave/recovery timer. No historical RRD or old node service needs deletion.

The master CGI workers were gracefully reloaded and its supervised collector
received HUP to create new RRDs. The trial was stopped and retained (not deleted).
The normal slave started at 11:54:40.599 UTC, with three probes for the same 38
targets, automatic HTTPS transport-family selection, no Apache listener and
Docker/recovery startup enabled. Connection settings reside only in a private
mode-0600 raw env file under a mode-0700 directory; raw Compose env loading avoids
secret interpolation. No key/password was copied to the controller or repository.

Only after collector enrollment, the API was restarted once at 12:01:10 UTC to
load its startup-only private node list. An immediate readiness curl raced
startup and was refused; the subsequent bounded check returned health/nodes
successfully. New API PID 4089341, NRestarts=0. This planned manual restart is
separate from the completed frontend observation and does not reinterpret its
immutable historical results. No API code, frontend assets or proxy rules changed.
The credential-free inventory also records this node's non-root SSH user in an
optional `ssh_user` column; older entries remain unspecified, not guessed.

At 12:08:07 UTC all **65** assigned paths contained real loss measurements with
20-ping schema and ages <=272 seconds: 38 outbound, incoming from 14 IPv4 peers
and 11 IPv6 peers, plus the master's two incoming probes. All 65 raw measurement
timestamps advanced between retained production snapshots. Global canonical
freshness passed all 42 slave/probe combinations, maximum age 256 seconds.
The initial incoming RFC v4 RRD was unknown while awaiting its first upload;
it subsequently received real data and is not omitted from the gate.

The normal slave stayed healthy for ~13 minutes after startup, same process
identity, zero restarts/global OOM/container OOM. Last snapshot: MemAvailable
29.08 MiB, whole-host zram logical data ~139.2 MiB, compressed backing allocation
44.3 MiB, root free ~5.5 GiB. Collector cgroup resident charge ~8.71 MiB **plus
54.17 MiB logical swapped charge**; these are different units/charges, not a
physical-memory sum. Its CPU delta over 654 seconds averaged ~3.24% of one core,
not certified burst demand or the Docker/containerd/whole-host cost. Memory PSI
some avg60 was ~1.22%, full ~0.91% at the last snapshot. Original 256 MiB zram
was retained; no unsafe swapoff/resize was necessary.

Chrome extension-backed public verification (~12:05–12:07 UTC) showed 16 VPS
and 6 external nodes, correct alphabetical placement and v4/v6 badges. A single
two-node query against a JP peer rendered four bidirectional Results cards
(v4 ~44.7/44.9 ms, v6 ~49.8/49.9 ms; zero loss) and four Canvas plots; no captured
console warnings/errors. Ordinary Python urllib public access returned 403,
so it was not counted as a pass and no access-control rule was weakened.
The computer-use skill's browser-first guidance selected the existing Chrome
connector; no browser profile, Android device or security setting was changed.

Finite functional/capacity trial **passed**, and production enrollment/peer
synchronization completed. 96 Python tests passed, including seven bootstrap
guard tests. This is not long-term leak freedom, reboot testing, DDNS rotation
testing, or an unlimited expansion guarantee. Adding unrelated services or many
more targets to this host needs a new resource check; current RAM margin is low.

## References

- [Official Docker Debian apt-repository installation](https://docs.docker.com/engine/install/debian/)
- [LinuxServer SmokePing environment and slave configuration](https://docs.linuxserver.io/images/docker-smokeping/)
- [SmokePing FPing probe](https://oss.oetiker.ch/smokeping/probe/FPing.en.html)
