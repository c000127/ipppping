# Security and Sanitization

## Never commit

- public or private IPv4/IPv6 addresses from the deployment;
- SSH private keys, public key contents, key paths, `known_hosts`, or shell
  history containing connection commands;
- SmokePing shared secrets, passwords, API tokens, cookies, bearer values, or
  TLS private keys;
- production `nodes.json`, inventory CSVs, RRD files, logs, screenshots with
  addresses, or generated backups;
- private service URLs when an example hostname is sufficient.

The `.gitignore` is a guardrail, not a security boundary. Review every file and
the Git diff before pushing.

## Before every push

```bash
git status --short
git diff --check
rg -n --hidden -S \
  'BEGIN .*PRIVATE KEY|ssh-(rsa|ed25519)|password|passwd|secret|token|api[_-]?key|Authorization|Bearer|([0-9]{1,3}\.){3}[0-9]{1,3}|([0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}' \
  . -g '!*.woff2' -g '!*.pyc'
git ls-files | rg -i '(^|/)(nodes\.json|.*secret.*|.*inventory.*|.*\.env$|.*\.pem$|.*\.key$|.*\.rrd$|.*\.log$)'
```

The search can produce false positives for test data, version numbers, or
documentation examples. Resolve each match manually; do not simply ignore the
scan.

## Runtime controls

For backup key separation, private Windows ACLs, authenticated encryption and
staging-only recovery, see [RECOVERY.md](RECOVERY.md). Encrypted archives still
contain private deployment information and must not be committed. Verify a
trusted off-host archive checksum as well as its encryption tag and member
manifest; encryption to a public certificate alone is not a sender signature.

- Bind the API to loopback and expose only the reverse proxy.
- Use a dedicated service account with read-only access to RRD data.
- Keep SmokePing secrets mode `0600` and outside the Git checkout.
- Limit graph dimensions, durations, pair count, and concurrent `rrdtool`
  processes as the current API does.
- Keep production backups encrypted and separate from public source control.
- Rotate any credential immediately if it was ever committed, even if the
  commit was later amended.
