import { describe, expect, test } from "bun:test";
import { encryptPushPayload, isPushServiceEndpoint } from "./web-push";

const b64 = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));

describe("encryptPushPayload", () => {
  test("reproduces the RFC 8291 Appendix A example byte for byte", async () => {
    const asPublic = b64(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    );

    const jwk = {
      crv: "P-256",
      d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      kty: "EC",
      x: Buffer.from(asPublic.slice(1, 33)).toString("base64url"),
      y: Buffer.from(asPublic.slice(33)).toString("base64url"),
    };

    const algorithm = { name: "ECDH", namedCurve: "P-256" };

    const local = {
      privateKey: await crypto.subtle.importKey("jwk", jwk, algorithm, true, [
        "deriveBits",
      ]),
      publicKey: await crypto.subtle.importKey(
        "raw",
        asPublic,
        algorithm,
        true,
        []
      ),
    };

    const body = await encryptPushPayload(
      {
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      },
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      b64("DGv6ra1nlYgDCS1FRnbzlw"),
      local
    );

    const header = b64(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    );

    const ciphertext = b64(
      "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ"
    );

    expect(Buffer.from(body)).toEqual(
      Buffer.concat([Buffer.from(header), Buffer.from(ciphertext)])
    );
  });
});

describe("isPushServiceEndpoint", () => {
  test("accepts the browsers' push services over https", () => {
    expect(
      isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc")
    ).toBe(true);
    expect(isPushServiceEndpoint("https://web.push.apple.com/QG9")).toBe(true);
    expect(
      isPushServiceEndpoint("https://jmt17.google.com/fcm/send/c6Bce4cq")
    ).toBe(true);
    expect(
      isPushServiceEndpoint(
        "https://updates.push.services.mozilla.com/wpush/v2/x"
      )
    ).toBe(true);
  });

  test("refuses anything the server should not be made to call", () => {
    expect(
      isPushServiceEndpoint("http://fcm.googleapis.com/fcm/send/abc")
    ).toBe(false);
    expect(isPushServiceEndpoint("https://127.0.0.1:4310/v1/sessions")).toBe(
      false
    );
    expect(
      isPushServiceEndpoint("https://evilpush.apple.com.example.org/")
    ).toBe(false);
    expect(isPushServiceEndpoint("https://notpush.apple.com/")).toBe(false);
    expect(isPushServiceEndpoint("not a url")).toBe(false);
  });
});
