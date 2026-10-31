/**
 * Web Push delivery (RFC 8030) signed with VAPID (RFC 8292) and encrypted as
 * aes128gcm (RFC 8291). Built on WebCrypto, so no push library is needed.
 */

export interface PushSubscriptionKeys {
  auth: string;
  p256dh: string;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface VapidKeys {
  privateJwk: JsonWebKey;
  /** Uncompressed P-256 point, base64url: the browser's `applicationServerKey`. */
  publicKey: string;
}

const encoder = new TextEncoder();

const RECORD_SIZE = 4096;

/**
 * Only the browsers' own push services. The endpoint comes from the client, and
 * the server POSTs to it, so anything else would be a request forgery hole.
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  // Current Chrome hands out https://jmt17.google.com/fcm/send/... endpoints.
  "google.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  const onHost = (host: string) =>
    url.hostname === host || url.hostname.endsWith(`.${host}`);

  if (url.protocol !== "https:" || !PUSH_SERVICE_HOSTS.some(onHost)) {
    return false;
  }

  // Any google.com site is far wider than FCM (Apps Script runs anyone's code).
  return !onHost("google.com") || url.pathname.startsWith(GOOGLE_FCM_PATH);
}

const GOOGLE_FCM_PATH = "/fcm/send/";

const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(value, "base64url"));

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);

  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { hash: "SHA-256", info, name: "HKDF", salt },
      key,
      length * 8
    )
  );
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);

  return {
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    publicKey: toBase64Url(new Uint8Array(raw)),
  };
}

/**
 * One aes128gcm record (RFC 8291 §3.4, RFC 8188 §2). `salt` and `local` are
 * only passed by tests that pin the RFC example; real sends draw fresh ones.
 */
export async function encryptPushPayload(
  keys: PushSubscriptionKeys,
  payload: Uint8Array,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
  local?: CryptoKeyPair
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64Url(keys.p256dh);

  const sender =
    local ??
    (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    ));

  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", sender.publicKey)
  );

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey },
      sender.privateKey,
      256
    )
  );

  const ikm = await hkdf(
    fromBase64Url(keys.auth),
    ecdhSecret,
    concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic),
    32
  );

  const cek = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16
  );

  const nonce = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: nonce\0"),
    12
  );

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);

  // 0x02 marks the last (and only) record, with no padding after it.
  const ciphertext = await crypto.subtle.encrypt(
    { iv: nonce, name: "AES-GCM" },
    aesKey,
    concat(payload, new Uint8Array([2]))
  );

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);

  return concat(header, new Uint8Array(ciphertext));
}

type JwtSegment = Record<string, string | number>;

async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  subject: string
): Promise<string> {
  const encode = (value: JwtSegment) =>
    toBase64Url(encoder.encode(JSON.stringify(value)));

  const unsigned = `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    vapid.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // WebCrypto signs as raw r||s, which is what JWS ES256 wants.
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    key,
    encoder.encode(unsigned)
  );

  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${vapid.publicKey}`;
}

/** "gone" means the browser dropped the subscription and it should be forgotten. */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: string,
  vapid: VapidKeys,
  subject: string
): Promise<"sent" | "gone"> {
  const response = await fetch(subscription.endpoint, {
    body: await encryptPushPayload(subscription.keys, encoder.encode(payload)),
    headers: {
      Authorization: await vapidAuthorization(
        subscription.endpoint,
        vapid,
        subject
      ),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 60 * 60),
      Urgency: "high",
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 404 || response.status === 410) {
    return "gone";
  }

  if (!response.ok) {
    throw new Error(
      `Push service answered ${response.status}: ${(await response.text()).slice(0, 200)}`
    );
  }

  return "sent";
}
