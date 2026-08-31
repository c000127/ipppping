# Deployment templates

These files are safe templates, not drop-in production credentials. Replace
only in private deployment state:

- the node inventory and addresses;
- the SmokePing shared secret;
- the actual site hostname and TLS settings;
- service paths and user IDs;
- the private way the selected SmokePing image receives its slave connection
  settings.

The master and slave Compose files use host networking because FPing/FPing6 and
TCPPing need network access. That also means container listeners are host
listeners. Run `ss -H -lntp` after each deployment and keep the slave's web
service disabled unless it is explicitly needed.
