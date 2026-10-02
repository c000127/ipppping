# Recovery readiness — 2026-10-02

Times below are Asia/Singapore (UTC+08:00). This is a sanitized readiness
record, **not** a claim that a fresh production host or offline disaster
recovery has been fully certified. See [the runbook](RECOVERY.md).

## Delivered and verified

- Private encrypted master capture, 12:12:54–12:16:27, 60,566,793 bytes.
  It contains 933 archive members, including 797 RRD XML exports. Every export
  was restored into a private temporary RRD and its full canonical dump and
  last-update timestamp matched. The completed encrypted archive was then
  decrypted, authenticated and every member hash/metadata checked off-host.
- The deployed API, private node file, actual frontend/legacy assets, master
  configuration, inventory, TLS material, units/drop-ins, container/image
  metadata and package versions are captured. Master API/container identity
  did not change; no production restart or configuration rollout was performed.
- All 15 currently configured slave deployments were captured and verified,
  including the non-root/sudo low-memory node. Retired inventory rows were
  excluded by intersecting the active application nodes with registered slaves.
- Files are on the operator's machine outside Git, in a restricted NTFS
  directory. The newly generated recovery private key is separate and never
  uploaded to the controller or any node. Private archive hashes, paths and
  per-node coverage are handed over separately, not published here.
- Explicit decrypted review stages remain under the same restricted NTFS ACL;
  the environment rejected automated cleanup. The private handover identifies
  these sensitive copies for operator cleanup and warns against sharing them.
- Recovery CLI rejects overwrite, malformed member paths, links/devices,
  duplicate/case-colliding members, mismatched hashes and failed authentication.
  The real OpenSSL GCM round-trip/tamper test passes. The isolated Linux RRD lab
  verifies reconstruction of measured/unknown/loss data and refusal of corrupt
  input or an existing output directory.
- The example SmokePing configuration now passes syntax validation in the
  actual pinned image, in a temporary network-disabled, resource-limited
  container. Fixed missing General/Alerts directives, Slaves secret-file
  syntax, Presentation structure, sendmail path and an invalid slave alias.
  Normal image init supplies TCPPing; its deployed and image-default checksums
  match. The syntax harness reproduces that prerequisite without starting probes.
- All 101 Python tests pass, with the OpenSSL integration enabled (not skipped).
- Public master Compose now requires a chosen digest and records the Apache
  runtime mount; the Caddy sample uses placeholder hostnames. Upgrade scripts
  are explicitly distinguished from first-install/recovery procedures.

## Recovered-node follow-up

Miaomoe DE was initially unreachable: two direct SSH attempts reset and a
jump-host diagnostic timed out; its three freshness checks were over 12 hours
old while the other 39 passed. After the user reported it up, direct backup
and verification succeeded, closing the coverage gap. A separate issue was
observed: its UTC clock lagged the controller/operator by about 12h28m despite
`NTPSynchronized=yes`. That flag and container `healthy` were not sufficient.

With explicit user approval, only that node's `systemd-timesyncd` was restarted.
The new NTP response measured a +12h27m52s correction; synchronization completed
at 12:38:14 local time, followed by a +174µs offset report. No NTP source file,
timezone, sampler, container, history or master service was changed. A VM
pause/resume is consistent with the evidence, but the hypervisor cause is not
proven. The node collector PID/start time/restart counter stayed unchanged.

The controller received advancing FPing, FPing6 and TCPPing measurements after
correction. A later check found sample ages of approximately 38/61/57 seconds,
with real loss/median values, and all 42 canonical freshness checks passed.
An additional correctly timed node backup was received at 12:39:43 and verified
(28,059 bytes, 22 members). The earlier backup retains its original incorrect
node-clock timestamp; the private index identifies the newer copy. The capture
CLI now reports operator-clock `receivedAt`/`verifiedAt` separately from the
node's `completedAt`; no timestamps were rewritten to hide the issue.

## Known gaps — do not call these passing

1. **No fresh-host/public cutover or reboot test.** Restore verification is
   isolated data/configuration testing, not a DNS/TLS/upload/reboot migration.
2. **No globally atomic history snapshot.** The online export is stable per file;
   different paths have different capture times.
3. **Not a fully offline install kit.** Image identities and package versions are
   captured, not all image layers/OS packages. Registry/package availability,
   DNS/CDN/DDNS account access, SSH access and external backups remain separate.
4. **No scheduled retention or independent offline key copy yet.** Backups and key
   are on separate private directories of the operator's computer, not separate
   physical fault domains. Copy the recovery key and a verified backup to
   independently secured offline storage. No automatic deletion was configured.

## Next recovery gates

Select an agreed backup cadence/RPO and retention policy; keep an independent offline key/backup copy;
optionally archive pinned image layers and packages; then exercise the full
runbook on a separate host before an actual migration. Do not reactivate old
frontend monitoring plans or restart production to satisfy these documentation
and backup checks.
