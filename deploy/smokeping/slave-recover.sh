#!/bin/sh
set -eu
# Docker does not restart merely unhealthy containers. Called by a host timer.
# A failed healthcheck alone never causes an immediate restart.
name=smokeping-slave
state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name")
test "$state" = 'running unhealthy' || exit 0
last=/run/ipppping-slave-recovery
now=$(date +%s)
previous=0
test ! -r "$last" || read -r previous < "$last"
test "$((now - previous))" -ge 900 || exit 0
printf '%s\n' "$now" > "$last"
logger -t ipppping 'restarting slave after sustained probe-health failure'
docker restart --time 30 "$name"
