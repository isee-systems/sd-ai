import { lookup } from 'dns/promises';
import { isIP } from 'net';
import logger from '../../utilities/logger.js';

/**
 * Where the Agent SDK's WebFetch may point.
 *
 * WebFetch and WebSearch arrive with the claude_code preset and are handed to
 * every agent — they are not in SDK_WRITE_TOOLS, so even a read-only agent has
 * them. That is deliberate: agents want to read documentation. What is not
 * wanted is the other thing an unrestricted outbound fetch is, which is a request
 * primitive aimed at the host.
 *
 * bwrap is given no --unshare-net, because CredentialProxy needs the sandbox and
 * the main process to share a loopback (see CredentialProxy). The sandbox
 * therefore has the host's whole network stack: its 127.0.0.1 is the host's, its
 * routing table is the host's, and 169.254.169.254 is the cloud metadata server,
 * which hands out an access token for the VM's service account to anything that
 * asks. So a fetch aimed inward reaches services that are unauthenticated
 * precisely because "only local processes can reach them".
 *
 * This rejects those destinations before the fetch happens. It is enforced in a
 * PreToolUse hook rather than through the SDK's own `WebFetch(domain:...)`
 * permission rules for the same reason the filesystem guard is: the query runs
 * with permissionMode 'bypassPermissions', so no permission rule is ever
 * consulted, and a PreToolUse deny is documented as the one decision that
 * outlives bypass.
 *
 * ## What this does not do
 *
 * It sees the URL the model wrote, and — for a hostname — the addresses that
 * hostname resolves to at check time. It does not see redirects, so a public host
 * answering 302 to http://169.254.169.254/ still lands there, and it cannot close
 * the window between this lookup and the fetch's own, so a hostname whose DNS
 * flips between them still lands there. Both are properties of checking a URL
 * rather than a socket, and neither is fixable here.
 *
 * The fix that does close them is at the host: detach the VM's service account or
 * drop link-local egress with a firewall rule. This guard is what makes the
 * obvious attempt fail; it is not the boundary.
 */

// IPv4 ranges that are not somewhere an agent researching a topic has business
// going. Bounds are inclusive on the first octet pair.
function isBlockedIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true; // unparseable: refuse rather than guess
  }
  const [a, b] = octets;

  if (a === 0) return true;                      // 0.0.0.0/8    "this host"
  if (a === 10) return true;                     // 10.0.0.0/8   RFC1918
  if (a === 127) return true;                    // 127.0.0.0/8  loopback
  if (a === 169 && b === 254) return true;       // 169.254/16   link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16/12  RFC1918
  if (a === 192 && b === 168) return true;       // 192.168/16   RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64/10  CGNAT
  if (a === 192 && b === 0) return true;         // 192.0.0/24   protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true;                     // multicast + reserved

  return false;
}

/**
 * Expand an IPv6 address to its eight 16-bit groups, or null if it will not
 * parse.
 *
 * Needed because the embedded-IPv4 forms cannot be pattern-matched on the text:
 * a URL parser canonicalises `::ffff:169.254.169.254` to `::ffff:a9fe:a9fe`
 * before this ever sees it, so the dotted quad an SSRF check would look for is
 * not there any more. The address has to be decoded, not read.
 */
function ipv6Groups(address) {
  let addr = address;

  // A trailing dotted quad survives in hand-written input; fold it into two
  // hex groups so the rest of this function has one representation to handle.
  const dotted = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[1].split('.').map(Number);
    if (octets.some(o => o > 255)) return null;
    addr = addr.slice(0, -dotted[1].length)
      + ((octets[0] << 8 | octets[1]).toString(16)) + ':'
      + ((octets[2] << 8 | octets[3]).toString(16));
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  if (halves.length === 1) {
    return head.length === 8 ? head.map(p => parseInt(p, 16)) : null;
  }

  const tail = halves[1] ? halves[1].split(':') : [];
  const elided = 8 - head.length - tail.length;
  if (elided < 0) return null;

  return [...head, ...Array(elided).fill('0'), ...tail].map(p => parseInt(p || '0', 16));
}

