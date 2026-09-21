#!/usr/bin/perl
use strict;
use warnings;
# Process health only; master RRD timestamps are the end-to-end freshness check.
my $dir = $ENV{CACHE_DIR} || '/data';
open my $pf, '<', "$dir/smokeping.pid" or die "missing collector PID\n";
my $pid = <$pf>;
chomp $pid;
$pid =~ /^\d+$/ or die "invalid collector PID\n";
open my $parent, '<', "/proc/$pid/cmdline" or die "collector stopped\n";
local $/;
my $cmd = <$parent>;
$cmd =~ /smokeping/ or die "PID no longer belongs to SmokePing\n";
my %found;
for my $file (glob '/proc/[0-9]*/status') {
    open my $fh, '<', $file or next;
    my $status = <$fh>;
    next unless $status =~ /^PPid:\s+$pid$/m;
    next if $status =~ /^State:\s+Z/m;
    (my $cmdfile = $file) =~ s/status$/cmdline/;
    open my $cf, '<', $cmdfile or next;
    my $child = <$cf>;
    $found{$1} = 1 if $child =~ /smokeping\s+\[([^\]]+)\]/;
}
my @required = split /,/, ($ENV{IPPPING_REQUIRED_PROBES} || 'FPing,FPing6,TCPPing');
my @missing = grep { !$found{$_} } @required;
die "missing probes: @missing\n" if @missing;
print "collector and required probes running\n";
