# Changelog

## Repository baseline

This initial maintenance baseline records the deployed application shape:

- Python `http.server` API with structured errors and security headers;
- RRD-backed Current, Average, Min, Max, and Loss statistics;
- batch stats, structured series, and PNG graph endpoints;
- bounded graph concurrency and short-lived caches keyed by RRD freshness;
- responsive Results/Charts frontend with IPv4, IPv6, external checks, retry,
  lazy image loading, and optional unified Y-axis ranges;
- locally served JetBrains Mono and Smiley Sans font assets with license files;
- systemd and reverse-proxy templates;
- SmokePing master/slave templates for FPing, FPing6, and TCPPing;
- sanitized documentation and examples.

Production deployment snapshots, generated configs, real inventories, RRD data,
and credentials are intentionally excluded.