const dottedFromGroups = (hi, lo) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');

function isBlockedIpv6(address) {
  const addr = address.toLowerCase();

  if (/^fe[89ab]/.test(addr)) return true;  // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return true;     // fc00::/7  unique local

  const groups = ipv6Groups(addr);
  if (!groups) return true; // unparseable: refuse rather than guess

  const zeroPrefix = groups.slice(0, 5).every(g => g === 0);
  const embedded = dottedFromGroups(groups[6], groups[7]);

  // ::  and  ::1
  if (zeroPrefix && groups[5] === 0 && groups[6] === 0 && groups[7] <= 1) return true;
  // ::ffff:a.b.c.d — IPv4-mapped. Judged by the IPv4 rules rather than waved
  // through, because misclassifying exactly this is a documented way past an
  // SSRF check.
  if (zeroPrefix && groups[5] === 0xffff) return isBlockedIpv4(embedded);
  // ::a.b.c.d — deprecated IPv4-compatible, same reasoning.
  if (zeroPrefix && groups[5] === 0) return isBlockedIpv4(embedded);
  // 64:ff9b::a.b.c.d — NAT64.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(g => g === 0)) {
    return isBlockedIpv4(embedded);
  }

  return false;
}

/** Strip the brackets a URL parser leaves around an IPv6 literal. */
function bareHost(hostname) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function isBlockedAddress(address) {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return false;
}

/**
 * Decide whether an SDK network tool call may proceed.
 *
 * Returns { allowed, reason }. WebSearch is not checked: it takes a query, not a
 * URL, and its results reach the network through this same guard if the model
 * follows one of them with WebFetch.
 */
export async function evaluateSdkNetworkAccess(toolName, toolInput) {
  if (toolName !== 'WebFetch') return { allowed: true, reason: null };

  const requested = toolInput?.url;
  if (typeof requested !== 'string' || requested === '') {
    return { allowed: false, reason: 'WebFetch: url must be a string.' };
  }

  let url;
  try {
    url = new URL(requested);
  } catch {
    return { allowed: false, reason: `WebFetch: '${requested}' is not a valid URL.` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      allowed: false,
      reason: `WebFetch: only http and https are allowed, not '${url.protocol}'.`
    };
  }

  const host = bareHost(url.hostname);
  const refusal = {
    allowed: false,
    reason: `Fetching a private, loopback, or link-local address is not allowed: ${url.hostname}. `
          + `WebFetch is for public documentation; this server's own network is not yours to probe.`
  };

  // A literal address answers the question outright.
  if (isIP(host)) {
    return isBlockedAddress(host) ? refusal : { allowed: true, reason: null };
  }

  // A hostname has to be resolved, and not only because of DNS entries that point
  // inward on purpose: `http://2130706433/` and `http://0177.0.0.1/` are not IP
  // literals as far as isIP is concerned, but getaddrinfo resolves both to
  // 127.0.0.1. Resolving is what catches the obfuscated forms as well as the
  // deliberate ones.
  let resolved;
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch (err) {
    // NXDOMAIN and friends: the fetch is going to fail on its own, so there is
    // nothing to protect against and nothing to be gained by refusing here.
    logger.debug(`[network-guard] could not resolve ${host}: ${err.message}`);
    return { allowed: true, reason: null };
  }

  if (resolved.some(entry => isBlockedAddress(entry.address))) return refusal;

  return { allowed: true, reason: null };
}

/**
 * Build the PreToolUse hook half that enforces the above. Composed with the
 * filesystem guard at the one call site — see AgentOrchestrator — rather than
 * registered as a second hook, so the precedence between the two is stated in
 * our code instead of inherited from the SDK's hook-composition semantics.
 */
export function createSdkNetworkGuard() {
  return async (input) => {
    if (input?.hook_event_name !== 'PreToolUse') return {};

    const { allowed, reason } = await evaluateSdkNetworkAccess(input.tool_name, input.tool_input);
    if (allowed) return {};

    logger.warn(`[network-guard] denied ${input.tool_name}: ${reason}`);

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  };
}
